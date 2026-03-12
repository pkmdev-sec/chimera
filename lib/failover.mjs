/**
 * CHIMERA — Failover
 * Automatic failover when a provider is down or returns errors.
 */

export class Failover {
  #maxRetries;
  #retryDelayMs;
  #backoffMultiplier;
  #circuitBreaker = new Map(); // providerId -> { failures, lastFailure, state }
  #circuitThreshold;
  #circuitResetMs;
  #onFailover;

  constructor(opts = {}) {
    this.#maxRetries = opts.maxRetries ?? 3;
    this.#retryDelayMs = opts.retryDelayMs ?? 1000;
    this.#backoffMultiplier = opts.backoffMultiplier ?? 2;
    this.#circuitThreshold = opts.circuitThreshold ?? 5;
    this.#circuitResetMs = opts.circuitResetMs ?? 60000;
    this.#onFailover = opts.onFailover || null;
  }

  /**
   * Execute a request with automatic failover across providers.
   * @param {object[]} providers - Ordered list of providers to try
   * @param {function} executeFn - async (provider) => response. Should throw on failure.
   * @returns {Promise<{ response: any, provider: object, attempts: object[] }>}
   */
  async execute(providers, executeFn) {
    if (!providers?.length) throw new Error('No providers available for failover');
    if (typeof executeFn !== 'function') throw new Error('executeFn must be a function');

    const attempts = [];
    const healthyProviders = providers.filter((p) => !this.#isCircuitOpen(p.id));

    // Try healthy providers first, then circuit-open ones as last resort
    const sortedProviders = [
      ...healthyProviders,
      ...providers.filter((p) => this.#isCircuitOpen(p.id)),
    ];

    for (const provider of sortedProviders) {
      let lastError = null;
      for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
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
            latencyMs,
          });

          // If not retryable, skip remaining retries for this provider
          if (!this.#isRetryable(err)) break;

          // If retryable and not last attempt, wait with backoff and retry
          if (attempt < this.#maxRetries) {
            const delay = this.#retryDelayMs * Math.pow(this.#backoffMultiplier, attempt);
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
  }

  /** Check if an error is retryable (rate limits, server errors). */
  #isRetryable(err) {
    if (err.statusCode) {
      return err.statusCode === 429 || err.statusCode >= 500;
    }
    const msg = (err.message || '').toLowerCase();
    return msg.includes('timeout') || msg.includes('rate limit') ||
           msg.includes('server error') || msg.includes('econnrefused') ||
           msg.includes('network') || msg.includes('503') || msg.includes('429');
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
    this.#circuitBreaker.delete(providerId);
    return this;
  }

  /** Reset all circuit breakers. */
  resetAll() {
    this.#circuitBreaker.clear();
    return this;
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default Failover;
