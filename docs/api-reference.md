# CHIMERA API Reference

## Chimera (Unified API)

```js
import Chimera, { Strategy } from 'chimera';

const chimera = new Chimera({
  apiKeys: {
    anthropic: 'sk-ant-...',
    openai: 'sk-...',
    google: 'AIza...',
  },
  routing: {
    strategy: 'balanced',      // quality | cost | balanced | latency | round_robin | manual
    weights: { quality: 0.6, cost: 0.4 },
    preferredProviders: [],
  },
  failoverOpts: {
    maxRetries: 3,
    retryDelayMs: 1000,
    backoffMultiplier: 2,
    circuitThreshold: 5,
    circuitResetMs: 60000,
  },
});
```

### `chimera.chat(request, opts?)`

Send a chat completion request.

```js
const response = await chimera.chat({
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello' },
  ],
  maxTokens: 1024,
  temperature: 0.7,
  tools: [{ name: 'search', description: 'Search', parameters: { type: 'object' } }],
}, {
  provider: 'anthropic',  // optional: force a provider
  strategy: 'quality',    // optional: override routing strategy
});
```

**Unified Response:**
```js
{
  id: 'msg_123',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  content: 'Hello!',
  role: 'assistant',
  finishReason: 'stop',           // stop | max_tokens | tool_use
  toolCalls: [{ id, name, arguments }],
  usage: { inputTokens, outputTokens, totalTokens },
  latencyMs: 450,
  raw: { /* original provider response */ },
}
```

### `chimera.ask(prompt, opts?)`

Quick single-message helper.

```js
const response = await chimera.ask('What is the capital of France?');
```

### `chimera.status()`

Get health overview of all providers.

### `chimera.setApiKey(providerId, key)`
### `chimera.setStrategy(strategy)`
### `chimera.registerProvider(id, config, adapterFn?, normalizerFn?)`

---

## ProviderRegistry

```js
import { ProviderRegistry } from 'chimera/registry';

const registry = new ProviderRegistry();
registry.register('custom', { name: 'Custom', baseUrl: '...', models: ['m1'] });
registry.setApiKey('custom', 'key');
registry.setEnabled('custom', true);
registry.setHealth('custom', true);
registry.findByCapability('vision');
registry.findByModel('gpt-4o');
registry.listAvailable();
```

## RequestAdapter

```js
import { RequestAdapter } from 'chimera/adapter';

const adapter = new RequestAdapter();
const adapted = adapter.adapt('anthropic', unifiedRequest);
adapter.registerAdapter('custom', (req) => ({ url, headers, body }));
```

## ResponseNormalizer

```js
import { ResponseNormalizer } from 'chimera/normalizer';

const normalizer = new ResponseNormalizer();
const unified = normalizer.normalize('openai', rawResponse, { latencyMs: 200 });
normalizer.registerNormalizer('custom', (raw, meta) => ({ ... }));
```

## Router

```js
import { Router, Strategy } from 'chimera/router';

const router = new Router({ strategy: Strategy.BALANCED });
router.setStrategy(Strategy.COST);
router.recordLatency('openai', 200);
const best = router.select(providers, request);
```

## Failover

```js
import { Failover } from 'chimera/failover';

const failover = new Failover({ maxRetries: 3 });
const result = await failover.execute(providers, async (provider) => {
  return await callProvider(provider);
});
// result = { response, provider, attempts }
```
