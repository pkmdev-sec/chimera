/**
 * CHIMERA — Request Adapter
 * Translate requests from a unified format into provider-specific formats.
 */

/**
 * Unified request schema:
 * {
 *   model: string,
 *   messages: [{ role: 'system'|'user'|'assistant', content: string|array }],
 *   maxTokens: number,
 *   temperature: number,
 *   topP: number,
 *   stream: boolean,
 *   tools: [{ name, description, parameters }],
 *   stopSequences: string[],
 * }
 */

const adapters = {};

// ── Anthropic ──────────────────────────────────────────────
adapters.anthropic = function adaptAnthropic(req) {
  const systemMsgs = req.messages.filter((m) => m.role === 'system');
  const nonSystemMsgs = req.messages.filter((m) => m.role !== 'system');

  const body = {
    model: req.model || 'claude-sonnet-4-6',
    messages: nonSystemMsgs.map((m) => ({
      role: m.role,
      content: adaptContentForAnthropic(m.content),
    })),
    max_tokens: req.maxTokens || 4096,
  };

  if (systemMsgs.length > 0) {
    body.system = systemMsgs.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c) => c.text || '').join('\n'))).join('\n');
  }
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.stream) body.stream = true;
  if (req.stopSequences) body.stop_sequences = req.stopSequences;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters || { type: 'object', properties: {} },
    }));
  }

  return {
    url: '/messages',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2024-10-22' },
    body,
  };
};

// ── OpenAI ─────────────────────────────────────────────────
adapters.openai = function adaptOpenAI(req) {
  const body = {
    model: req.model || 'gpt-4o',
    messages: req.messages.map((m) => ({
      role: m.role,
      content: adaptContentForOpenAI(m.content),
    })),
  };

  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.stream) body.stream = true;
  if (req.stopSequences) body.stop = req.stopSequences;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {} },
      },
    }));
  }

  return {
    url: '/chat/completions',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  };
};

// ── Google (Gemini) ────────────────────────────────────────
adapters.google = function adaptGoogle(req) {
  const contents = [];
  let systemInstruction = null;

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: typeof msg.content === 'string' ? msg.content : msg.content.map((c) => c.text || '').join('\n') }] };
      continue;
    }
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof msg.content === 'string' ? msg.content : msg.content.map((c) => c.text || '').join('\n') }],
    });
  }

  const model = req.model || 'gemini-2.0-flash';
  const body = {
    contents,
    generationConfig: {},
  };

  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (req.maxTokens) body.generationConfig.maxOutputTokens = req.maxTokens;
  if (req.temperature !== undefined) body.generationConfig.temperature = req.temperature;
  if (req.topP !== undefined) body.generationConfig.topP = req.topP;
  if (req.stopSequences) body.generationConfig.stopSequences = req.stopSequences;
  if (req.tools?.length) {
    body.tools = [{
      functionDeclarations: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {} },
      })),
    }];
  }

  return {
    url: `/models/${model}:generateContent`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  };
};

/** Adapt content for Anthropic format (supports text and image blocks). */
function adaptContentForAnthropic(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (typeof c === 'string') return { type: 'text', text: c };
      if (c.type === 'text') return c;
      if (c.type === 'image' || c.type === 'image_url') {
        // Convert OpenAI image_url format to Anthropic source format
        if (c.image_url?.url) {
          const url = c.image_url.url;
          if (url.startsWith('data:')) {
            const [mediaTypePart, base64Data] = url.split(',');
            const mediaType = mediaTypePart.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
            return {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data }
            };
          }
          return { type: 'image', source: { type: 'url', url } };
        }
        // Already in Anthropic format
        if (c.source) return c;
      }
      return c;
    });
  }
  return String(content);
}

/** Adapt content for OpenAI format (supports text and image_url). */
function adaptContentForOpenAI(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (typeof c === 'string') return { type: 'text', text: c };
      if (c.type === 'text') return c;
      if (c.type === 'image') {
        // Convert Anthropic source format to OpenAI image_url format
        if (c.source?.type === 'base64') {
          return {
            type: 'image_url',
            image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` }
          };
        }
        if (c.source?.type === 'url') {
          return { type: 'image_url', image_url: { url: c.source.url } };
        }
      }
      if (c.type === 'image_url') return c;
      return c;
    });
  }
  return String(content);
}

/** Generic content adapter for providers that only need text. */
function adaptContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (typeof c === 'string') return c;
      if (c.type === 'text') return c.text;
      return c;
    }).filter(Boolean);
  }
  return String(content);
}

export class RequestAdapter {
  #customAdapters = new Map();

  constructor() {
    for (const [id, fn] of Object.entries(adapters)) {
      this.#customAdapters.set(id, fn);
    }
  }

  /** Register a custom adapter for a provider. */
  registerAdapter(providerId, fn) {
    try {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error('Provider ID must be a non-empty string');
      }
      if (typeof fn !== 'function') {
        throw new Error('Adapter must be a function');
      }
      this.#customAdapters.set(providerId, fn);
      return this;
    } catch (err) {
      const error = new Error(`Failed to register adapter: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Adapt a unified request to a provider-specific format. */
  adapt(providerId, unifiedRequest) {
    try {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error('Provider ID must be a non-empty string');
      }
      const adapter = this.#customAdapters.get(providerId);
      if (!adapter) {
        throw new Error(`No adapter registered for provider: ${providerId}`);
      }
      if (!unifiedRequest?.messages?.length) {
        throw new Error('Request must contain at least one message');
      }
      return adapter(unifiedRequest);
    } catch (err) {
      const error = new Error(`Failed to adapt request: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** List all supported provider IDs. */
  listAdapters() {
    return [...this.#customAdapters.keys()];
  }

  /** Check if an adapter exists for a provider. */
  hasAdapter(providerId) {
    return this.#customAdapters.has(providerId);
  }
}

export default RequestAdapter;
