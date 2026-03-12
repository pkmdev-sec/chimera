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
  ROUND_ROBIN: 'round_robin', // Distribute evenly
  MANUAL: 'manual',         // User specifies provider
});

export class Router {
  #strategy;
  #weights;
  #preferredProviders;
  #roundRobinIndex = 0;
  #latencyHistory = new Map(); // providerId -> [latencyMs]

  constructor(opts = {}) {
    this.#strategy = opts.strategy || Strategy.BALANCED;
    this.#weights = { quality: 0.6, cost: 0.4, ...opts.weights };
    this.#preferredProviders = opts.preferredProviders || [];
  }

  /** Set routing strategy. */
  setStrategy(strategy) {
    if (!Object.values(Strategy).includes(strategy)) {
      throw new Error(`Invalid strategy: ${strategy}. Use one of: ${Object.values(Strategy).join(', ')}`);
    }
    this.#strategy = strategy;
    return this;
  }

  /** Get current strategy. */
  getStrategy() {
    return this.#strategy;
  }

  /** Set quality/cost weights for balanced strategy. */
  setWeights(weights) {
    this.#weights = { ...this.#weights, ...weights };
    return this;
  }

  /** Record a latency measurement for a provider. */
  recordLatency(providerId, latencyMs) {
    if (!this.#latencyHistory.has(providerId)) {
      this.#latencyHistory.set(providerId, []);
    }
    const history = this.#latencyHistory.get(providerId);
    history.push(latencyMs);
    if (history.length > 50) history.shift(); // Keep last 50 measurements
    return this;
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
    if (!providers?.length) throw new Error('No providers available for routing');

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

    // Round Robin
    if (strategy === Strategy.ROUND_ROBIN) {
      const idx = this.#roundRobinIndex % candidates.length;
      this.#roundRobinIndex++;
      return candidates[idx];
    }

    // Balanced (default): weighted score of normalized quality and cost
    return this.#balancedSelect(candidates);
  }

  #balancedSelect(candidates) {
    const maxQuality = Math.max(...candidates.map((p) => p.qualityScore || 0));
    const maxCost = Math.max(...candidates.map((p) => (p.costPer1kInput || 0) + (p.costPer1kOutput || 0)));

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
}

export default Router;
