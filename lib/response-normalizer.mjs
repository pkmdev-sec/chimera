/**
 * CHIMERA — Response Normalizer
 * Normalize responses from different providers into a unified format.
 *
 * Unified response:
 * {
 *   id: string,
 *   provider: string,
 *   model: string,
 *   content: string,
 *   role: 'assistant',
 *   finishReason: 'stop' | 'max_tokens' | 'tool_use' | 'error',
 *   toolCalls: [{ id, name, arguments }],
 *   usage: {
 *     inputTokens, outputTokens, totalTokens,
 *     prompt_tokens, completion_tokens, total_tokens  // Normalized fields
 *   },
 *   cost: { input, output, total },  // Estimated cost in USD
 *   metadata: { modelVersion, providerId, timestamp },
 *   latencyMs: number,
 *   raw: object,
 * }
 */

const normalizers = {};

// ── Anthropic ──────────────────────────────────────────────
normalizers.anthropic = function normalizeAnthropic(raw, meta = {}) {
  // Handle error responses
  if (raw.error || raw.type === 'error') {
    return {
      id: meta.id || generateId(),
      provider: 'anthropic',
      model: meta.model || 'unknown',
      content: '',
      role: 'assistant',
      finishReason: 'error',
      toolCalls: [],
      usage: createNormalizedUsage(0, 0, 0),
      cost: { input: 0, output: 0, total: 0 },
      metadata: createMetadata('anthropic', meta.model || 'unknown'),
      latencyMs: meta.latencyMs || 0,
      error: raw.error?.message || raw.message || 'Unknown error',
      raw,
    };
  }

  const textBlocks = (raw.content || []).filter((b) => b.type === 'text');
  const toolBlocks = (raw.content || []).filter((b) => b.type === 'tool_use');

  const inputTokens = raw.usage?.input_tokens || 0;
  const outputTokens = raw.usage?.output_tokens || 0;
  const totalTokens = inputTokens + outputTokens;

  return {
    id: raw.id || meta.id || generateId(),
    provider: 'anthropic',
    model: raw.model || meta.model || 'unknown',
    content: textBlocks.map((b) => b.text).join(''),
    role: 'assistant',
    finishReason: mapFinishReason('anthropic', raw.stop_reason),
    toolCalls: toolBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      arguments: b.input,
    })),
    usage: createNormalizedUsage(inputTokens, outputTokens, totalTokens),
    cost: estimateCost('anthropic', inputTokens, outputTokens, meta.providerConfig),
    metadata: createMetadata('anthropic', raw.model || meta.model || 'unknown'),
    latencyMs: meta.latencyMs || 0,
    raw,
  };
};

// ── OpenAI ─────────────────────────────────────────────────
normalizers.openai = function normalizeOpenAI(raw, meta = {}) {
  // Handle error responses
  if (raw.error) {
    return {
      id: meta.id || generateId(),
      provider: 'openai',
      model: meta.model || 'unknown',
      content: '',
      role: 'assistant',
      finishReason: 'error',
      toolCalls: [],
      usage: createNormalizedUsage(0, 0, 0),
      cost: { input: 0, output: 0, total: 0 },
      metadata: createMetadata('openai', meta.model || 'unknown'),
      latencyMs: meta.latencyMs || 0,
      error: raw.error?.message || raw.error || 'Unknown error',
      raw,
    };
  }

  const choice = raw.choices?.[0] || {};
  const message = choice.message || {};
  const toolCalls = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: tryParseJSON(tc.function?.arguments),
  }));

  const inputTokens = raw.usage?.prompt_tokens || 0;
  const outputTokens = raw.usage?.completion_tokens || 0;
  const totalTokens = raw.usage?.total_tokens || (inputTokens + outputTokens);

  return {
    id: raw.id || meta.id || generateId(),
    provider: 'openai',
    model: raw.model || meta.model || 'unknown',
    content: message.content || '',
    role: 'assistant',
    finishReason: mapFinishReason('openai', choice.finish_reason),
    toolCalls,
    usage: createNormalizedUsage(inputTokens, outputTokens, totalTokens),
    cost: estimateCost('openai', inputTokens, outputTokens, meta.providerConfig),
    metadata: createMetadata('openai', raw.model || meta.model || 'unknown'),
    latencyMs: meta.latencyMs || 0,
    raw,
  };
};

// ── Google (Gemini) ────────────────────────────────────────
normalizers.google = function normalizeGoogle(raw, meta = {}) {
  // Handle error responses
  if (raw.error) {
    return {
      id: meta.id || generateId(),
      provider: 'google',
      model: meta.model || 'unknown',
      content: '',
      role: 'assistant',
      finishReason: 'error',
      toolCalls: [],
      usage: createNormalizedUsage(0, 0, 0),
      cost: { input: 0, output: 0, total: 0 },
      metadata: createMetadata('google', meta.model || 'unknown'),
      latencyMs: meta.latencyMs || 0,
      error: raw.error?.message || raw.error || 'Unknown error',
      raw,
    };
  }

  const candidate = raw.candidates?.[0] || {};
  const parts = candidate.content?.parts || [];
  const textParts = parts.filter((p) => p.text !== undefined);
  const fnParts = parts.filter((p) => p.functionCall);

  const inputTokens = raw.usageMetadata?.promptTokenCount || 0;
  const outputTokens = raw.usageMetadata?.candidatesTokenCount || 0;
  const totalTokens = raw.usageMetadata?.totalTokenCount || (inputTokens + outputTokens);

  return {
    id: meta.id || generateId(),
    provider: 'google',
    model: meta.model || 'unknown',
    content: textParts.map((p) => p.text).join(''),
    role: 'assistant',
    finishReason: mapFinishReason('google', candidate.finishReason),
    toolCalls: fnParts.map((p) => ({
      id: generateId(),
      name: p.functionCall.name,
      arguments: p.functionCall.args || {},
    })),
    usage: createNormalizedUsage(inputTokens, outputTokens, totalTokens),
    cost: estimateCost('google', inputTokens, outputTokens, meta.providerConfig),
    metadata: createMetadata('google', meta.model || meta.model || 'unknown'),
    latencyMs: meta.latencyMs || 0,
    raw,
  };
};

/** Map provider-specific finish reasons to unified set. */
function mapFinishReason(provider, reason) {
  if (!reason) return 'stop';
  const map = {
    anthropic: { end_turn: 'stop', max_tokens: 'max_tokens', tool_use: 'tool_use', stop_sequence: 'stop' },
    openai: { stop: 'stop', length: 'max_tokens', tool_calls: 'tool_use', content_filter: 'stop' },
    google: { STOP: 'stop', MAX_TOKENS: 'max_tokens', SAFETY: 'stop', RECITATION: 'stop' },
  };
  return map[provider]?.[reason] || 'stop';
}

function generateId() {
  // Use crypto.randomUUID for better uniqueness
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return 'chm_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  // Fallback for older environments
  return 'chm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function tryParseJSON(str) {
  if (typeof str !== 'string') return str;
  try { return JSON.parse(str); } catch { return str; }
}

/** Create normalized usage object with both old and new field names. */
function createNormalizedUsage(inputTokens, outputTokens, totalTokens) {
  return {
    // Legacy fields
    inputTokens,
    outputTokens,
    totalTokens,
    // Normalized standard fields (OpenAI-compatible)
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

/** Estimate cost based on token counts and provider pricing. */
function estimateCost(provider, inputTokens, outputTokens, providerConfig) {
  // Default costs per 1k tokens (can be overridden by providerConfig)
  const defaultCosts = {
    anthropic: { input: 0.015, output: 0.075 },  // Claude Sonnet 4.6 pricing
    openai: { input: 0.005, output: 0.015 },     // GPT-4o pricing
    google: { input: 0.00125, output: 0.005 },   // Gemini 2.0 Flash pricing
  };

  const costs = providerConfig || defaultCosts[provider] || { input: 0, output: 0 };
  const inputCost = (inputTokens / 1000) * costs.input;
  const outputCost = (outputTokens / 1000) * costs.output;

  return {
    input: inputCost,
    output: outputCost,
    total: inputCost + outputCost,
  };
}

/** Create metadata object with provider info and timestamp. */
function createMetadata(providerId, modelVersion) {
  return {
    providerId,
    modelVersion,
    timestamp: new Date().toISOString(),
  };
}

export class ResponseNormalizer {
  #customNormalizers = new Map();
  #providerConfigs = new Map(); // providerId -> { input: cost, output: cost }

  constructor() {
    for (const [id, fn] of Object.entries(normalizers)) {
      this.#customNormalizers.set(id, fn);
    }
  }

  /** Set cost configuration for a provider (cost per 1k tokens). */
  setProviderCost(providerId, inputCostPer1k, outputCostPer1k) {
    try {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error('Provider ID must be a non-empty string');
      }
      if (typeof inputCostPer1k !== 'number' || inputCostPer1k < 0) {
        throw new Error('Input cost must be a non-negative number');
      }
      if (typeof outputCostPer1k !== 'number' || outputCostPer1k < 0) {
        throw new Error('Output cost must be a non-negative number');
      }
      this.#providerConfigs.set(providerId, {
        input: inputCostPer1k,
        output: outputCostPer1k,
      });
      return this;
    } catch (err) {
      const error = new Error(`Failed to set provider cost: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Register a custom normalizer. */
  registerNormalizer(providerId, fn) {
    try {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error('Provider ID must be a non-empty string');
      }
      if (typeof fn !== 'function') {
        throw new Error('Normalizer must be a function');
      }
      this.#customNormalizers.set(providerId, fn);
      return this;
    } catch (err) {
      const error = new Error(`Failed to register normalizer: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Normalize a raw provider response. */
  normalize(providerId, rawResponse, meta = {}) {
    try {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error('Provider ID must be a non-empty string');
      }
      if (!rawResponse || typeof rawResponse !== 'object') {
        throw new Error('Raw response must be an object');
      }
      const normalizer = this.#customNormalizers.get(providerId);
      if (!normalizer) {
        throw new Error(`No normalizer registered for provider: ${providerId}`);
      }

      // Add provider cost config to meta if available
      const providerConfig = this.#providerConfigs.get(providerId);
      if (providerConfig) {
        meta.providerConfig = providerConfig;
      }

      return normalizer(rawResponse, meta);
    } catch (err) {
      const error = new Error(`Failed to normalize response: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Check if a normalizer exists. */
  hasNormalizer(providerId) {
    return this.#customNormalizers.has(providerId);
  }

  /** List supported provider IDs. */
  listNormalizers() {
    return [...this.#customNormalizers.keys()];
  }
}

export default ResponseNormalizer;
