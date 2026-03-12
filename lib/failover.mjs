/**
 * CHIMERA — Failover
 * Automatic failover when a provider is down or returns errors.
 */

export class Failover {
  #maxRetries;
  #retryDelayMs;
  #backoffMultiplier;
  #jitterEnabled;
  #maxRetryBudgetMs;
  #circuitBreaker = new Map(); // providerId -> { failures, lastFailure, state }
  #circuitThreshold;
  #circuitResetMs;
  #onFailover;
  #retryPolicies = new Map(); // providerId -> { maxRetries, backoffMultiplier, jitter }

  constructor(opts = {}) {
    this.#maxRetries = opts.maxRetries ?? 3;
    this.#retryDelayMs = opts.retryDelayMs ?? 1000;
    this.#backoffMultiplier = opts.backoffMultiplier ?? 2;
    this.#jitterEnabled = opts.jitter !== false; // Enabled by default
    this.#maxRetryBudgetMs = opts.maxRetryBudgetMs ?? 60000; // Max total retry time: 60s
    this.#circuitThreshold = opts.circuitThreshold ?? 5;
    this.#circuitResetMs = opts.circuitResetMs ?? 60000;
    this.#onFailover = opts.onFailover || null;
  }

  /** Set custom retry policy for a specific provider. */
  setRetryPolicy(providerId, policy) {
    try {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error('Provider ID must be a non-empty string');
      }
      if (!policy || typeof policy !== 'object') {
        throw new Error('Retry policy must be an object');
      }
      this.#retryPolicies.set(providerId, {
        maxRetries: policy.maxRetries ?? this.#maxRetries,
        backoffMultiplier: policy.backoffMultiplier ?? this.#backoffMultiplier,
        jitter: policy.jitter !== false,
      });
      return this;
    } catch (err) {
      const error = new Error(`Failed to set retry policy: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Get retry policy for a provider (falls back to defaults). */
  #getRetryPolicy(providerId) {
    return this.#retryPolicies.get(providerId) || {
      maxRetries: this.#maxRetries,
      backoffMultiplier: this.#backoffMultiplier,
      jitter: this.#jitterEnabled,
    };
  }

  /**
   * Execute a request with automatic failover across providers.
   * @param {object[]} providers - Ordered list of providers to try
   * @param {function} executeFn - async (provider) => response. Should throw on failure.
   * @returns {Promise<{ response: any, provider: object, attempts: object[] }>}
   */
  async execute(providers, executeFn) {
    try {
      if (!providers?.length) throw new Error('No providers available for failover');
      if (!Array.isArray(providers)) throw new Error('Providers must be an array');
      if (typeof executeFn !== 'function') throw new Error('executeFn must be a function');

    const attempts = [];
    const healthyProviders = providers.filter((p) => !this.#isCircuitOpen(p.id));

    // Try healthy providers first, then circuit-open ones as last resort
    const sortedProviders = [
      ...healthyProviders,
      ...providers.filter((p) => this.#isCircuitOpen(p.id)),
    ];

    const totalStartTime = Date.now();

    for (const provider of sortedProviders) {
      // Check retry budget
      const elapsedTotal = Date.now() - totalStartTime;
      if (elapsedTotal >= this.#maxRetryBudgetMs) {
        const budgetErr = new Error(`Retry budget exceeded: ${this.#maxRetryBudgetMs}ms`);
        budgetErr.attempts = attempts;
        throw budgetErr;
      }

      const policy = this.#getRetryPolicy(provider.id);
      let lastError = null;

      for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        const startTime = Date.now();
        try {
          const response = await executeFn(provider);
          this.#recordSuccess(provider.id);
          attempts.push({
            providerId: provider.id,
            attempt,
            success: true,
            latencyMs: Date.now() - startTime,
          });
          return { response, provider, attempts };
        } catch (err) {
          lastError = err;
          const latencyMs = Date.now() - startTime;
          attempts.push({
            providerId: provider.id,
            attempt,
            success: false,
            error: err.message,
            errorType: this.#classifyError(err),
            latencyMs,
          });

          // Per-error-type retry decisions
          if (!this.#shouldRetry(err)) break;

          // If retryable and not last attempt, wait with exponential backoff + jitter
          if (attempt < policy.maxRetries) {
            const delay = this.#calculateBackoff(attempt, policy);
            await this.#sleep(delay);
          }
        }
      }

      // All retries exhausted for this provider
      this.#recordFailure(provider.id);

      // Notify failover callback
      if (this.#onFailover) {
        try {
          this.#onFailover({ fromProvider: provider.id, error: lastError?.message });
        } catch { /* ignore callback errors */ }
      }
    }

      // All providers failed
      const err = new Error(`All providers failed after ${attempts.length} total attempts`);
      err.attempts = attempts;
      throw err;
    } catch (err) {
      // If error already has attempts, rethrow as-is
      if (err.attempts) throw err;
      // Otherwise wrap it
      const error = new Error(`Failover execution failed: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Classify error type for better retry decisions. */
  #classifyError(err) {
    if (err.statusCode === 429) return 'rate_limit';
    if (err.statusCode === 503) return 'service_unavailable';
    if (err.statusCode >= 500) return 'server_error';
    if (err.statusCode === 400) return 'bad_request';
    if (err.statusCode === 401 || err.statusCode === 403) return 'auth_error';
    if (err.statusCode === 404) return 'not_found';

    const msg = (err.message || '').toLowerCase();
    if (msg.includes('timeout')) return 'timeout';
    if (msg.includes('network') || msg.includes('econnrefused')) return 'network_error';
    if (msg.includes('rate limit')) return 'rate_limit';

    return 'unknown';
  }

  /** Per-error-type retry decisions (retry on 429/503, don't retry on 400/401). */
  #shouldRetry(err) {
    const errorType = this.#classifyError(err);

    // Don't retry client errors (400, 401, 403, 404)
    if (['bad_request', 'auth_error', 'not_found'].includes(errorType)) {
      return false;
    }

    // Retry on rate limits, server errors, timeouts, network errors
    if (['rate_limit', 'service_unavailable', 'server_error', 'timeout', 'network_error'].includes(errorType)) {
      return true;
    }

    // Legacy fallback for backwards compatibility
    return this.#isRetryable(err);
  }

  /** Check if an error is retryable (legacy method, kept for backwards compatibility). */
  #isRetryable(err) {
    if (err.statusCode) {
      return err.statusCode === 429 || err.statusCode >= 500;
    }
    const msg = (err.message || '').toLowerCase();
    return msg.includes('timeout') || msg.includes('rate limit') ||
           msg.includes('server error') || msg.includes('econnrefused') ||
           msg.includes('network') || msg.includes('503') || msg.includes('429');
  }

  /** Calculate exponential backoff with jitter. */
  #calculateBackoff(attempt, policy) {
    const baseDelay = this.#retryDelayMs * Math.pow(policy.backoffMultiplier, attempt);

    if (!policy.jitter) {
      return baseDelay;
    }

    // Add jitter: random value between 0.5x and 1.5x of base delay
    const jitterFactor = 0.5 + Math.random();
    return Math.floor(baseDelay * jitterFactor);
  }

  /** Circuit breaker: check if circuit is open for a provider. */
  #isCircuitOpen(providerId) {
    const state = this.#circuitBreaker.get(providerId);
    if (!state || state.state !== 'open') return false;
    // Check if enough time passed to half-open
    if (Date.now() - state.lastFailure >= this.#circuitResetMs) {
      state.state = 'half-open';
      return false;
    }
    return true;
  }

  #recordSuccess(providerId) {
    this.#circuitBreaker.set(providerId, { failures: 0, lastFailure: 0, state: 'closed' });
  }

  #recordFailure(providerId) {
    const state = this.#circuitBreaker.get(providerId) || { failures: 0, lastFailure: 0, state: 'closed' };
    state.failures++;
    state.lastFailure = Date.now();
    if (state.failures >= this.#circuitThreshold) {
      state.state = 'open';
    }
    this.#circuitBreaker.set(providerId, state);
  }

  /** Get circuit breaker status for a provider. */
  getCircuitState(providerId) {
    const state = this.#circuitBreaker.get(providerId);
    if (!state) return { state: 'closed', failures: 0 };
    // Refresh half-open
    if (state.state === 'open' && Date.now() - state.lastFailure >= this.#circuitResetMs) {
      state.state = 'half-open';
    }
    return { ...state };
  }

  /** Reset circuit breaker for a provider. */
  resetCircuit(providerId) {
    try {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error('Provider ID must be a non-empty string');
      }
      this.#circuitBreaker.delete(providerId);
      return this;
    } catch (err) {
      const error = new Error(`Failed to reset circuit: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Reset all circuit breakers. */
  resetAll() {
    try {
      this.#circuitBreaker.clear();
      return this;
    } catch (err) {
      const error = new Error(`Failed to reset all circuits: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default Failover;
