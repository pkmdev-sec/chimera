/**
 * CHIMERA — Router
 * Route requests to the optimal provider based on task, cost, quality, and capability.
 */

/** Routing strategies. */
export const Strategy = Object.freeze({
  QUALITY: 'quality',       // Pick highest quality score
  COST: 'cost',             // Pick lowest cost
  BALANCED: 'balanced',     // Weighted balance of quality and cost
  LATENCY: 'latency',       // Pick provider with lowest recent latency
  LATENCY_AWARE: 'latency_aware', // Prefer faster providers when quality is similar
  PARETO: 'pareto',         // Find optimal providers on the cost/quality frontier
  ROUND_ROBIN: 'round_robin', // Distribute evenly
  MANUAL: 'manual',         // User specifies provider
});

export class Router {
  #strategy;
  #weights;
  #preferredProviders;
  #roundRobinIndex = 0;
  #latencyHistory = new Map(); // providerId -> [latencyMs]
  #performanceHistory = new Map(); // providerId -> { avgQuality, avgCost, avgLatency }

  constructor(opts = {}) {
    this.#strategy = opts.strategy || Strategy.BALANCED;
    this.#weights = { quality: 0.6, cost: 0.4, latency: 0.2, ...opts.weights };
    this.#preferredProviders = opts.preferredProviders || [];
  }

  /** Set routing strategy. */
  setStrategy(strategy) {
    try {
      if (!strategy || typeof strategy !== 'string') {
        throw new Error('Strategy must be a non-empty string');
      }
      if (!Object.values(Strategy).includes(strategy)) {
        throw new Error(`Invalid strategy: ${strategy}. Use one of: ${Object.values(Strategy).join(', ')}`);
      }
      this.#strategy = strategy;
      return this;
    } catch (err) {
      const error = new Error(`Failed to set strategy: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Get current strategy. */
  getStrategy() {
    return this.#strategy;
  }

  /** Set quality/cost weights for balanced strategy. */
  setWeights(weights) {
    try {
      if (!weights || typeof weights !== 'object') {
        throw new Error('Weights must be an object');
      }
      this.#weights = { ...this.#weights, ...weights };
      return this;
    } catch (err) {
      const error = new Error(`Failed to set weights: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  /** Record a latency measurement for a provider. */
  recordLatency(providerId, latencyMs) {
    try {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error('Provider ID must be a non-empty string');
      }
      if (typeof latencyMs !== 'number' || latencyMs < 0) {
        throw new Error('Latency must be a non-negative number');
      }
      if (!this.#latencyHistory.has(providerId)) {
        this.#latencyHistory.set(providerId, []);
      }
      const history = this.#latencyHistory.get(providerId);
      history.push(latencyMs);
      if (history.length > 50) history.shift(); // Keep last 50 measurements
      return this;
    } catch (err) {
      // Don't throw on latency recording errors, just log
      console.error(`Failed to record latency: ${err.message}`);
      return this;
    }
  }

  /** Get average latency for a provider. */
  getAverageLatency(providerId) {
    const history = this.#latencyHistory.get(providerId);
    if (!history || history.length === 0) return Infinity;
    return history.reduce((a, b) => a + b, 0) / history.length;
  }

  /**
   * Select the best provider from a list of available providers.
   * @param {object[]} providers - Available providers from registry
   * @param {object} request - The unified request (used for capability matching)
   * @param {object} opts - Override options { strategy, providerId }
   * @returns {object} Selected provider
   */
  select(providers, request = {}, opts = {}) {
    try {
      if (!providers?.length) throw new Error('No providers available for routing');
      if (!Array.isArray(providers)) throw new Error('Providers must be an array');

      const strategy = opts.strategy || this.#strategy;

    // Filter by required capability if tools are present
    let candidates = [...providers];
    if (request.tools?.length) {
      const capable = candidates.filter((p) => p.capabilities?.includes('tool_use'));
      if (capable.length) candidates = capable;
    }
    if (request.stream) {
      const capable = candidates.filter((p) => p.capabilities?.includes('streaming'));
      if (capable.length) candidates = capable;
    }

    // Apply preferred providers filter
    if (this.#preferredProviders.length) {
      const preferred = candidates.filter((p) => this.#preferredProviders.includes(p.id));
      if (preferred.length) candidates = preferred;
    }

    // Manual routing
    if (strategy === Strategy.MANUAL) {
      const id = opts.providerId || request.provider;
      if (!id) throw new Error('Manual strategy requires providerId in options or request');
      const found = candidates.find((p) => p.id === id);
      if (!found) throw new Error(`Requested provider not available: ${id}`);
      return found;
    }

    // Quality: highest qualityScore
    if (strategy === Strategy.QUALITY) {
      return candidates.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))[0];
    }

    // Cost: lowest cost per 1k tokens (input + output)
    if (strategy === Strategy.COST) {
      return candidates.sort((a, b) => {
        const costA = (a.costPer1kInput || 0) + (a.costPer1kOutput || 0);
        const costB = (b.costPer1kInput || 0) + (b.costPer1kOutput || 0);
        return costA - costB;
      })[0];
    }

    // Latency: lowest average latency
    if (strategy === Strategy.LATENCY) {
      return candidates.sort((a, b) => {
        return this.getAverageLatency(a.id) - this.getAverageLatency(b.id);
      })[0];
    }

    // Latency-aware: prefer faster providers when quality is similar (within 5%)
    if (strategy === Strategy.LATENCY_AWARE) {
      return this.#latencyAwareSelect(candidates);
    }

    // Pareto: find optimal providers on the cost/quality frontier
    if (strategy === Strategy.PARETO) {
      return this.#paretoSelect(candidates);
    }

    // Round Robin
    if (strategy === Strategy.ROUND_ROBIN) {
      const idx = this.#roundRobinIndex % candidates.length;
      this.#roundRobinIndex++;
      return candidates[idx];
    }

    // Balanced (default): weighted score of normalized quality and cost
    return this.#balancedSelect(candidates);
    } catch (err) {
      const error = new Error(`Failed to select provider: ${err.message}`);
      error.cause = err;
      throw error;
    }
  }

  #balancedSelect(candidates) {
    // Find max quality and max cost using iteration (avoid RangeError with large arrays)
    let maxQuality = 0;
    let maxCost = 0;
    for (const p of candidates) {
      const quality = p.qualityScore || 0;
      const cost = (p.costPer1kInput || 0) + (p.costPer1kOutput || 0);
      if (quality > maxQuality) maxQuality = quality;
      if (cost > maxCost) maxCost = cost;
    }

    let best = null;
    let bestScore = -Infinity;

    for (const p of candidates) {
      const qualityNorm = maxQuality > 0 ? (p.qualityScore || 0) / maxQuality : 0;
      const totalCost = (p.costPer1kInput || 0) + (p.costPer1kOutput || 0);
      const costNorm = maxCost > 0 ? 1 - totalCost / maxCost : 1; // Lower cost = higher score
      const score = this.#weights.quality * qualityNorm + this.#weights.cost * costNorm;

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  /** Latency-aware selection: prefer faster providers when quality is similar. */
  #latencyAwareSelect(candidates) {
    if (candidates.length === 1) return candidates[0];

    // Group providers by quality tiers (within 5% considered similar)
    const sorted = candidates.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
    const topQuality = sorted[0].qualityScore || 0;
    const qualityThreshold = topQuality * 0.95;

    // Get all providers within 5% of top quality
    const topTier = sorted.filter((p) => (p.qualityScore || 0) >= qualityThreshold);

    // Among top tier, select the one with lowest latency
    return topTier.sort((a, b) => {
      return this.getAverageLatency(a.id) - this.getAverageLatency(b.id);
    })[0];
  }

  /** Pareto optimization: select from cost/quality frontier. */
  #paretoSelect(candidates) {
    if (candidates.length === 1) return candidates[0];

    // Calculate Pareto frontier
    const paretoFrontier = this.#calculateParetoFrontier(candidates);

    // Among Pareto-optimal providers, use balanced scoring
    return this.#balancedSelect(paretoFrontier);
  }

  /** Calculate Pareto frontier for cost/quality trade-off. */
  #calculateParetoFrontier(candidates) {
    const frontier = [];

    for (const candidate of candidates) {
      const quality = candidate.qualityScore || 0;
      const cost = (candidate.costPer1kInput || 0) + (candidate.costPer1kOutput || 0);

      // Check if this candidate is dominated by any other
      let isDominated = false;
      for (const other of candidates) {
        if (other === candidate) continue;
        const otherQuality = other.qualityScore || 0;
        const otherCost = (other.costPer1kInput || 0) + (other.costPer1kOutput || 0);

        // Dominated if other has higher quality AND lower cost
        if (otherQuality >= quality && otherCost <= cost &&
            (otherQuality > quality || otherCost < cost)) {
          isDominated = true;
          break;
        }
      }

      if (!isDominated) {
        frontier.push(candidate);
      }
    }

    return frontier.length > 0 ? frontier : candidates;
  }

  /** Record performance data for historical routing. */
  recordPerformance(providerId, quality, cost, latency) {
    try {
      if (!this.#performanceHistory.has(providerId)) {
        this.#performanceHistory.set(providerId, {
          qualities: [],
          costs: [],
          latencies: [],
          avgQuality: 0,
          avgCost: 0,
          avgLatency: 0,
        });
      }

      const perf = this.#performanceHistory.get(providerId);
      perf.qualities.push(quality);
      perf.costs.push(cost);
      perf.latencies.push(latency);

      // Keep last 50 measurements
      if (perf.qualities.length > 50) perf.qualities.shift();
      if (perf.costs.length > 50) perf.costs.shift();
      if (perf.latencies.length > 50) perf.latencies.shift();

      // Update averages
      perf.avgQuality = perf.qualities.reduce((a, b) => a + b, 0) / perf.qualities.length;
      perf.avgCost = perf.costs.reduce((a, b) => a + b, 0) / perf.costs.length;
      perf.avgLatency = perf.latencies.reduce((a, b) => a + b, 0) / perf.latencies.length;
    } catch (err) {
      console.error(`Failed to record performance: ${err.message}`);
    }
  }

  /** Get performance history for a provider. */
  getPerformanceHistory(providerId) {
    return this.#performanceHistory.get(providerId) || null;
  }
}

export default Router;
