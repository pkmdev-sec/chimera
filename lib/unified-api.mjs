/**
 * CHIMERA — Unified API
 * Single API that works with any AI provider.
 * Combines registry, adapter, normalizer, router, and failover.
 */

import { ProviderRegistry } from './provider-registry.mjs';
import { RequestAdapter } from './request-adapter.mjs';
import { ResponseNormalizer } from './response-normalizer.mjs';
import { Router, Strategy } from './router.mjs';
import { Failover } from './failover.mjs';

export class Chimera {
  #registry;
  #adapter;
  #normalizer;
  #router;
  #failover;
  #httpClient;

  constructor(opts = {}) {
    this.#registry = opts.registry || new ProviderRegistry();
    this.#adapter = opts.adapter || new RequestAdapter();
    this.#normalizer = opts.normalizer || new ResponseNormalizer();
    this.#router = opts.router || new Router(opts.routing);
    this.#failover = opts.failover || new Failover(opts.failoverOpts);
    this.#httpClient = opts.httpClient || ((provider, adaptedRequest) =>
      defaultHttpClient(provider, adaptedRequest, this.#registry));

    // Set API keys from options
    if (opts.apiKeys) {
      for (const [id, key] of Object.entries(opts.apiKeys)) {
        this.#registry.setApiKey(id, key);
      }
    }
  }

  // ── Core API ───────────────────────────────────────────────

  /**
   * Send a chat completion request to the best available provider.
   * @param {object} request - Unified request format
   * @param {object} opts - { provider, strategy, maxRetries, timeout }
   * @returns {Promise<object>} Normalized response
   */
  async chat(request, opts = {}) {
    try {
      if (!request?.messages?.length) {
        throw new Error('Request must contain at least one message');
      }

      // Determine candidate providers
      let providers;
      if (opts.provider) {
        const p = this.#registry.get(opts.provider);
        if (!p) throw new Error(`Provider not found: ${opts.provider}`);
        providers = [p];
      } else {
        providers = this.#registry.listAvailable();
      }

      if (!providers.length) throw new Error('No available providers');

      // Route to select ordering
      const primary = this.#router.select(providers, request, {
        strategy: opts.strategy,
        providerId: opts.provider,
      });

      // Order: primary first, then others
      const ordered = [primary, ...providers.filter((p) => p.id !== primary.id)];

      // Execute with failover
      const result = await this.#failover.execute(ordered, async (provider) => {
        const adapted = this.#adapter.adapt(provider.id, {
          ...request,
          model: request.model || provider.models[0],
        });

        const startTime = Date.now();
        const rawResponse = await this.#httpClient(provider, adapted);
        const latencyMs = Date.now() - startTime;

        this.#router.recordLatency(provider.id, latencyMs);

        return this.#normalizer.normalize(provider.id, rawResponse, {
          model: request.model || provider.models[0],
          latencyMs,
        });
      });

      return result.response;
    } catch (err) {
      if (err.attempts) throw err; // Already wrapped by failover
      const error = new Error(`Chat request failed: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /**
   * Quick helper: send a single user message.
   */
  async ask(prompt, opts = {}) {
    try {
      if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt must be a non-empty string');
      }
      return this.chat({
        messages: [{ role: 'user', content: prompt }],
        ...opts,
      }, opts);
    } catch (err) {
      const error = new Error(`Ask request failed: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  // ── Configuration ──────────────────────────────────────────

  /** Get the provider registry. */
  get registry() { return this.#registry; }

  /** Get the request adapter. */
  get adapter() { return this.#adapter; }

  /** Get the response normalizer. */
  get normalizer() { return this.#normalizer; }

  /** Get the router. */
  get router() { return this.#router; }

  /** Get the failover manager. */
  get failover() { return this.#failover; }

  /** Set API key for a provider. */
  setApiKey(providerId, key) {
    try {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error('Provider ID must be a non-empty string');
      }
      if (!key || typeof key !== 'string') {
        throw new Error('API key must be a non-empty string');
      }
      this.#registry.setApiKey(providerId, key);
      return this;
    } catch (err) {
      const error = new Error(`Failed to set API key: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Set routing strategy. */
  setStrategy(strategy) {
    try {
      this.#router.setStrategy(strategy);
      return this;
    } catch (err) {
      const error = new Error(`Failed to set strategy: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Register a custom provider. */
  registerProvider(id, config, adapterFn, normalizerFn) {
    try {
      this.#registry.register(id, config);
      if (adapterFn) this.#adapter.registerAdapter(id, adapterFn);
      if (normalizerFn) this.#normalizer.registerNormalizer(id, normalizerFn);
      return this;
    } catch (err) {
      const error = new Error(`Failed to register provider: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Get provider health/status overview. */
  status() {
    try {
      const providers = this.#registry.list();
      return providers.map((p) => ({
        id: p.id,
        name: p.name,
        enabled: p.enabled,
        healthy: p.healthy,
        circuit: this.#failover.getCircuitState(p.id),
        avgLatencyMs: this.#router.getAverageLatency(p.id),
        models: p.models,
      }));
    } catch (err) {
      const error = new Error(`Failed to get status: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }
}

/** Default HTTP client using native fetch with timeout support. */
async function defaultHttpClient(provider, adaptedRequest, registry, timeoutMs = 30000) {
  // Get API key from registry
  const apiKey = registry.getApiKey(provider.id);
  const headers = { ...adaptedRequest.headers };

  if (apiKey) {
    if (provider.authPrefix) {
      headers[provider.authHeader] = `${provider.authPrefix}${apiKey}`;
    } else {
      headers[provider.authHeader] = apiKey;
    }
  }

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${provider.baseUrl}${adaptedRequest.url}`;
    const response = await fetch(url, {
      method: adaptedRequest.method || 'POST',
      headers,
      body: JSON.stringify(adaptedRequest.body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const err = new Error(`${provider.id} API error: ${response.status} ${text.slice(0, 200)}`);
      err.statusCode = response.status;
      throw err;
    }

    return response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const timeoutError = new Error(`Request timeout after ${timeoutMs}ms`);
      timeoutError.statusCode = 408;
      throw timeoutError;
    }
    throw err;
  }
}

// Re-export for convenience
export { Strategy } from './router.mjs';
export { ProviderRegistry } from './provider-registry.mjs';
export { RequestAdapter } from './request-adapter.mjs';
export { ResponseNormalizer } from './response-normalizer.mjs';
export { Router } from './router.mjs';
export { Failover } from './failover.mjs';

export default Chimera;
