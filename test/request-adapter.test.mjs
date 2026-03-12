import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RequestAdapter } from '../lib/request-adapter.mjs';

const basicRequest = {
  model: 'test-model',
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello' },
  ],
  maxTokens: 1024,
  temperature: 0.7,
};

describe('RequestAdapter', () => {
  it('lists built-in adapters', () => {
    const adapter = new RequestAdapter();
    const ids = adapter.listAdapters().sort();
    assert.deepEqual(ids, ['anthropic', 'google', 'openai']);
  });

  it('checks adapter existence', () => {
    const adapter = new RequestAdapter();
    assert.equal(adapter.hasAdapter('anthropic'), true);
    assert.equal(adapter.hasAdapter('nonexistent'), false);
  });

  // ── Anthropic adapter ──
  it('adapts request for Anthropic', () => {
    const adapter = new RequestAdapter();
    const result = adapter.adapt('anthropic', basicRequest);
    assert.equal(result.url, '/messages');
    assert.equal(result.method, 'POST');
    assert.equal(result.body.model, 'test-model');
    assert.equal(result.body.max_tokens, 1024);
    assert.equal(result.body.temperature, 0.7);
    assert.ok(result.body.system.includes('You are helpful'));
    assert.equal(result.body.messages.length, 1); // system removed
    assert.equal(result.body.messages[0].role, 'user');
  });

  it('adapts Anthropic with tools', () => {
    const adapter = new RequestAdapter();
    const req = {
      ...basicRequest,
      tools: [{ name: 'search', description: 'Search web', parameters: { type: 'object', properties: { q: { type: 'string' } } } }],
    };
    const result = adapter.adapt('anthropic', req);
    assert.equal(result.body.tools.length, 1);
    assert.equal(result.body.tools[0].name, 'search');
    assert.ok(result.body.tools[0].input_schema);
  });

  // ── OpenAI adapter ──
  it('adapts request for OpenAI', () => {
    const adapter = new RequestAdapter();
    const result = adapter.adapt('openai', basicRequest);
    assert.equal(result.url, '/chat/completions');
    assert.equal(result.body.model, 'test-model');
    assert.equal(result.body.max_tokens, 1024);
    assert.equal(result.body.messages.length, 2); // system kept
    assert.equal(result.body.messages[0].role, 'system');
  });

  it('adapts OpenAI with tools', () => {
    const adapter = new RequestAdapter();
    const req = {
      ...basicRequest,
      tools: [{ name: 'calc', description: 'Calculate', parameters: { type: 'object' } }],
    };
    const result = adapter.adapt('openai', req);
    assert.equal(result.body.tools[0].type, 'function');
    assert.equal(result.body.tools[0].function.name, 'calc');
  });

  it('adapts OpenAI with stream and stop sequences', () => {
    const adapter = new RequestAdapter();
    const req = { ...basicRequest, stream: true, stopSequences: ['END'] };
    const result = adapter.adapt('openai', req);
    assert.equal(result.body.stream, true);
    assert.deepEqual(result.body.stop, ['END']);
  });

  // ── Google adapter ──
  it('adapts request for Google', () => {
    const adapter = new RequestAdapter();
    const result = adapter.adapt('google', basicRequest);
    assert.ok(result.url.includes('generateContent'));
    assert.ok(result.body.systemInstruction);
    assert.equal(result.body.contents.length, 1); // only user message
    assert.equal(result.body.contents[0].role, 'user');
    assert.equal(result.body.generationConfig.maxOutputTokens, 1024);
  });

  it('adapts Google with tools', () => {
    const adapter = new RequestAdapter();
    const req = {
      ...basicRequest,
      tools: [{ name: 'lookup', description: 'Look up', parameters: { type: 'object' } }],
    };
    const result = adapter.adapt('google', req);
    assert.equal(result.body.tools[0].functionDeclarations[0].name, 'lookup');
  });

  // ── Custom adapter ──
  it('registers and uses a custom adapter', () => {
    const adapter = new RequestAdapter();
    adapter.registerAdapter('custom', (req) => ({ url: '/custom', body: { prompt: req.messages[0].content } }));
    const result = adapter.adapt('custom', { messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(result.url, '/custom');
    assert.equal(result.body.prompt, 'Hi');
  });

  // ── Error handling ──
  it('throws for unknown provider', () => {
    const adapter = new RequestAdapter();
    assert.throws(() => adapter.adapt('unknown', basicRequest), /No adapter/);
  });

  it('throws for empty messages', () => {
    const adapter = new RequestAdapter();
    assert.throws(() => adapter.adapt('openai', { messages: [] }), /at least one message/);
  });

  it('throws on non-function adapter registration', () => {
    const adapter = new RequestAdapter();
    assert.throws(() => adapter.registerAdapter('x', 'not-fn'), /must be a function/);
  });
});
