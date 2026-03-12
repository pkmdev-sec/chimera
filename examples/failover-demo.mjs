#!/usr/bin/env node
/**
 * CHIMERA Failover Demo
 * Demonstrates automatic failover when a provider is misconfigured or unavailable.
 */

import Chimera from '../lib/unified-api.mjs';

async function main() {
  console.log('=== Chimera Failover Demo ===\n');

  // Check for at least one valid API key (for failover target)
  const hasValidKeys = process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!hasValidKeys) {
    console.log('⚠️  This demo requires at least one valid API key for failover.');
    console.log('Please set at least one of:');
    console.log('  - OPENAI_API_KEY');
    console.log('  - GOOGLE_API_KEY');
    console.log('\nExample:');
    console.log('  export OPENAI_API_KEY="your-key"');
    console.log('  node examples/failover-demo.mjs');
    process.exit(1);
  }

  // Initialize Chimera with intentionally misconfigured primary provider
  const apiKeys = {
    // Intentionally invalid API key for anthropic to trigger failover
    anthropic: 'sk-invalid-key-for-demo',
  };
  if (process.env.OPENAI_API_KEY) apiKeys.openai = process.env.OPENAI_API_KEY;
  if (process.env.GOOGLE_API_KEY) apiKeys.google = process.env.GOOGLE_API_KEY;

  const chimera = new Chimera({
    apiKeys,
    failoverOpts: {
      maxRetries: 2,              // 2 retries per provider
      retryDelayMs: 500,          // Start with 500ms delay
      backoffMultiplier: 2,       // Double delay each retry
      jitter: true,               // Add random jitter to prevent thundering herd
      circuitThreshold: 3,        // Open circuit after 3 consecutive failures
      circuitResetMs: 30000,      // Try again after 30 seconds
      onFailover: (info) => {
        console.log(`  → Failover triggered from ${info.fromProvider}: ${info.error}`);
      },
    },
  });

  console.log('Configuration:');
  console.log('  - anthropic: INVALID API KEY (will fail)');
  console.log('  - openai: valid key');
  console.log('  - google: valid key');
  console.log('  - maxRetries: 2 per provider');
  console.log('  - retryDelayMs: 500ms (with exponential backoff)');
  console.log();

  // Example 1: Automatic failover
  console.log('Example 1: Sending request with failover enabled');
  console.log('Prompt: "Hello, how are you?"');
  console.log();

  try {
    const startTime = Date.now();
    const response = await chimera.ask('Hello, how are you?');
    const totalTime = Date.now() - startTime;

    console.log('\n✓ Request succeeded after failover!');
    console.log(`Final Provider: ${response.provider}`);
    console.log(`Model: ${response.model}`);
    console.log(`Response: ${response.content.slice(0, 100)}...`);
    console.log(`Total Time: ${totalTime}ms (including retries)`);
    console.log(`Response Latency: ${response.latencyMs}ms (successful provider only)`);
  } catch (err) {
    console.log('\n✗ All providers failed!');
    console.log(`Error: ${err.message}`);

    if (err.attempts) {
      console.log('\nAttempt Log:');
      for (const attempt of err.attempts) {
        const status = attempt.success ? '✓' : '✗';
        console.log(`  ${status} ${attempt.providerId} (attempt ${attempt.attempt}): ${attempt.success ? 'success' : attempt.error} [${attempt.latencyMs}ms]`);
      }
    }
  }
  console.log();

  // Display circuit breaker states
  console.log('Circuit Breaker States:');
  const status = chimera.status();
  for (const provider of status) {
    const circuitState = provider.circuit.state;
    const failures = provider.circuit.failures || 0;
    let indicator = '○';
    if (circuitState === 'open') indicator = '✗';
    else if (circuitState === 'half-open') indicator = '~';
    else if (circuitState === 'closed' && failures === 0) indicator = '✓';

    console.log(`  ${indicator} ${provider.name}: ${circuitState} (${failures} consecutive failures)`);
  }
  console.log();

  // Example 2: Show provider health stats
  console.log('Provider Health Statistics:');
  for (const provider of status) {
    if (provider.healthStats) {
      const stats = provider.healthStats;
      const successRate = stats.totalRequests > 0
        ? ((stats.successCount / stats.totalRequests) * 100).toFixed(1)
        : 'N/A';

      console.log(`  ${provider.name}:`);
      console.log(`    Success Rate: ${successRate}%`);
      console.log(`    Total Requests: ${stats.totalRequests}`);
      console.log(`    Successes: ${stats.successCount}`);
      console.log(`    Failures: ${stats.failureCount}`);
      console.log(`    Status: ${stats.status}`);
    }
  }
  console.log();

  // Example 3: Demonstrate circuit breaker opening
  console.log('Example 2: Testing circuit breaker opening');
  console.log('Sending multiple requests to trigger circuit breaker on failed provider...');
  console.log();

  // Disable other providers temporarily to force retries on the broken one
  chimera.registry.setEnabled('openai', false);
  chimera.registry.setEnabled('google', false);

  let circuitOpened = false;
  for (let i = 1; i <= 4 && !circuitOpened; i++) {
    console.log(`Attempt ${i}...`);
    try {
      await chimera.ask('Test request');
    } catch (err) {
      // Check if circuit is now open
      const anthropicStatus = chimera.failover.getCircuitState('anthropic');
      if (anthropicStatus.state === 'open') {
        console.log(`✓ Circuit breaker opened for anthropic after ${anthropicStatus.failures} failures`);
        circuitOpened = true;
      }
    }
  }

  // Re-enable providers
  chimera.registry.setEnabled('openai', true);
  chimera.registry.setEnabled('google', true);

  console.log();
  console.log('Final Circuit States:');
  const finalStatus = chimera.status();
  for (const provider of finalStatus) {
    console.log(`  ${provider.name}: ${provider.circuit.state}`);
  }

  console.log();
  console.log('Key Takeaways:');
  console.log('  1. Chimera automatically retries failed requests with exponential backoff');
  console.log('  2. When one provider fails, it automatically tries the next available provider');
  console.log('  3. Circuit breaker prevents wasting time on consistently failing providers');
  console.log('  4. Your application gets a response even when some providers are down');
}

main().catch(console.error);
