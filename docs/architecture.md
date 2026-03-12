# CHIMERA Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHIMERA UNIFIED API                       │
│                                                                  │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌──────────────┐ │
│  │  Router   │  │ Failover  │  │  Request   │  │  Response    │ │
│  │          │  │           │  │  Adapter   │  │  Normalizer  │ │
│  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  └──────┬───────┘ │
│       │              │              │                │          │
│  ┌────┴──────────────┴──────────────┴────────────────┴───────┐ │
│  │                   Provider Registry                        │ │
│  └──┬─────────────────────┬─────────────────────┬────────────┘ │
└─────┼─────────────────────┼─────────────────────┼──────────────┘
      │                     │                     │
      ▼                     ▼                     ▼
┌───────────┐        ┌───────────┐        ┌───────────┐
│ Anthropic │        │  OpenAI   │        │  Google   │
│  Claude   │        │  GPT-4o   │        │  Gemini   │
└───────────┘        └───────────┘        └───────────┘
```

## Module Responsibilities

### Provider Registry (`provider-registry.mjs`)
- Maintains a registry of all AI providers
- Stores provider metadata: models, capabilities, costs, endpoints
- Manages API keys per provider
- Tracks provider health and enabled/disabled state
- Ships with 3 built-in providers (Anthropic, OpenAI, Google)

### Request Adapter (`request-adapter.mjs`)
- Translates unified request format → provider-specific formats
- Handles system message extraction (Anthropic separates system)
- Maps tools/functions to provider-specific schemas
- Supports custom adapters for new providers

### Response Normalizer (`response-normalizer.mjs`)
- Normalizes provider responses → unified format
- Extracts text content, tool calls, usage metrics
- Maps provider-specific finish reasons to unified set
- Supports custom normalizers for new providers

### Router (`router.mjs`)
- Selects optimal provider based on configurable strategy
- Strategies: Quality, Cost, Balanced, Latency, Round Robin, Manual
- Filters by capability (tool_use, streaming, vision)
- Tracks latency history for latency-based routing
- Supports preferred provider lists

### Failover (`failover.mjs`)
- Automatic retry with exponential backoff
- Failover to next provider on persistent failure
- Circuit breaker pattern (closed → open → half-open)
- Distinguishes retryable (429, 5xx) vs non-retryable errors
- Configurable thresholds and timeouts

### Unified API (`unified-api.mjs`)
- Orchestrates all modules into a single `Chimera` class
- `chat()` — full request with routing and failover
- `ask()` — quick single-message shortcut
- `status()` — provider health overview
- `registerProvider()` — add custom providers at runtime

## Data Flow

```
User Request (unified format)
        │
        ▼
   ┌─────────┐
   │ Router  │ ── selects provider based on strategy
   └────┬────┘
        ▼
   ┌──────────┐
   │ Failover │ ── wraps execution with retry + failover
   └────┬─────┘
        ▼
   ┌───────────┐
   │ Adapter   │ ── translates to provider-specific format
   └─────┬─────┘
        ▼
   ┌───────────┐
   │ HTTP Call │ ── sends to provider API
   └─────┬─────┘
        ▼
   ┌────────────┐
   │ Normalizer │ ── normalizes response to unified format
   └─────┬──────┘
        ▼
  Unified Response
```

## Routing Strategies

| Strategy    | Description                              | Best For               |
|-------------|------------------------------------------|------------------------|
| `quality`   | Highest quality score                    | Critical tasks         |
| `cost`      | Lowest cost per token                    | High-volume workloads  |
| `balanced`  | Weighted quality + cost                  | General use (default)  |
| `latency`   | Lowest average response time             | Real-time applications |
| `round_robin`| Even distribution across providers      | Load balancing         |
| `manual`    | User specifies provider                  | Testing / debugging    |

## Circuit Breaker States

```
    ┌────────┐  threshold failures  ┌────────┐
    │ CLOSED ├─────────────────────►│  OPEN  │
    │        │                      │        │
    └───┬────┘                      └───┬────┘
        ▲                               │
        │ success                       │ timeout elapsed
        │                               ▼
        │                          ┌──────────┐
        └──────────────────────────┤HALF-OPEN │
                                   │          │
                                   └──────────┘
```
