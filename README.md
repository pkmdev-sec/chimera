![Chimera Banner](assets/banner.svg)

<div align="center">

**CROSS-PROVIDER INTELLIGENCE**

*One API. Every provider. Automatic failover.*

![Node](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js)
![License](https://img.shields.io/badge/License-MIT-f43f5e?style=flat-square)
![Providers](https://img.shields.io/badge/Providers-Anthropic%20%7C%20OpenAI%20%7C%20Google-14b8a6?style=flat-square)

</div>

---

## What is Chimera?

**Chimera** is a cross-provider AI intelligence layer. Write your code once and seamlessly route requests across Anthropic (Claude), OpenAI (GPT-4o), and Google (Gemini) — with intelligent routing, automatic failover, and normalized responses.

## Why Chimera?

In Greek mythology, the Chimera was a fearsome hybrid creature — part lion, part goat, part serpent — combining the most powerful traits of different beasts into one being. CHIMERA embodies this principle of cross-provider fusion: it combines Anthropic's reasoning depth, OpenAI's versatility, and Google's speed into a single unified interface. Like the mythological creature that was greater than the sum of its parts, CHIMERA's intelligent routing and automatic failover create a system more resilient and capable than any single provider alone.

## Features

- **Unified API** — Single interface for Anthropic, OpenAI, and Google AI
- **Smart Routing** — Route by quality, cost, latency, balanced scoring, or round-robin
- **Automatic Failover** — Retry with exponential backoff, failover to next provider
- **Circuit Breaker** — Automatically isolate unhealthy providers
- **Response Normalization** — Consistent response format regardless of provider
- **Tool/Function Calling** — Unified tool interface across all providers
- **Extensible** — Register custom providers with custom adapters/normalizers
- **Zero Dependencies** — Pure Node.js, uses native `fetch`

## Quick Start

Install dependencies (if not using as a module):
```bash
npm install
```

Set up your API keys:
```bash
export ANTHROPIC_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
export GOOGLE_API_KEY="your-key"
```

Use Chimera in your code:
```js
import Chimera from 'chimera';

const chimera = new Chimera({
  apiKeys: {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  },
});

// Simple ask — routes to best available provider
const response = await chimera.ask('Explain quantum computing in one paragraph');

console.log(response.content);    // The response text
console.log(response.provider);   // Which provider handled it
console.log(response.usage);      // Token usage (normalized)
```

## Routing Strategies

```js
import Chimera, { Strategy } from 'chimera';

const chimera = new Chimera();

// Route by quality (picks Anthropic — highest quality score)
chimera.setStrategy(Strategy.QUALITY);

// Route by cost (picks Google — cheapest)
chimera.setStrategy(Strategy.COST);

// Balanced (default) — weighted quality + cost
chimera.setStrategy(Strategy.BALANCED);

// Route by latency — picks fastest recent responder
chimera.setStrategy(Strategy.LATENCY);

// Round robin — distribute evenly
chimera.setStrategy(Strategy.ROUND_ROBIN);

// Force a specific provider
const response = await chimera.chat(
  { messages: [{ role: 'user', content: 'Hello' }] },
  { provider: 'anthropic' }
);
```

## Full Chat Example

```js
const response = await chimera.chat({
  messages: [
    { role: 'system', content: 'You are a helpful coding assistant.' },
    { role: 'user', content: 'Write a fibonacci function in Python' },
  ],
  maxTokens: 2048,
  temperature: 0.3,
  tools: [{
    name: 'run_code',
    description: 'Execute Python code',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string' } },
    },
  }],
});

// Unified response format — same shape regardless of provider
console.log(response.id);            // 'msg_abc123'
console.log(response.provider);      // 'anthropic'
console.log(response.model);         // 'claude-sonnet-4-6'
console.log(response.content);       // The text response
console.log(response.finishReason);  // 'stop' | 'max_tokens' | 'tool_use'
console.log(response.toolCalls);     // [{ id, name, arguments }]
console.log(response.usage);         // { inputTokens, outputTokens, totalTokens }
console.log(response.latencyMs);     // 450
```

## Failover in Action

```js
// If Anthropic is down, automatically tries OpenAI, then Google
const chimera = new Chimera({
  failoverOpts: {
    maxRetries: 3,            // Retries per provider
    retryDelayMs: 1000,       // Initial retry delay
    backoffMultiplier: 2,     // Exponential backoff
    circuitThreshold: 5,      // Failures before circuit opens
    circuitResetMs: 60000,    // Time before retrying open circuit
  },
});

const response = await chimera.ask('Hello!');
// Even if the primary provider fails, you get a response
```

## Custom Providers

```js
chimera.registerProvider(
  'mistral',
  {
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest'],
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    capabilities: ['chat', 'streaming', 'tool_use'],
    costPer1kInput: 0.004,
    costPer1kOutput: 0.012,
    qualityScore: 80,
  },
  // Custom request adapter
  (req) => ({
    url: '/chat/completions',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { model: req.model, messages: req.messages },
  }),
  // Custom response normalizer
  (raw, meta) => ({
    id: raw.id,
    provider: 'mistral',
    model: raw.model,
    content: raw.choices?.[0]?.message?.content || '',
    role: 'assistant',
    finishReason: 'stop',
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    latencyMs: meta.latencyMs || 0,
    raw,
  }),
);
```

## Examples

Chimera includes comprehensive examples to help you get started:

### Multi-Provider Setup
`examples/multi-provider.mjs` — Learn how to configure multiple providers and see routing decisions in action:
- Set up Claude, GPT, and Gemini providers
- Compare quality-first, cost-first, and balanced routing strategies
- View which provider was selected and why
- Monitor provider health status and circuit states

### Failover Demo
`examples/failover-demo.mjs` — See automatic failover in action:
- Simulate provider failures with misconfigured API keys
- Watch Chimera automatically retry and failover to backup providers
- Track circuit breaker states and failure thresholds
- Observe retry delays with exponential backoff

### Cost-Based Routing
`examples/cost-route.mjs` — Optimize costs with intelligent routing:
- Compare cost differences between providers
- Send prompts of varying complexity and see routing decisions
- Compare cost vs quality trade-offs
- View detailed cost breakdowns per provider

Run any example:
```bash
node examples/multi-provider.mjs
node examples/failover-demo.mjs
node examples/cost-route.mjs
```

## Health Dashboard

Chimera includes a comprehensive health monitoring system that tracks provider performance over time:

```js
const chimera = new Chimera({ apiKeys: { /* ... */ } });

// Get current health status for all providers
const dashboard = chimera.healthDashboard;
const status = dashboard.getStatus();

console.log(dashboard.toText());
// Output:
// === Provider Health Dashboard ===
//
// ✓ Anthropic (anthropic)
//   Status: healthy
//   Uptime: 100.00%
//   Error Rate: 0.00%
//   Latency: 450ms avg (p50: 420ms, p95: 580ms, p99: 650ms)
//   Circuit: closed
//   Requests: 25 (25 success, 0 failure)
//
// ~ OpenAI (openai)
//   Status: degraded
//   Uptime: 85.00%
//   Error Rate: 15.00%
//   ...

// Record snapshots for historical tracking (call periodically)
dashboard.recordSnapshot();

// Get historical data for a provider
const history = dashboard.getHistory('anthropic', 50); // Last 50 points

// Get aggregate statistics
const aggregateStats = dashboard.getAggregateStats();
console.log(`Overall uptime: ${aggregateStats.overallUptime}%`);
console.log(`Healthy providers: ${aggregateStats.healthyProviders}/${aggregateStats.totalProviders}`);
```

**Status Indicators:**
- `✓` healthy — Provider is operating normally
- `~` degraded — Provider is experiencing issues but still available
- `✗` down/unhealthy — Provider is unavailable or circuit is open
- `○` disabled — Provider is disabled

## Request Logging

Chimera automatically logs all requests and responses with detailed metrics:

```js
const chimera = new Chimera({
  apiKeys: { /* ... */ },
  logging: {
    logPath: '~/.chimera/logs/requests.jsonl', // Custom path (optional)
    enabled: true, // Default: true
  },
});

// Logging happens automatically on every request
await chimera.ask('Hello, world!');

// Get recent logs from memory
const logger = chimera.requestLogger;
const recentLogs = logger.getRecentLogs(10); // Last 10 requests

// Get aggregate statistics
const stats = logger.getStats();
console.log(`Total requests: ${stats.totalRequests}`);
console.log(`Average latency: ${stats.avgLatency}ms`);
console.log(`Total cost: $${stats.totalCost}`);
console.log(`Error rate: ${stats.errorRate}%`);

// Per-provider breakdown
for (const [provider, providerStats] of Object.entries(stats.byProvider)) {
  console.log(`${provider}: ${providerStats.requests} requests, $${providerStats.totalCost} cost`);
}

// Format as human-readable text
console.log(logger.formatStats());

// Clear logs
logger.clear();
```

**Log Format:** Each request is logged as a single line of JSON (JSONL format):
```json
{"timestamp":1234567890,"provider":"anthropic","model":"claude-sonnet-4-6","prompt":"Explain quantum...","latencyMs":450,"status":"success","usage":{"inputTokens":12,"outputTokens":156,"totalTokens":168},"cost":0.000234}
```

## CLI

```bash
# Show provider status
chimera status

# List all providers
chimera providers

# Send a quick prompt
chimera ask "What is the meaning of life?"
```

## Architecture

![Architecture](docs/visuals/architecture-diagram.svg)

## Project Structure

```
chimera/
├── lib/
│   ├── provider-registry.mjs    # Provider management
│   ├── request-adapter.mjs      # Request translation
│   ├── response-normalizer.mjs  # Response normalization
│   ├── router.mjs               # Intelligent routing
│   ├── failover.mjs             # Retry & circuit breaker
│   ├── health-dashboard.mjs     # Provider health monitoring
│   ├── request-logger.mjs       # Request/response logging
│   └── unified-api.mjs          # Main Chimera class
├── examples/
│   ├── multi-provider.mjs       # Multi-provider setup demo
│   ├── failover-demo.mjs        # Failover demonstration
│   └── cost-route.mjs           # Cost-based routing example
├── test/
│   ├── provider-registry.test.mjs
│   ├── request-adapter.test.mjs
│   ├── response-normalizer.test.mjs
│   ├── router.test.mjs
│   ├── failover.test.mjs
│   └── unified-api.test.mjs
├── bin/
│   └── cli.mjs                  # CLI interface
├── docs/
│   ├── architecture.md          # Architecture & diagrams
│   └── api-reference.md         # Full API documentation
└── package.json
```

## Test Suite

```bash
npm test
# 83 tests across 6 test suites — all passing
```

## License

MIT
