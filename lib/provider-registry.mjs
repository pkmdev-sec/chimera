/**
 * CHIMERA — Provider Registry
 * Register, manage, and query multiple AI providers.
 */

const BUILTIN_PROVIDERS = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    authHeader: 'x-api-key',
    capabilities: ['chat', 'streaming', 'vision', 'tool_use'],
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    qualityScore: 95,
    maxTokens: 200000,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    capabilities: ['chat', 'streaming', 'vision', 'tool_use', 'embeddings'],
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
    qualityScore: 90,
    maxTokens: 128000,
  },
  google: {
    id: 'google',
    name: 'Google AI (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash', 'gemini-2.0-pro', 'gemini-1.5-pro'],
    authHeader: 'x-goog-api-key',
    capabilities: ['chat', 'streaming', 'vision', 'tool_use', 'embeddings'],
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
    qualityScore: 85,
    maxTokens: 1000000,
  },
};

export class ProviderRegistry {
  #providers = new Map();
  #apiKeys = new Map();
  #healthStats = new Map(); // providerId -> { successCount, failureCount, totalRequests, lastCheck }
  #latencyStats = new Map(); // providerId -> { samples: [], p50, p95, p99, avg }
  #healthCheckInterval = null;

  constructor(opts = {}) {
    if (opts.loadBuiltins !== false) {
      for (const [id, config] of Object.entries(BUILTIN_PROVIDERS)) {
        this.#providers.set(id, { ...config, enabled: true, healthy: true });
        this.#initHealthStats(id);
      }
    }

    // Start health check scheduling if enabled
    if (opts.healthCheckIntervalMs) {
      this.#startHealthChecks(opts.healthCheckIntervalMs);
    }
  }

  #initHealthStats(id) {
    this.#healthStats.set(id, {
      successCount: 0,
      failureCount: 0,
      totalRequests: 0,
      lastCheck: Date.now(),
      status: 'healthy', // 'healthy', 'degraded', 'unhealthy'
    });
    this.#latencyStats.set(id, {
      samples: [],
      p50: 0,
      p95: 0,
      p99: 0,
      avg: 0,
    });
  }

  /** Register a new provider or override an existing one. */
  register(id, config) {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Provider id must be a non-empty string');
      }
      if (!config || typeof config !== 'object') {
        throw new Error('Provider config must be an object');
      }
      const required = ['name', 'baseUrl', 'models'];
      for (const key of required) {
        if (!config[key]) {
          throw new Error(`Provider config missing required field: ${key}`);
        }
      }
      // Validate models is an array
      if (!Array.isArray(config.models) || config.models.length === 0) {
        throw new Error('Provider config models must be a non-empty array');
      }
      // Validate authHeader if provided
      if (config.authHeader && typeof config.authHeader !== 'string') {
        throw new Error('Provider config authHeader must be a string');
      }

      this.#providers.set(id, {
        id,
        capabilities: [],
        costPer1kInput: 0,
        costPer1kOutput: 0,
        qualityScore: 50,
        maxTokens: 4096,
        authHeader: 'Authorization',
        ...config,
        enabled: config.enabled !== false,
        healthy: true,
      });

      // Initialize health stats for new provider
      if (!this.#healthStats.has(id)) {
        this.#initHealthStats(id);
      }

      return this;
    } catch (err) {
      const error = new Error(`Failed to register provider: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Unregister a provider by id. */
  unregister(id) {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Provider id must be a non-empty string');
      }
      if (!this.#providers.has(id)) {
        throw new Error(`Provider not found: ${id}`);
      }
      this.#providers.delete(id);
      this.#apiKeys.delete(id);
      return this;
    } catch (err) {
      const error = new Error(`Failed to unregister provider: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Set the API key for a provider. */
  setApiKey(id, key) {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Provider id must be a non-empty string');
      }
      if (!key || typeof key !== 'string') {
        throw new Error('API key must be a non-empty string');
      }
      if (!this.#providers.has(id)) {
        throw new Error(`Provider not found: ${id}`);
      }
      this.#apiKeys.set(id, key);
      return this;
    } catch (err) {
      const error = new Error(`Failed to set API key: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Get the API key for a provider. */
  getApiKey(id) {
    return this.#apiKeys.get(id) || process.env[`${id.toUpperCase()}_API_KEY`] || null;
  }

  /** Get a single provider by id. */
  get(id) {
    const p = this.#providers.get(id);
    if (!p) return null;
    return { ...p };
  }

  /** List all registered providers. */
  list() {
    return [...this.#providers.values()].map((p) => ({ ...p }));
  }

  /** List only enabled and healthy providers. */
  listAvailable() {
    return this.list().filter((p) => p.enabled && p.healthy);
  }

  /** Enable or disable a provider. */
  setEnabled(id, enabled) {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Provider id must be a non-empty string');
      }
      const p = this.#providers.get(id);
      if (!p) throw new Error(`Provider not found: ${id}`);
      p.enabled = Boolean(enabled);
      return this;
    } catch (err) {
      const error = new Error(`Failed to set enabled: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Mark a provider as healthy or unhealthy. */
  setHealth(id, healthy) {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Provider id must be a non-empty string');
      }
      const p = this.#providers.get(id);
      if (!p) throw new Error(`Provider not found: ${id}`);
      p.healthy = Boolean(healthy);
      return this;
    } catch (err) {
      const error = new Error(`Failed to set health: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Find providers that support a given capability. */
  findByCapability(capability) {
    return this.listAvailable().filter((p) => p.capabilities.includes(capability));
  }

  /** Find providers that support a given model. */
  findByModel(model) {
    return this.listAvailable().filter((p) => p.models.includes(model));
  }

  /** Get the count of registered providers. */
  get size() {
    return this.#providers.size;
  }

  // ── Health Monitoring ────────────────────────────────────────

  /** Record a successful request for health monitoring. */
  recordSuccess(id, latencyMs) {
    try {
      const stats = this.#healthStats.get(id);
      if (stats) {
        stats.successCount++;
        stats.totalRequests++;
        this.#updateHealthStatus(id);
      }

      // Record latency
      if (latencyMs !== undefined && latencyMs >= 0) {
        this.recordLatency(id, latencyMs);
      }
    } catch (err) {
      // Don't throw on monitoring errors
      console.error(`Failed to record success: ${err.message}`);
    }
  }

  /** Record a failed request for health monitoring. */
  recordFailure(id) {
    try {
      const stats = this.#healthStats.get(id);
      if (stats) {
        stats.failureCount++;
        stats.totalRequests++;
        this.#updateHealthStatus(id);
      }
    } catch (err) {
      // Don't throw on monitoring errors
      console.error(`Failed to record failure: ${err.message}`);
    }
  }

  /** Record latency measurement for a provider. */
  recordLatency(id, latencyMs) {
    try {
      if (typeof latencyMs !== 'number' || latencyMs < 0) return;

      let stats = this.#latencyStats.get(id);
      if (!stats) {
        stats = { samples: [], p50: 0, p95: 0, p99: 0, avg: 0 };
        this.#latencyStats.set(id, stats);
      }

      stats.samples.push(latencyMs);
      // Keep last 100 samples
      if (stats.samples.length > 100) {
        stats.samples.shift();
      }

      // Calculate percentiles
      this.#calculateLatencyPercentiles(id);
    } catch (err) {
      console.error(`Failed to record latency: ${err.message}`);
    }
  }

  /** Calculate latency percentiles (p50, p95, p99, avg). */
  #calculateLatencyPercentiles(id) {
    const stats = this.#latencyStats.get(id);
    if (!stats || stats.samples.length === 0) return;

    const sorted = [...stats.samples].sort((a, b) => a - b);
    const len = sorted.length;

    stats.avg = sorted.reduce((a, b) => a + b, 0) / len;
    stats.p50 = sorted[Math.floor(len * 0.5)];
    stats.p95 = sorted[Math.floor(len * 0.95)];
    stats.p99 = sorted[Math.floor(len * 0.99)];
  }

  /** Get latency statistics for a provider. */
  getLatencyStats(id) {
    const stats = this.#latencyStats.get(id);
    if (!stats) return null;
    return { ...stats, samples: [...stats.samples] };
  }

  /** Get health statistics for a provider. */
  getHealthStats(id) {
    const stats = this.#healthStats.get(id);
    if (!stats) return null;
    return { ...stats };
  }

  /** Update health status based on success/failure rates. */
  #updateHealthStatus(id) {
    const stats = this.#healthStats.get(id);
    const provider = this.#providers.get(id);
    if (!stats || !provider) return;

    // Calculate success rate (only if we have enough data)
    if (stats.totalRequests < 5) {
      stats.status = 'healthy';
      provider.healthy = true;
      return;
    }

    const successRate = stats.successCount / stats.totalRequests;

    // Update status based on success rate
    if (successRate >= 0.95) {
      stats.status = 'healthy';
      provider.healthy = true;
    } else if (successRate >= 0.8) {
      stats.status = 'degraded';
      provider.healthy = true; // Still available, just degraded
    } else {
      stats.status = 'unhealthy';
      provider.healthy = false;
    }

    stats.lastCheck = Date.now();
  }

  /** Start periodic health checks. */
  #startHealthChecks(intervalMs) {
    if (this.#healthCheckInterval) {
      clearInterval(this.#healthCheckInterval);
    }

    this.#healthCheckInterval = setInterval(() => {
      for (const [id] of this.#providers) {
        this.#updateHealthStatus(id);
      }
    }, intervalMs);
  }

  /** Stop health check scheduling. */
  stopHealthChecks() {
    if (this.#healthCheckInterval) {
      clearInterval(this.#healthCheckInterval);
      this.#healthCheckInterval = null;
    }
  }

  /** Reset health statistics for a provider. */
  resetHealthStats(id) {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Provider id must be a non-empty string');
      }
      if (!this.#providers.has(id)) {
        throw new Error(`Provider not found: ${id}`);
      }
      this.#initHealthStats(id);
      return this;
    } catch (err) {
      const error = new Error(`Failed to reset health stats: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }
}

export default ProviderRegistry;
