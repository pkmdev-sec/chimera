#!/usr/bin/env node
/**
 * CHIMERA Multi-Provider Example
 * Demonstrates setting up Chimera with multiple providers and showing routing decisions.
 */

import Chimera, { Strategy } from '../lib/unified-api.mjs';

async function main() {
  console.log('=== Chimera Multi-Provider Example ===\n');

  // Check for API keys
  const hasKeys = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!hasKeys) {
    console.log('⚠️  No API keys found in environment variables.');
    console.log('Please set at least one of:');
    console.log('  - ANTHROPIC_API_KEY');
    console.log('  - OPENAI_API_KEY');
    console.log('  - GOOGLE_API_KEY');
    console.log('\nExample:');
    console.log('  export ANTHROPIC_API_KEY="your-key"');
    console.log('  node examples/multi-provider.mjs');
    process.exit(1);
  }

  // Initialize Chimera with all three providers
  const apiKeys = {};
  if (process.env.ANTHROPIC_API_KEY) apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) apiKeys.openai = process.env.OPENAI_API_KEY;
  if (process.env.GOOGLE_API_KEY) apiKeys.google = process.env.GOOGLE_API_KEY;

  const chimera = new Chimera({
    apiKeys,
    routing: {
      strategy: Strategy.BALANCED,
      weights: { quality: 0.6, cost: 0.4 },
    },
  });

  // Display available providers
  console.log('Available Providers:');
  const providers = chimera.registry.listAvailable();
  for (const provider of providers) {
    console.log(`  - ${provider.name} (${provider.id})`);
    console.log(`    Models: ${provider.models.slice(0, 2).join(', ')}`);
    console.log(`    Quality Score: ${provider.qualityScore}`);
    console.log(`    Cost: $${provider.costPer1kInput}/1k input, $${provider.costPer1kOutput}/1k output`);
  }
  console.log();

  // Example 1: Simple question with balanced routing
  console.log('Example 1: Balanced Routing (Quality + Cost)');
  console.log('Prompt: "Explain quantum entanglement in one sentence"');
  try {
    const response1 = await chimera.ask('Explain quantum entanglement in one sentence');
    console.log(`Selected Provider: ${response1.provider}`);
    console.log(`Model: ${response1.model}`);
    console.log(`Response: ${response1.content.slice(0, 150)}...`);
    console.log(`Latency: ${response1.latencyMs}ms`);
    console.log(`Tokens: ${response1.usage.inputTokens} in, ${response1.usage.outputTokens} out`);
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
  console.log();

  // Example 2: Quality-prioritized routing
  console.log('Example 2: Quality-First Routing');
  console.log('Prompt: "Write a haiku about AI"');
  chimera.setStrategy(Strategy.QUALITY);
  try {
    const response2 = await chimera.ask('Write a haiku about AI');
    console.log(`Selected Provider: ${response2.provider} (highest quality score)`);
    console.log(`Response:\n${response2.content}`);
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
  console.log();

  // Example 3: Cost-optimized routing
  console.log('Example 3: Cost-Optimized Routing');
  console.log('Prompt: "What is 2+2?"');
  chimera.setStrategy(Strategy.COST);
  try {
    const response3 = await chimera.ask('What is 2+2?');
    console.log(`Selected Provider: ${response3.provider} (lowest cost)`);
    console.log(`Response: ${response3.content}`);
    const provider = chimera.registry.get(response3.provider);
    const totalCost = provider.costPer1kInput + provider.costPer1kOutput;
    console.log(`Provider Total Cost: $${totalCost}/1k tokens`);
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
  console.log();

  // Example 4: Manual provider selection
  console.log('Example 4: Manual Provider Selection');
  console.log('Forcing provider: anthropic');
  try {
    const response4 = await chimera.chat(
      { messages: [{ role: 'user', content: 'Say hello in French' }] },
      { provider: 'anthropic' }
    );
    console.log(`Selected Provider: ${response4.provider}`);
    console.log(`Response: ${response4.content}`);
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
  console.log();

  // Display provider status
  console.log('Provider Health Status:');
  const status = chimera.status();
  for (const provider of status) {
    const health = provider.healthy ? '✓ healthy' : '✗ unhealthy';
    const circuit = provider.circuit.state === 'closed' ? 'closed' : `${provider.circuit.state} (${provider.circuit.failures} failures)`;
    console.log(`  ${provider.name}:`);
    console.log(`    Health: ${health}`);
    console.log(`    Circuit: ${circuit}`);
    console.log(`    Avg Latency: ${provider.avgLatencyMs === Infinity ? 'N/A' : `${Math.round(provider.avgLatencyMs)}ms`}`);
  }
}

main().catch(console.error);
