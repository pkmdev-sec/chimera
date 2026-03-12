/**
 * CHIMERA — Request Logger
 * Logs all requests/responses to JSONL format with aggregate statistics.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export class RequestLogger {
  #logPath;
  #logs = []; // In-memory cache of recent logs
  #maxInMemory = 1000;
  #writeStream = null;
  #totalRequests = 0;
  #totalLatency = 0;
  #totalCost = 0;
  #errorCount = 0;
  #byProvider = new Map(); // providerId -> { requests, latency, cost, errors }

  constructor(opts = {}) {
    // Default log path: ~/.chimera/logs/requests.jsonl
    const defaultLogDir = path.join(os.homedir(), '.chimera', 'logs');
    this.#logPath = opts.logPath || path.join(defaultLogDir, 'requests.jsonl');

    // Ensure log directory exists
    this.#ensureLogDirectory();

    // Open write stream in append mode
    if (opts.enabled !== false) {
      this.#openWriteStream();
    }
  }

  /**
   * Ensure the log directory exists.
   */
  #ensureLogDirectory() {
    const dir = path.dirname(this.#logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Open write stream for appending logs.
   */
  #openWriteStream() {
    try {
      this.#writeStream = fs.createWriteStream(this.#logPath, { flags: 'a' });
    } catch (err) {
      console.error(`Failed to open log file: ${err.message}`);
    }
  }

  /**
   * Log a request/response.
   * @param {object} data - Request/response data
   */
  log(data) {
    try {
      const entry = {
        timestamp: data.timestamp || Date.now(),
        provider: data.provider,
        model: data.model,
        prompt: this.#truncatePrompt(data.prompt),
        latencyMs: data.latencyMs || 0,
        status: data.status || 'success',
        error: data.error || null,
        usage: data.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost: data.cost || 0,
      };

      // Add to in-memory cache
      this.#logs.push(entry);
      if (this.#logs.length > this.#maxInMemory) {
        this.#logs.shift();
      }

      // Write to file
      if (this.#writeStream) {
        this.#writeStream.write(JSON.stringify(entry) + '\n');
      }

      // Update aggregate stats
      this.#updateStats(entry);
    } catch (err) {
      console.error(`Failed to log request: ${err.message}`);
    }
  }

  /**
   * Truncate prompt for logging (first 200 chars).
   */
  #truncatePrompt(prompt) {
    if (!prompt) return '';
    if (typeof prompt !== 'string') {
      // Handle message array format
      if (Array.isArray(prompt)) {
        const firstUserMsg = prompt.find(m => m.role === 'user');
        if (firstUserMsg?.content) {
          prompt = firstUserMsg.content;
        } else {
          prompt = JSON.stringify(prompt);
        }
      } else {
        prompt = String(prompt);
      }
    }
    return prompt.length > 200 ? prompt.slice(0, 200) + '...' : prompt;
  }

  /**
   * Update aggregate statistics.
   */
  #updateStats(entry) {
    this.#totalRequests++;
    this.#totalLatency += entry.latencyMs || 0;
    this.#totalCost += entry.cost || 0;

    if (entry.status !== 'success') {
      this.#errorCount++;
    }

    // Per-provider stats
    if (entry.provider) {
      if (!this.#byProvider.has(entry.provider)) {
        this.#byProvider.set(entry.provider, {
          requests: 0,
          latency: 0,
          cost: 0,
          errors: 0,
        });
      }

      const providerStats = this.#byProvider.get(entry.provider);
      providerStats.requests++;
      providerStats.latency += entry.latencyMs || 0;
      providerStats.cost += entry.cost || 0;
      if (entry.status !== 'success') {
        providerStats.errors++;
      }
    }
  }

  /**
   * Get recent logs from in-memory cache.
   * @param {number} n - Number of recent entries to return
   * @returns {array} Recent log entries
   */
  getRecentLogs(n = 100) {
    return this.#logs.slice(-n);
  }

  /**
   * Read logs from file.
   * @param {number} n - Number of lines to read (from end)
   * @returns {array} Log entries
   */
  readLogsFromFile(n = 100) {
    try {
      if (!fs.existsSync(this.#logPath)) {
        return [];
      }

      const content = fs.readFileSync(this.#logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      const recentLines = lines.slice(-n);

      return recentLines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(entry => entry !== null);
    } catch (err) {
      console.error(`Failed to read logs from file: ${err.message}`);
      return [];
    }
  }

  /**
   * Get aggregate statistics.
   * @returns {object} Statistics
   */
  getStats() {
    const avgLatency = this.#totalRequests > 0
      ? Math.round(this.#totalLatency / this.#totalRequests)
      : 0;

    const errorRate = this.#totalRequests > 0
      ? (this.#errorCount / this.#totalRequests) * 100
      : 0;

    const byProvider = {};
    for (const [providerId, stats] of this.#byProvider.entries()) {
      byProvider[providerId] = {
        requests: stats.requests,
        avgLatency: stats.requests > 0 ? Math.round(stats.latency / stats.requests) : 0,
        totalCost: Math.round(stats.cost * 1000000) / 1000000, // Round to 6 decimals
        errorRate: stats.requests > 0 ? (stats.errors / stats.requests) * 100 : 0,
      };
    }

    return {
      totalRequests: this.#totalRequests,
      avgLatency,
      totalCost: Math.round(this.#totalCost * 1000000) / 1000000,
      errorRate: Math.round(errorRate * 100) / 100,
      byProvider,
    };
  }

  /**
   * Clear logs (in-memory and file).
   */
  clear() {
    try {
      // Clear in-memory
      this.#logs = [];
      this.#totalRequests = 0;
      this.#totalLatency = 0;
      this.#totalCost = 0;
      this.#errorCount = 0;
      this.#byProvider.clear();

      // Close and truncate file
      if (this.#writeStream) {
        this.#writeStream.end();
        this.#writeStream = null;
      }

      // Truncate file
      if (fs.existsSync(this.#logPath)) {
        fs.truncateSync(this.#logPath, 0);
      }

      // Reopen write stream
      this.#openWriteStream();
    } catch (err) {
      console.error(`Failed to clear logs: ${err.message}`);
    }
  }

  /**
   * Close the logger (flush and close write stream).
   */
  close() {
    if (this.#writeStream) {
      this.#writeStream.end();
      this.#writeStream = null;
    }
  }

  /**
   * Get log file path.
   */
  get logPath() {
    return this.#logPath;
  }

  /**
   * Get file size in bytes.
   */
  getLogFileSize() {
    try {
      if (fs.existsSync(this.#logPath)) {
        const stats = fs.statSync(this.#logPath);
        return stats.size;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Format stats as human-readable text.
   */
  formatStats() {
    const stats = this.getStats();
    const lines = [];

    lines.push('=== Request Logger Statistics ===');
    lines.push('');
    lines.push(`Total Requests: ${stats.totalRequests}`);
    lines.push(`Average Latency: ${stats.avgLatency}ms`);
    lines.push(`Total Cost: $${stats.totalCost.toFixed(6)}`);
    lines.push(`Error Rate: ${stats.errorRate.toFixed(2)}%`);
    lines.push('');

    if (Object.keys(stats.byProvider).length > 0) {
      lines.push('By Provider:');
      for (const [providerId, providerStats] of Object.entries(stats.byProvider)) {
        lines.push(`  ${providerId}:`);
        lines.push(`    Requests: ${providerStats.requests}`);
        lines.push(`    Avg Latency: ${providerStats.avgLatency}ms`);
        lines.push(`    Total Cost: $${providerStats.totalCost.toFixed(6)}`);
        lines.push(`    Error Rate: ${providerStats.errorRate.toFixed(2)}%`);
      }
      lines.push('');
    }

    const fileSize = this.getLogFileSize();
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    lines.push(`Log File: ${this.#logPath}`);
    lines.push(`Log File Size: ${fileSizeMB} MB`);

    return lines.join('\n');
  }
}

export default RequestLogger;
