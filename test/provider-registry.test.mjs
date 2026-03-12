import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry } from '../lib/provider-registry.mjs';

describe('ProviderRegistry', () => {
  it('loads builtin providers by default', () => {
    const reg = new ProviderRegistry();
    assert.equal(reg.size, 3);
    const ids = reg.list().map((p) => p.id).sort();
    assert.deepEqual(ids, ['anthropic', 'google', 'openai']);
  });

  it('can skip builtins with loadBuiltins: false', () => {
    const reg = new ProviderRegistry({ loadBuiltins: false });
    assert.equal(reg.size, 0);
  });

  it('registers a custom provider', () => {
    const reg = new ProviderRegistry({ loadBuiltins: false });
    reg.register('custom', { name: 'Custom', baseUrl: 'https://api.custom.com', models: ['model-1'] });
    assert.equal(reg.size, 1);
    const p = reg.get('custom');
    assert.equal(p.name, 'Custom');
    assert.equal(p.enabled, true);
    assert.equal(p.healthy, true);
  });

  it('throws on invalid register args', () => {
    const reg = new ProviderRegistry({ loadBuiltins: false });
    assert.throws(() => reg.register('', {}), /non-empty string/);
    assert.throws(() => reg.register('x', null), /must be an object/);
    assert.throws(() => reg.register('x', { baseUrl: 'u', models: ['m'] }), /missing required field: name/);
  });

  it('unregisters a provider', () => {
    const reg = new ProviderRegistry();
    reg.unregister('openai');
    assert.equal(reg.size, 2);
    assert.equal(reg.get('openai'), null);
  });

  it('throws on unregistering non-existent provider', () => {
    const reg = new ProviderRegistry({ loadBuiltins: false });
    assert.throws(() => reg.unregister('nope'), /not found/);
  });

  it('sets and gets API keys', () => {
    const reg = new ProviderRegistry();
    reg.setApiKey('anthropic', 'sk-test-123');
    assert.equal(reg.getApiKey('anthropic'), 'sk-test-123');
  });

  it('throws when setting key for non-existent provider', () => {
    const reg = new ProviderRegistry({ loadBuiltins: false });
    assert.throws(() => reg.setApiKey('nope', 'key'), /not found/);
  });

  it('returns null for missing API key', () => {
    const reg = new ProviderRegistry({ loadBuiltins: false });
    reg.register('nokey', { name: 'NoKey', baseUrl: 'https://x.com', models: ['m'] });
    assert.equal(reg.getApiKey('nokey'), null);
  });

  it('enables and disables providers', () => {
    const reg = new ProviderRegistry();
    reg.setEnabled('openai', false);
    const p = reg.get('openai');
    assert.equal(p.enabled, false);
    assert.equal(reg.listAvailable().find((x) => x.id === 'openai'), undefined);
  });

  it('sets health status', () => {
    const reg = new ProviderRegistry();
    reg.setHealth('google', false);
    const avail = reg.listAvailable();
    assert.equal(avail.find((x) => x.id === 'google'), undefined);
  });

  it('finds providers by capability', () => {
    const reg = new ProviderRegistry();
    const vision = reg.findByCapability('vision');
    assert.ok(vision.length >= 2);
    assert.ok(vision.every((p) => p.capabilities.includes('vision')));
  });

  it('finds providers by model', () => {
    const reg = new ProviderRegistry();
    const found = reg.findByModel('gpt-4o');
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'openai');
  });

  it('returns copies not references', () => {
    const reg = new ProviderRegistry();
    const p = reg.get('anthropic');
    p.name = 'MUTATED';
    assert.notEqual(reg.get('anthropic').name, 'MUTATED');
  });
});
