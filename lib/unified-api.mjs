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
import { HealthDashboard } from './health-dashboard.mjs';
import { RequestLogger } from './request-logger.mjs';

export class Chimera {
  #registry;
  #adapter;
  #normalizer;
  #router;
  #failover;
  #healthDashboard;
  #requestLogger;
  #httpClient;
  #middleware = [];
  #requestHooks = [];
  #responseHooks = [];
  #defaultTimeout;

  constructor(opts = {}) {
    this.#registry = opts.registry || new ProviderRegistry();
    this.#adapter = opts.adapter || new RequestAdapter();
    this.#normalizer = opts.normalizer || new ResponseNormalizer();
    this.#router = opts.router || new Router(opts.routing);
    this.#failover = opts.failover || new Failover(opts.failoverOpts);
    this.#defaultTimeout = opts.timeout ?? 30000; // 30s default
    this.#httpClient = opts.httpClient || ((provider, adaptedRequest, timeout) =>
      defaultHttpClient(provider, adaptedRequest, this.#registry, timeout));

    // Initialize health dashboard and request logger
    this.#healthDashboard = new HealthDashboard(this.#registry, this.#failover, this.#router);
    this.#requestLogger = opts.logging !== false ? new RequestLogger(opts.logging) : null;

    // Set API keys from options
    if (opts.apiKeys) {
      for (const [id, key] of Object.entries(opts.apiKeys)) {
        this.#registry.setApiKey(id, key);
      }
    }

    // Initialize cost configs in normalizer from registry
    for (const provider of this.#registry.list()) {
      if (provider.costPer1kInput !== undefined && provider.costPer1kOutput !== undefined) {
        this.#normalizer.setProviderCost(provider.id, provider.costPer1kInput, provider.costPer1kOutput);
      }
    }
  }

  // ── Middleware & Hooks ─────────────────────────────────────

  /** Add a middleware function (pre-request and post-response). */
  use(middleware) {
    try {
      if (typeof middleware !== 'function') {
        throw new Error('Middleware must be a function');
      }
      this.#middleware.push(middleware);
      return this;
    } catch (err) {
      const error = new Error(`Failed to add middleware: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Add a pre-request hook. */
  onRequest(hook) {
    try {
      if (typeof hook !== 'function') {
        throw new Error('Request hook must be a function');
      }
      this.#requestHooks.push(hook);
      return this;
    } catch (err) {
      const error = new Error(`Failed to add request hook: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Add a post-response hook. */
  onResponse(hook) {
    try {
      if (typeof hook !== 'function') {
        throw new Error('Response hook must be a function');
      }
      this.#responseHooks.push(hook);
      return this;
    } catch (err) {
      const error = new Error(`Failed to add response hook: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Execute request hooks. */
  async #executeRequestHooks(request, provider) {
    for (const hook of this.#requestHooks) {
      try {
        await hook({ request, provider });
      } catch (err) {
        console.error(`Request hook error: ${err.message}`);
      }
    }
  }

  /** Execute response hooks. */
  async #executeResponseHooks(response, request, provider) {
    for (const hook of this.#responseHooks) {
      try {
        await hook({ response, request, provider });
      } catch (err) {
        console.error(`Response hook error: ${err.message}`);
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

      // Apply middleware (pre-request)
      for (const mw of this.#middleware) {
        try {
          request = await mw(request, { stage: 'request' }) || request;
        } catch (err) {
          console.error(`Middleware error (request): ${err.message}`);
        }
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

      const timeout = opts.timeout ?? this.#defaultTimeout;

      // Execute with failover
      const result = await this.#failover.execute(ordered, async (provider) => {
        const adapted = this.#adapter.adapt(provider.id, {
          ...request,
          model: request.model || provider.models[0],
        });

        // Execute request hooks
        await this.#executeRequestHooks(request, provider);

        const startTime = Date.now();
        const rawResponse = await this.#httpClient(provider, adapted, timeout);
        const latencyMs = Date.now() - startTime;

        // Record performance metrics
        this.#router.recordLatency(provider.id, latencyMs);
        this.#registry.recordSuccess(provider.id, latencyMs);

        const normalized = this.#normalizer.normalize(provider.id, rawResponse, {
          model: request.model || provider.models[0],
          latencyMs,
        });

        // Execute response hooks
        await this.#executeResponseHooks(normalized, request, provider);

        // Log request if logger is enabled
        if (this.#requestLogger) {
          const providerConfig = this.#registry.get(provider.id);
          const cost = this.#calculateCost(normalized.usage, providerConfig);
          this.#requestLogger.log({
            timestamp: Date.now(),
            provider: provider.id,
            model: normalized.model,
            prompt: request.messages,
            latencyMs: normalized.latencyMs,
            status: 'success',
            usage: normalized.usage,
            cost,
          });
        }

        return normalized;
      });

      let response = result.response;

      // Apply middleware (post-response)
      for (const mw of this.#middleware) {
        try {
          response = await mw(response, { stage: 'response' }) || response;
        } catch (err) {
          console.error(`Middleware error (response): ${err.message}`);
        }
      }

      return response;
    } catch (err) {
      // Log failed request if logger is enabled
      if (this.#requestLogger) {
        this.#requestLogger.log({
          timestamp: Date.now(),
          provider: null,
          model: null,
          prompt: request.messages,
          latencyMs: 0,
          status: 'error',
          error: err.message,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          cost: 0,
        });
      }

      // Sanitize error (don't leak API keys)
      const sanitizedError = this.#sanitizeError(err);
      if (sanitizedError.attempts) throw sanitizedError;
      const error = new Error(`Chat request failed: ${sanitizedError.message}`);
      error.cause = sanitizedError;
      if (sanitizedError.attempts) error.attempts = sanitizedError.attempts;
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

  /** Get the health dashboard. */
  get healthDashboard() { return this.#healthDashboard; }

  /** Get the request logger. */
  get requestLogger() { return this.#requestLogger; }

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
        healthStats: this.#registry.getHealthStats(p.id),
        latencyStats: this.#registry.getLatencyStats(p.id),
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

  /** Sanitize error messages (remove API keys and sensitive data). */
  #sanitizeError(err) {
    if (!err) return err;

    const sensitivePatterns = [
      /sk-[a-zA-Z0-9]{20,}/g,  // Anthropic/OpenAI API keys
      /AIza[a-zA-Z0-9_-]{35}/g,  // Google API keys
      /Bearer\s+[a-zA-Z0-9_-]+/g,  // Bearer tokens
      /x-api-key:\s*[^\s]+/gi,  // API key headers
      /Authorization:\s*[^\s]+/gi,  // Auth headers
    ];

    // Clone error object
    const sanitized = new Error(err.message);
    sanitized.name = err.name;
    sanitized.stack = err.stack;
    sanitized.cause = err.cause;
    sanitized.statusCode = err.statusCode;
    sanitized.attempts = err.attempts;

    // Sanitize message
    let message = sanitized.message || '';
    for (const pattern of sensitivePatterns) {
      message = message.replace(pattern, '[REDACTED]');
    }
    sanitized.message = message;

    // Sanitize stack
    if (sanitized.stack) {
      let stack = sanitized.stack;
      for (const pattern of sensitivePatterns) {
        stack = stack.replace(pattern, '[REDACTED]');
      }
      sanitized.stack = stack;
    }

    return sanitized;
  }

  /** Calculate cost based on token usage and provider pricing. */
  #calculateCost(usage, provider) {
    if (!usage || !provider) return 0;
    const inputCost = (usage.inputTokens / 1000) * (provider.costPer1kInput || 0);
    const outputCost = (usage.outputTokens / 1000) * (provider.costPer1kOutput || 0);
    return inputCost + outputCost;
  }
}

/** Default HTTP client using native fetch with timeout support. */
async function defaultHttpClient(provider, adaptedRequest, registry, timeoutMs = 30000) {
  // CRITICAL FIX: Get API key from registry (was previously not passed to HTTP client)
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
export { HealthDashboard } from './health-dashboard.mjs';
export { RequestLogger } from './request-logger.mjs';

export default Chimera;
