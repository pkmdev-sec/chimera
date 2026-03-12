import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Failover } from '../lib/failover.mjs';

const providers = [
  { id: 'primary', name: 'Primary' },
  { id: 'secondary', name: 'Secondary' },
  { id: 'tertiary', name: 'Tertiary' },
];

describe('Failover', () => {
  it('succeeds on first provider', async () => {
    const fo = new Failover({ maxRetries: 0 });
    const result = await fo.execute(providers, async (p) => ({ text: `from ${p.id}` }));
    assert.equal(result.response.text, 'from primary');
    assert.equal(result.provider.id, 'primary');
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].success, true);
  });

  it('fails over to second provider', async () => {
    const fo = new Failover({ maxRetries: 0 });
    let callCount = 0;
    const result = await fo.execute(providers, async (p) => {
      callCount++;
      if (p.id === 'primary') throw new Error('down');
      return { text: `from ${p.id}` };
    });
    assert.equal(result.response.text, 'from secondary');
    assert.equal(result.provider.id, 'secondary');
    assert.ok(result.attempts.length >= 2);
  });

  it('fails over to third provider', async () => {
    const fo = new Failover({ maxRetries: 0 });
    const result = await fo.execute(providers, async (p) => {
      if (p.id !== 'tertiary') throw new Error('down');
      return { text: `from ${p.id}` };
    });
    assert.equal(result.response.text, 'from tertiary');
  });

  it('throws when all providers fail', async () => {
    const fo = new Failover({ maxRetries: 0 });
    await assert.rejects(
      () => fo.execute(providers, async () => { throw new Error('fail'); }),
      /All providers failed/,
    );
  });

  it('retries on retryable errors', async () => {
    const fo = new Failover({ maxRetries: 2, retryDelayMs: 10, backoffMultiplier: 1 });
    let attempts = 0;
    const result = await fo.execute([providers[0]], async () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error('rate limit');
        err.statusCode = 429;
        throw err;
      }
      return { text: 'success' };
    });
    assert.equal(result.response.text, 'success');
    assert.equal(attempts, 3);
  });

  it('does not retry non-retryable errors', async () => {
    const fo = new Failover({ maxRetries: 2, retryDelayMs: 10 });
    let attempts = 0;
    await assert.rejects(
      () => fo.execute([providers[0]], async () => {
        attempts++;
        const err = new Error('bad request');
        err.statusCode = 400;
        throw err;
      }),
      /All providers failed/,
    );
    // Should have 1 attempt (no retries for 400)
    assert.equal(attempts, 1);
  });

  it('calls onFailover callback', async () => {
    const failovers = [];
    const fo = new Failover({
      maxRetries: 0,
      onFailover: (info) => failovers.push(info),
    });
    await fo.execute(providers, async (p) => {
      if (p.id === 'primary') throw new Error('error');
      return { text: 'ok' };
    });
    assert.equal(failovers.length, 1);
    assert.equal(failovers[0].fromProvider, 'primary');
  });

  it('throws on empty providers', async () => {
    const fo = new Failover();
    await assert.rejects(() => fo.execute([], async () => {}), /No providers/);
  });

  it('throws on non-function executeFn', async () => {
    const fo = new Failover();
    await assert.rejects(() => fo.execute(providers, 'notfn'), /must be a function/);
  });

  // ── Circuit breaker ──
  it('opens circuit after threshold failures', async () => {
    const fo = new Failover({ maxRetries: 0, circuitThreshold: 2, circuitResetMs: 100000 });
    // Fail primary twice
    for (let i = 0; i < 2; i++) {
      try {
        await fo.execute([providers[0]], async () => { throw new Error('fail'); });
      } catch { /* expected */ }
    }
    const state = fo.getCircuitState('primary');
    assert.equal(state.state, 'open');
    assert.equal(state.failures, 2);
  });

  it('resets circuit manually', () => {
    const fo = new Failover();
    fo.resetCircuit('primary');
    assert.equal(fo.getCircuitState('primary').state, 'closed');
  });

  it('resets all circuits', () => {
    const fo = new Failover();
    fo.resetAll();
    assert.equal(fo.getCircuitState('primary').state, 'closed');
  });

  it('circuit defaults to closed for unknown provider', () => {
    const fo = new Failover();
    assert.equal(fo.getCircuitState('nope').state, 'closed');
  });
});
