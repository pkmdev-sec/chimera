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

  constructor(opts = {}) {
    if (opts.loadBuiltins !== false) {
      for (const [id, config] of Object.entries(BUILTIN_PROVIDERS)) {
        this.#providers.set(id, { ...config, enabled: true, healthy: true });
      }
    }
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
}

export default ProviderRegistry;
