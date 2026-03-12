import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Router, Strategy } from '../lib/router.mjs';

const providers = [
  { id: 'anthropic', qualityScore: 95, costPer1kInput: 0.015, costPer1kOutput: 0.075, capabilities: ['chat', 'tool_use', 'streaming'] },
  { id: 'openai', qualityScore: 90, costPer1kInput: 0.005, costPer1kOutput: 0.015, capabilities: ['chat', 'tool_use', 'streaming'] },
  { id: 'google', qualityScore: 85, costPer1kInput: 0.00125, costPer1kOutput: 0.005, capabilities: ['chat', 'tool_use', 'streaming'] },
];

describe('Router', () => {
  it('defaults to balanced strategy', () => {
    const router = new Router();
    assert.equal(router.getStrategy(), Strategy.BALANCED);
  });

  it('selects by quality strategy', () => {
    const router = new Router({ strategy: Strategy.QUALITY });
    const selected = router.select(providers);
    assert.equal(selected.id, 'anthropic');
  });

  it('selects by cost strategy', () => {
    const router = new Router({ strategy: Strategy.COST });
    const selected = router.select(providers);
    assert.equal(selected.id, 'google'); // cheapest
  });

  it('selects by latency strategy', () => {
    const router = new Router({ strategy: Strategy.LATENCY });
    router.recordLatency('anthropic', 500);
    router.recordLatency('openai', 200);
    router.recordLatency('google', 300);
    const selected = router.select(providers);
    assert.equal(selected.id, 'openai'); // lowest latency
  });

  it('selects by round robin strategy', () => {
    const router = new Router({ strategy: Strategy.ROUND_ROBIN });
    const first = router.select(providers);
    const second = router.select(providers);
    const third = router.select(providers);
    const fourth = router.select(providers);
    assert.equal(first.id, 'anthropic');
    assert.equal(second.id, 'openai');
    assert.equal(third.id, 'google');
    assert.equal(fourth.id, 'anthropic'); // wraps around
  });

  it('selects by manual strategy', () => {
    const router = new Router({ strategy: Strategy.MANUAL });
    const selected = router.select(providers, {}, { providerId: 'google' });
    assert.equal(selected.id, 'google');
  });

  it('throws on manual without providerId', () => {
    const router = new Router({ strategy: Strategy.MANUAL });
    assert.throws(() => router.select(providers, {}), /requires providerId/);
  });

  it('throws on manual with unavailable provider', () => {
    const router = new Router({ strategy: Strategy.MANUAL });
    assert.throws(() => router.select(providers, {}, { providerId: 'missing' }), /not available/);
  });

  it('balanced strategy picks a reasonable provider', () => {
    const router = new Router({ strategy: Strategy.BALANCED });
    const selected = router.select(providers);
    assert.ok(providers.some((p) => p.id === selected.id));
  });

  it('filters by tool_use capability when tools in request', () => {
    const mixedProviders = [
      ...providers,
      { id: 'basic', qualityScore: 99, costPer1kInput: 0.001, costPer1kOutput: 0.001, capabilities: ['chat'] },
    ];
    const router = new Router({ strategy: Strategy.QUALITY });
    const selected = router.select(mixedProviders, { tools: [{ name: 'test' }] });
    // basic has highest quality but no tool_use — should be filtered
    assert.notEqual(selected.id, 'basic');
  });

  it('filters by streaming capability', () => {
    const mixedProviders = [
      { id: 'nostream', qualityScore: 99, costPer1kInput: 0, costPer1kOutput: 0, capabilities: ['chat'] },
      ...providers,
    ];
    const router = new Router({ strategy: Strategy.QUALITY });
    const selected = router.select(mixedProviders, { stream: true });
    assert.notEqual(selected.id, 'nostream');
  });

  it('setStrategy changes the strategy', () => {
    const router = new Router();
    router.setStrategy(Strategy.COST);
    assert.equal(router.getStrategy(), Strategy.COST);
  });

  it('throws on invalid strategy', () => {
    const router = new Router();
    assert.throws(() => router.setStrategy('invalid'), /Invalid strategy/);
  });

  it('throws on empty providers list', () => {
    const router = new Router();
    assert.throws(() => router.select([]), /No providers/);
  });

  it('records and retrieves average latency', () => {
    const router = new Router();
    router.recordLatency('openai', 100);
    router.recordLatency('openai', 200);
    router.recordLatency('openai', 300);
    assert.equal(router.getAverageLatency('openai'), 200);
  });

  it('returns Infinity for unknown provider latency', () => {
    const router = new Router();
    assert.equal(router.getAverageLatency('unknown'), Infinity);
  });

  it('respects preferred providers', () => {
    const router = new Router({ strategy: Strategy.QUALITY, preferredProviders: ['google'] });
    const selected = router.select(providers);
    assert.equal(selected.id, 'google');
  });
});
