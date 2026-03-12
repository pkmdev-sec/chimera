import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Chimera, Strategy } from '../lib/unified-api.mjs';

/** Create a Chimera instance with a mock HTTP client. */
function createMockChimera(httpClient, opts = {}) {
  return new Chimera({
    httpClient,
    ...opts,
  });
}

/** Mock Anthropic API response. */
function mockAnthropicResponse() {
  return {
    id: 'msg_test',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'Hello from Anthropic!' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

/** Mock OpenAI API response. */
function mockOpenAIResponse() {
  return {
    id: 'chatcmpl-test',
    model: 'gpt-4o',
    choices: [{ message: { role: 'assistant', content: 'Hello from OpenAI!' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 },
  };
}

describe('Chimera (Unified API)', () => {
  it('creates with default components', () => {
    const chimera = new Chimera();
    assert.ok(chimera.registry);
    assert.ok(chimera.adapter);
    assert.ok(chimera.normalizer);
    assert.ok(chimera.router);
    assert.ok(chimera.failover);
  });

  it('sets API keys via constructor', () => {
    const chimera = new Chimera({ apiKeys: { anthropic: 'sk-test' } });
    assert.equal(chimera.registry.getApiKey('anthropic'), 'sk-test');
  });

  it('sets API key via method', () => {
    const chimera = new Chimera();
    chimera.setApiKey('openai', 'sk-openai');
    assert.equal(chimera.registry.getApiKey('openai'), 'sk-openai');
  });

  it('sets routing strategy', () => {
    const chimera = new Chimera();
    chimera.setStrategy(Strategy.COST);
    assert.equal(chimera.router.getStrategy(), Strategy.COST);
  });

  it('chat() sends request and returns normalized response', async () => {
    const chimera = createMockChimera(async (provider) => {
      if (provider.id === 'anthropic') return mockAnthropicResponse();
      if (provider.id === 'openai') return mockOpenAIResponse();
      return {
        candidates: [{ content: { parts: [{ text: 'Hello from Google!' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
      };
    });

    const response = await chimera.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    assert.ok(response.content);
    assert.equal(response.role, 'assistant');
    assert.ok(response.usage);
    assert.ok(response.id);
  });

  it('chat() routes to specific provider', async () => {
    const chimera = createMockChimera(async (provider) => {
      if (provider.id === 'openai') return mockOpenAIResponse();
      throw new Error('Should not reach here');
    });

    const response = await chimera.chat(
      { messages: [{ role: 'user', content: 'Hello' }] },
      { provider: 'openai' },
    );

    assert.equal(response.provider, 'openai');
    assert.equal(response.content, 'Hello from OpenAI!');
  });

  it('chat() fails over on error', async () => {
    let callCount = 0;
    const chimera = createMockChimera(async (provider) => {
      callCount++;
      if (provider.id === 'anthropic') {
        const err = new Error('server error');
        err.statusCode = 500;
        throw err;
      }
      return mockOpenAIResponse();
    }, { failoverOpts: { maxRetries: 0 } });

    // Force anthropic first via quality routing
    chimera.setStrategy(Strategy.QUALITY);
    const response = await chimera.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    assert.ok(callCount >= 2);
    assert.equal(response.content, 'Hello from OpenAI!');
  });

  it('chat() throws on empty messages', async () => {
    const chimera = new Chimera();
    await assert.rejects(
      () => chimera.chat({ messages: [] }),
      /at least one message/,
    );
  });

  it('chat() throws for unknown provider', async () => {
    const chimera = new Chimera();
    await assert.rejects(
      () => chimera.chat({ messages: [{ role: 'user', content: 'Hi' }] }, { provider: 'unknown' }),
      /not found/,
    );
  });

  it('ask() is a shortcut for single-message chat', async () => {
    const chimera = createMockChimera(async (provider) => {
      if (provider.id === 'anthropic') return mockAnthropicResponse();
      if (provider.id === 'openai') return mockOpenAIResponse();
      return {
        candidates: [{ content: { parts: [{ text: 'Hello from Google!' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
      };
    });
    const response = await chimera.ask('Hello');
    assert.ok(response.content);
  });

  it('registerProvider() adds custom provider', () => {
    const chimera = new Chimera();
    chimera.registerProvider('custom', {
      name: 'Custom',
      baseUrl: 'https://api.custom.com',
      models: ['custom-1'],
    });
    const p = chimera.registry.get('custom');
    assert.equal(p.name, 'Custom');
  });

  it('status() returns provider overview', () => {
    const chimera = new Chimera();
    const statuses = chimera.status();
    assert.ok(Array.isArray(statuses));
    assert.ok(statuses.length >= 3);
    assert.ok(statuses[0].id);
    assert.ok(statuses[0].circuit);
    assert.ok(statuses[0].models);
  });
});
