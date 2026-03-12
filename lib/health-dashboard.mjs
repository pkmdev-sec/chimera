/**
 * CHIMERA — Health Dashboard
 * Aggregates provider health metrics with historical tracking.
 */

export class HealthDashboard {
  #registry;
  #failover;
  #router;
  #history = new Map(); // providerId -> [{ timestamp, uptime, latency, errorRate, circuitState }]
  #maxHistoryPoints = 100;

  constructor(registry, failover, router) {
    if (!registry) throw new Error('Registry is required');
    if (!failover) throw new Error('Failover is required');
    if (!router) throw new Error('Router is required');

    this.#registry = registry;
    this.#failover = failover;
    this.#router = router;
  }

  /**
   * Record current health metrics for all providers.
   * Call this periodically to build historical data.
   */
  recordSnapshot() {
    const timestamp = Date.now();
    const providers = this.#registry.list();

    for (const provider of providers) {
      const snapshot = this.#captureProviderSnapshot(provider.id, timestamp);
      if (snapshot) {
        this.#addToHistory(provider.id, snapshot);
      }
    }
  }

  /**
   * Capture current health snapshot for a provider.
   */
  #captureProviderSnapshot(providerId, timestamp) {
    const healthStats = this.#registry.getHealthStats(providerId);
    if (!healthStats) return null;

    const latencyStats = this.#registry.getLatencyStats(providerId);
    const circuitState = this.#failover.getCircuitState(providerId);
    const provider = this.#registry.get(providerId);

    // Calculate metrics
    const uptime = healthStats.totalRequests > 0
      ? (healthStats.successCount / healthStats.totalRequests) * 100
      : 100;

    const errorRate = healthStats.totalRequests > 0
      ? (healthStats.failureCount / healthStats.totalRequests) * 100
      : 0;

    const avgLatency = latencyStats && latencyStats.avg > 0
      ? latencyStats.avg
      : this.#router.getAverageLatency(providerId);

    return {
      timestamp,
      uptime: Math.round(uptime * 100) / 100,
      latency: avgLatency === Infinity ? null : Math.round(avgLatency),
      errorRate: Math.round(errorRate * 100) / 100,
      circuitState: circuitState.state,
      healthy: provider.healthy,
      enabled: provider.enabled,
    };
  }

  /**
   * Add snapshot to historical data.
   */
  #addToHistory(providerId, snapshot) {
    if (!this.#history.has(providerId)) {
      this.#history.set(providerId, []);
    }

    const history = this.#history.get(providerId);
    history.push(snapshot);

    // Keep only last N points
    if (history.length > this.#maxHistoryPoints) {
      history.shift();
    }
  }

  /**
   * Get current status for all providers.
   * @returns {object} Provider health data
   */
  getStatus() {
    const providers = this.#registry.list();
    const status = {};

    for (const provider of providers) {
      const healthStats = this.#registry.getHealthStats(provider.id);
      const latencyStats = this.#registry.getLatencyStats(provider.id);
      const circuitState = this.#failover.getCircuitState(provider.id);
      const avgLatency = this.#router.getAverageLatency(provider.id);

      const uptime = healthStats && healthStats.totalRequests > 0
        ? (healthStats.successCount / healthStats.totalRequests) * 100
        : 100;

      const errorRate = healthStats && healthStats.totalRequests > 0
        ? (healthStats.failureCount / healthStats.totalRequests) * 100
        : 0;

      // Determine status indicator
      let statusIndicator = '✓'; // healthy
      let statusText = 'healthy';

      if (!provider.enabled) {
        statusIndicator = '○';
        statusText = 'disabled';
      } else if (circuitState.state === 'open') {
        statusIndicator = '✗';
        statusText = 'down';
      } else if (!provider.healthy || (healthStats && healthStats.status === 'degraded')) {
        statusIndicator = '~';
        statusText = 'degraded';
      } else if (healthStats && healthStats.status === 'unhealthy') {
        statusIndicator = '✗';
        statusText = 'unhealthy';
      }

      status[provider.id] = {
        name: provider.name,
        enabled: provider.enabled,
        healthy: provider.healthy,
        statusIndicator,
        statusText,
        uptime: Math.round(uptime * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100,
        latency: {
          avg: avgLatency === Infinity ? null : Math.round(avgLatency),
          p50: latencyStats?.p50 ? Math.round(latencyStats.p50) : null,
          p95: latencyStats?.p95 ? Math.round(latencyStats.p95) : null,
          p99: latencyStats?.p99 ? Math.round(latencyStats.p99) : null,
        },
        circuit: {
          state: circuitState.state,
          failures: circuitState.failures || 0,
        },
        requests: {
          total: healthStats?.totalRequests || 0,
          success: healthStats?.successCount || 0,
          failure: healthStats?.failureCount || 0,
        },
        history: this.#history.get(provider.id) || [],
      };
    }

    return status;
  }

  /**
   * Get historical data for a specific provider.
   * @param {string} providerId - Provider ID
   * @param {number} points - Number of recent points to return (default: all)
   * @returns {array} Historical snapshots
   */
  getHistory(providerId, points = null) {
    const history = this.#history.get(providerId) || [];
    if (points === null) return [...history];
    return history.slice(-points);
  }

  /**
   * Clear historical data for a provider or all providers.
   * @param {string} providerId - Optional provider ID (omit to clear all)
   */
  clearHistory(providerId = null) {
    if (providerId) {
      this.#history.delete(providerId);
    } else {
      this.#history.clear();
    }
  }

  /**
   * Serialize to JSON.
   * @returns {object} JSON representation
   */
  toJSON() {
    return {
      timestamp: Date.now(),
      providers: this.getStatus(),
    };
  }

  /**
   * Format as human-readable text for console output.
   * @returns {string} Formatted text
   */
  toText() {
    const status = this.getStatus();
    const lines = [];

    lines.push('=== Provider Health Dashboard ===');
    lines.push('');

    for (const [id, data] of Object.entries(status)) {
      lines.push(`${data.statusIndicator} ${data.name} (${id})`);
      lines.push(`  Status: ${data.statusText}`);
      lines.push(`  Uptime: ${data.uptime.toFixed(2)}%`);
      lines.push(`  Error Rate: ${data.errorRate.toFixed(2)}%`);

      if (data.latency.avg !== null) {
        lines.push(`  Latency: ${data.latency.avg}ms avg (p50: ${data.latency.p50}ms, p95: ${data.latency.p95}ms, p99: ${data.latency.p99}ms)`);
      } else {
        lines.push(`  Latency: N/A`);
      }

      lines.push(`  Circuit: ${data.circuit.state}${data.circuit.failures > 0 ? ` (${data.circuit.failures} failures)` : ''}`);
      lines.push(`  Requests: ${data.requests.total} (${data.requests.success} success, ${data.requests.failure} failure)`);

      if (data.history.length > 0) {
        lines.push(`  History: ${data.history.length} data points`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get aggregate statistics across all providers.
   * @returns {object} Aggregate stats
   */
  getAggregateStats() {
    const status = this.getStatus();
    const providers = Object.values(status);

    const totalProviders = providers.length;
    const healthyProviders = providers.filter(p => p.statusText === 'healthy').length;
    const degradedProviders = providers.filter(p => p.statusText === 'degraded').length;
    const downProviders = providers.filter(p => p.statusText === 'down' || p.statusText === 'unhealthy').length;

    const totalRequests = providers.reduce((sum, p) => sum + p.requests.total, 0);
    const totalSuccess = providers.reduce((sum, p) => sum + p.requests.success, 0);
    const totalFailure = providers.reduce((sum, p) => sum + p.requests.failure, 0);

    const avgUptime = totalProviders > 0
      ? providers.reduce((sum, p) => sum + p.uptime, 0) / totalProviders
      : 100;

    const latencies = providers
      .map(p => p.latency.avg)
      .filter(l => l !== null);

    const avgLatency = latencies.length > 0
      ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
      : null;

    return {
      totalProviders,
      healthyProviders,
      degradedProviders,
      downProviders,
      totalRequests,
      totalSuccess,
      totalFailure,
      overallUptime: Math.round(avgUptime * 100) / 100,
      averageLatency: avgLatency !== null ? Math.round(avgLatency) : null,
    };
  }
}

export default HealthDashboard;
