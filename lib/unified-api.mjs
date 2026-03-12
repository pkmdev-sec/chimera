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
    this.#httpClient = opts.httpClient || defaultHttpClient;

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
   * @param {object} opts - { provider, strategy, maxRetries }
   * @returns {Promise<object>} Normalized response
   */
  async chat(request, opts = {}) {
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
  }

  /**
   * Quick helper: send a single user message.
   */
  async ask(prompt, opts = {}) {
    return this.chat({
      messages: [{ role: 'user', content: prompt }],
      ...opts,
    }, opts);
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
    this.#registry.setApiKey(providerId, key);
    return this;
  }

  /** Set routing strategy. */
  setStrategy(strategy) {
    this.#router.setStrategy(strategy);
    return this;
  }

  /** Register a custom provider. */
  registerProvider(id, config, adapterFn, normalizerFn) {
    this.#registry.register(id, config);
    if (adapterFn) this.#adapter.registerAdapter(id, adapterFn);
    if (normalizerFn) this.#normalizer.registerNormalizer(id, normalizerFn);
    return this;
  }

  /** Get provider health/status overview. */
  status() {
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
  }
}

/** Default HTTP client using native fetch. */
async function defaultHttpClient(provider, adaptedRequest) {
  const apiKey = provider._apiKey || process.env[`${provider.id.toUpperCase()}_API_KEY`];
  const headers = { ...adaptedRequest.headers };

  if (apiKey) {
    if (provider.authPrefix) {
      headers[provider.authHeader] = `${provider.authPrefix}${apiKey}`;
    } else {
      headers[provider.authHeader] = apiKey;
    }
  }

  const url = `${provider.baseUrl}${adaptedRequest.url}`;
  const response = await fetch(url, {
    method: adaptedRequest.method || 'POST',
    headers,
    body: JSON.stringify(adaptedRequest.body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`${provider.id} API error: ${response.status} ${text.slice(0, 200)}`);
    err.statusCode = response.status;
    throw err;
  }

  return response.json();
}

// Re-export for convenience
export { Strategy } from './router.mjs';
export { ProviderRegistry } from './provider-registry.mjs';
export { RequestAdapter } from './request-adapter.mjs';
export { ResponseNormalizer } from './response-normalizer.mjs';
export { Router } from './router.mjs';
export { Failover } from './failover.mjs';

export default Chimera;
