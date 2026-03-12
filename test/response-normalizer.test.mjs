import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResponseNormalizer } from '../lib/response-normalizer.mjs';

describe('ResponseNormalizer', () => {
  it('lists built-in normalizers', () => {
    const norm = new ResponseNormalizer();
    assert.deepEqual(norm.listNormalizers().sort(), ['anthropic', 'google', 'openai']);
  });

  it('checks normalizer existence', () => {
    const norm = new ResponseNormalizer();
    assert.equal(norm.hasNormalizer('anthropic'), true);
    assert.equal(norm.hasNormalizer('nope'), false);
  });

  // ── Anthropic ──
  it('normalizes Anthropic response', () => {
    const norm = new ResponseNormalizer();
    const raw = {
      id: 'msg_123',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'Hello there!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 },
    };
    const result = norm.normalize('anthropic', raw, { latencyMs: 150 });
    assert.equal(result.id, 'msg_123');
    assert.equal(result.provider, 'anthropic');
    assert.equal(result.model, 'claude-sonnet-4-6');
    assert.equal(result.content, 'Hello there!');
    assert.equal(result.role, 'assistant');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 20);
    assert.equal(result.usage.totalTokens, 30);
    assert.equal(result.latencyMs, 150);
    assert.deepEqual(result.toolCalls, []);
  });

  it('normalizes Anthropic tool_use response', () => {
    const norm = new ResponseNormalizer();
    const raw = {
      id: 'msg_456',
      model: 'claude-opus-4-6',
      content: [
        { type: 'text', text: 'Let me search.' },
        { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'test' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 15 },
    };
    const result = norm.normalize('anthropic', raw);
    assert.equal(result.content, 'Let me search.');
    assert.equal(result.finishReason, 'tool_use');
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, 'search');
    assert.deepEqual(result.toolCalls[0].arguments, { q: 'test' });
  });

  // ── OpenAI ──
  it('normalizes OpenAI response', () => {
    const norm = new ResponseNormalizer();
    const raw = {
      id: 'chatcmpl-abc',
      model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'Hi!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 },
    };
    const result = norm.normalize('openai', raw, { latencyMs: 200 });
    assert.equal(result.id, 'chatcmpl-abc');
    assert.equal(result.provider, 'openai');
    assert.equal(result.content, 'Hi!');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.totalTokens, 20);
    assert.equal(result.latencyMs, 200);
  });

  it('normalizes OpenAI tool_calls response', () => {
    const norm = new ResponseNormalizer();
    const raw = {
      id: 'chatcmpl-xyz',
      model: 'gpt-4o',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"NYC"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const result = norm.normalize('openai', raw);
    assert.equal(result.content, '');
    assert.equal(result.finishReason, 'tool_use');
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, 'get_weather');
    assert.deepEqual(result.toolCalls[0].arguments, { city: 'NYC' });
  });

  // ── Google ──
  it('normalizes Google Gemini response', () => {
    const norm = new ResponseNormalizer();
    const raw = {
      candidates: [{ content: { parts: [{ text: 'Greetings!' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 10, totalTokenCount: 16 },
    };
    const result = norm.normalize('google', raw, { model: 'gemini-2.0-flash', latencyMs: 100 });
    assert.equal(result.provider, 'google');
    assert.equal(result.model, 'gemini-2.0-flash');
    assert.equal(result.content, 'Greetings!');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.totalTokens, 16);
  });

  it('normalizes Google function call response', () => {
    const norm = new ResponseNormalizer();
    const raw = {
      candidates: [{
        content: {
          parts: [{ functionCall: { name: 'find_place', args: { query: 'coffee' } } }],
        },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8, totalTokenCount: 13 },
    };
    const result = norm.normalize('google', raw);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, 'find_place');
  });

  // ── Custom normalizer ──
  it('registers and uses a custom normalizer', () => {
    const norm = new ResponseNormalizer();
    norm.registerNormalizer('custom', (raw) => ({ id: 'c1', provider: 'custom', content: raw.text, role: 'assistant' }));
    const result = norm.normalize('custom', { text: 'Custom response' });
    assert.equal(result.content, 'Custom response');
  });

  // ── Errors ──
  it('throws for unknown provider', () => {
    const norm = new ResponseNormalizer();
    assert.throws(() => norm.normalize('unknown', {}), /No normalizer/);
  });

  it('throws on non-function normalizer', () => {
    const norm = new ResponseNormalizer();
    assert.throws(() => norm.registerNormalizer('x', 42), /must be a function/);
  });

  // ── Edge cases ──
  it('handles empty Anthropic response', () => {
    const norm = new ResponseNormalizer();
    const result = norm.normalize('anthropic', {});
    assert.equal(result.content, '');
    assert.equal(result.usage.totalTokens, 0);
  });

  it('handles empty OpenAI response', () => {
    const norm = new ResponseNormalizer();
    const result = norm.normalize('openai', {});
    assert.equal(result.content, '');
  });

  it('handles empty Google response', () => {
    const norm = new ResponseNormalizer();
    const result = norm.normalize('google', {});
    assert.equal(result.content, '');
  });
});
