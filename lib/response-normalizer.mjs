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
 *   usage: { inputTokens, outputTokens, totalTokens },
 *   latencyMs: number,
 *   raw: object,
 * }
 */

const normalizers = {};

// ── Anthropic ──────────────────────────────────────────────
normalizers.anthropic = function normalizeAnthropic(raw, meta = {}) {
  const textBlocks = (raw.content || []).filter((b) => b.type === 'text');
  const toolBlocks = (raw.content || []).filter((b) => b.type === 'tool_use');

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
    usage: {
      inputTokens: raw.usage?.input_tokens || 0,
      outputTokens: raw.usage?.output_tokens || 0,
      totalTokens: (raw.usage?.input_tokens || 0) + (raw.usage?.output_tokens || 0),
    },
    latencyMs: meta.latencyMs || 0,
    raw,
  };
};

// ── OpenAI ─────────────────────────────────────────────────
normalizers.openai = function normalizeOpenAI(raw, meta = {}) {
  const choice = raw.choices?.[0] || {};
  const message = choice.message || {};
  const toolCalls = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: tryParseJSON(tc.function?.arguments),
  }));

  return {
    id: raw.id || meta.id || generateId(),
    provider: 'openai',
    model: raw.model || meta.model || 'unknown',
    content: message.content || '',
    role: 'assistant',
    finishReason: mapFinishReason('openai', choice.finish_reason),
    toolCalls,
    usage: {
      inputTokens: raw.usage?.prompt_tokens || 0,
      outputTokens: raw.usage?.completion_tokens || 0,
      totalTokens: raw.usage?.total_tokens || 0,
    },
    latencyMs: meta.latencyMs || 0,
    raw,
  };
};

// ── Google (Gemini) ────────────────────────────────────────
normalizers.google = function normalizeGoogle(raw, meta = {}) {
  const candidate = raw.candidates?.[0] || {};
  const parts = candidate.content?.parts || [];
  const textParts = parts.filter((p) => p.text !== undefined);
  const fnParts = parts.filter((p) => p.functionCall);

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
    usage: {
      inputTokens: raw.usageMetadata?.promptTokenCount || 0,
      outputTokens: raw.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: raw.usageMetadata?.totalTokenCount || 0,
    },
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
  return 'chm_' + Math.random().toString(36).slice(2, 14);
}

function tryParseJSON(str) {
  if (typeof str !== 'string') return str;
  try { return JSON.parse(str); } catch { return str; }
}

export class ResponseNormalizer {
  #customNormalizers = new Map();

  constructor() {
    for (const [id, fn] of Object.entries(normalizers)) {
      this.#customNormalizers.set(id, fn);
    }
  }

  /** Register a custom normalizer. */
  registerNormalizer(providerId, fn) {
    if (typeof fn !== 'function') throw new Error('Normalizer must be a function');
    this.#customNormalizers.set(providerId, fn);
    return this;
  }

  /** Normalize a raw provider response. */
  normalize(providerId, rawResponse, meta = {}) {
    const normalizer = this.#customNormalizers.get(providerId);
    if (!normalizer) throw new Error(`No normalizer registered for provider: ${providerId}`);
    return normalizer(rawResponse, meta);
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
