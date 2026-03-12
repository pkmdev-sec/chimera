#!/usr/bin/env node
/**
 * CHIMERA Cost-Based Routing Example
 * Demonstrates intelligent routing based on cost optimization.
 */

import Chimera, { Strategy } from '../lib/unified-api.mjs';

async function main() {
  console.log('=== Chimera Cost-Based Routing Example ===\n');

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
    console.log('  node examples/cost-route.mjs');
    process.exit(1);
  }

  // Initialize Chimera with cost-optimized routing
  const apiKeys = {};
  if (process.env.ANTHROPIC_API_KEY) apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) apiKeys.openai = process.env.OPENAI_API_KEY;
  if (process.env.GOOGLE_API_KEY) apiKeys.google = process.env.GOOGLE_API_KEY;

  const chimera = new Chimera({
    apiKeys,
    routing: {
      strategy: Strategy.COST,
    },
  });

  // Display provider costs
  console.log('Provider Cost Comparison (per 1k tokens):');
  const providers = chimera.registry.list();
  const sorted = [...providers].sort((a, b) => {
    const costA = a.costPer1kInput + a.costPer1kOutput;
    const costB = b.costPer1kInput + b.costPer1kOutput;
    return costA - costB;
  });

  for (const provider of sorted) {
    const totalCost = provider.costPer1kInput + provider.costPer1kOutput;
    console.log(`  ${provider.name}:`);
    console.log(`    Input: $${provider.costPer1kInput.toFixed(5)}/1k`);
    console.log(`    Output: $${provider.costPer1kOutput.toFixed(5)}/1k`);
    console.log(`    Total: $${totalCost.toFixed(5)}/1k`);
    console.log(`    Quality Score: ${provider.qualityScore}`);
  }
  console.log();

  // Track costs across requests
  const requestLog = [];

  // Example 1: Simple question (cost-optimized)
  console.log('Example 1: Simple Question (cost-optimized routing)');
  const prompt1 = 'What is the capital of France?';
  console.log(`Prompt: "${prompt1}"`);

  try {
    const response1 = await chimera.ask(prompt1);
    const provider1 = chimera.registry.get(response1.provider);
    const cost1 = calculateCost(response1.usage, provider1);

    requestLog.push({
      prompt: prompt1,
      provider: response1.provider,
      tokens: response1.usage,
      cost: cost1,
      latency: response1.latencyMs,
    });

    console.log(`Selected: ${response1.provider} (cheapest)`);
    console.log(`Response: ${response1.content}`);
    console.log(`Tokens: ${response1.usage.inputTokens} in, ${response1.usage.outputTokens} out`);
    console.log(`Cost: $${cost1.toFixed(6)}`);
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
  console.log();

  // Example 2: Complex reasoning task
  console.log('Example 2: Complex Reasoning (still cost-optimized)');
  const prompt2 = 'Explain the difference between supervised and unsupervised machine learning with examples.';
  console.log(`Prompt: "${prompt2}"`);

  try {
    const response2 = await chimera.ask(prompt2);
    const provider2 = chimera.registry.get(response2.provider);
    const cost2 = calculateCost(response2.usage, provider2);

    requestLog.push({
      prompt: prompt2,
      provider: response2.provider,
      tokens: response2.usage,
      cost: cost2,
      latency: response2.latencyMs,
    });

    console.log(`Selected: ${response2.provider}`);
    console.log(`Response: ${response2.content.slice(0, 200)}...`);
    console.log(`Tokens: ${response2.usage.inputTokens} in, ${response2.usage.outputTokens} out`);
    console.log(`Cost: $${cost2.toFixed(6)}`);
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
  console.log();

  // Example 3: Compare with quality-first routing
  console.log('Example 3: Compare Cost vs Quality Strategy');
  const prompt3 = 'Write a creative story about a robot learning to paint.';
  console.log(`Prompt: "${prompt3}"`);
  console.log();

  // First with COST strategy
  console.log('  a) Cost-First Strategy:');
  chimera.setStrategy(Strategy.COST);
  try {
    const responseCost = await chimera.ask(prompt3);
    const providerCost = chimera.registry.get(responseCost.provider);
    const costCost = calculateCost(responseCost.usage, providerCost);

    console.log(`     Selected: ${responseCost.provider}`);
    console.log(`     Quality Score: ${providerCost.qualityScore}`);
    console.log(`     Cost: $${costCost.toFixed(6)}`);
    console.log(`     Tokens: ${responseCost.usage.totalTokens}`);
  } catch (err) {
    console.log(`     Error: ${err.message}`);
  }
  console.log();

  // Now with QUALITY strategy
  console.log('  b) Quality-First Strategy:');
  chimera.setStrategy(Strategy.QUALITY);
  try {
    const responseQuality = await chimera.ask(prompt3);
    const providerQuality = chimera.registry.get(responseQuality.provider);
    const costQuality = calculateCost(responseQuality.usage, providerQuality);

    console.log(`     Selected: ${responseQuality.provider}`);
    console.log(`     Quality Score: ${providerQuality.qualityScore}`);
    console.log(`     Cost: $${costQuality.toFixed(6)}`);
    console.log(`     Tokens: ${responseQuality.usage.totalTokens}`);
  } catch (err) {
    console.log(`     Error: ${err.message}`);
  }
  console.log();

  // Example 4: Balanced strategy (cost vs quality trade-off)
  console.log('Example 4: Balanced Strategy (60% quality, 40% cost)');
  chimera.setStrategy(Strategy.BALANCED);
  chimera.router.setWeights({ quality: 0.6, cost: 0.4 });

  const prompt4 = 'Explain neural networks in simple terms.';
  console.log(`Prompt: "${prompt4}"`);

  try {
    const response4 = await chimera.ask(prompt4);
    const provider4 = chimera.registry.get(response4.provider);
    const cost4 = calculateCost(response4.usage, provider4);

    requestLog.push({
      prompt: prompt4,
      provider: response4.provider,
      tokens: response4.usage,
      cost: cost4,
      latency: response4.latencyMs,
    });

    console.log(`Selected: ${response4.provider} (balanced quality + cost)`);
    console.log(`Quality Score: ${provider4.qualityScore}`);
    console.log(`Total Cost/1k: $${(provider4.costPer1kInput + provider4.costPer1kOutput).toFixed(5)}`);
    console.log(`This Request: $${cost4.toFixed(6)}`);
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
  console.log();

  // Summary
  console.log('=== Cost Summary ===');
  const totalCost = requestLog.reduce((sum, log) => sum + log.cost, 0);
  const totalTokens = requestLog.reduce((sum, log) => sum + log.tokens.totalTokens, 0);
  const avgLatency = requestLog.reduce((sum, log) => sum + log.latency, 0) / requestLog.length;

  console.log(`Total Requests: ${requestLog.length}`);
  console.log(`Total Cost: $${totalCost.toFixed(6)}`);
  console.log(`Total Tokens: ${totalTokens.toLocaleString()}`);
  console.log(`Average Latency: ${Math.round(avgLatency)}ms`);
  console.log();

  console.log('Per-Provider Breakdown:');
  const byProvider = {};
  for (const log of requestLog) {
    if (!byProvider[log.provider]) {
      byProvider[log.provider] = { requests: 0, cost: 0, tokens: 0 };
    }
    byProvider[log.provider].requests++;
    byProvider[log.provider].cost += log.cost;
    byProvider[log.provider].tokens += log.tokens.totalTokens;
  }

  for (const [providerId, stats] of Object.entries(byProvider)) {
    const provider = chimera.registry.get(providerId);
    console.log(`  ${provider.name}:`);
    console.log(`    Requests: ${stats.requests}`);
    console.log(`    Cost: $${stats.cost.toFixed(6)}`);
    console.log(`    Tokens: ${stats.tokens.toLocaleString()}`);
  }
  console.log();

  console.log('Key Takeaways:');
  console.log('  1. Cost-based routing automatically selects the cheapest provider');
  console.log('  2. You can balance cost vs quality with the BALANCED strategy');
  console.log('  3. Different strategies are optimal for different use cases');
  console.log('  4. Chimera makes it easy to optimize for your priorities');
}

/**
 * Calculate the cost of a request based on token usage and provider pricing.
 */
function calculateCost(usage, provider) {
  const inputCost = (usage.inputTokens / 1000) * provider.costPer1kInput;
  const outputCost = (usage.outputTokens / 1000) * provider.costPer1kOutput;
  return inputCost + outputCost;
}

main().catch(console.error);
