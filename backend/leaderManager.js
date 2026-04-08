/**
 * leaderManager.js
 *
 * Manages leader discovery and tracking across RAFT replicas.
 * - Maintains list of replica endpoints
 * - Polls /status to find current leader
 * - Detects leader changes
 * - Provides leader-aware operations
 */

const http = require('http');

class LeaderManager {
  /**
   * @param {string[]} replicaUrls - Array of replica HTTP URLs (e.g., ['http://localhost:5001', ...])
   * @param {number} pollInterval - How often to check for leader changes (ms)
   */
  constructor(replicaUrls, pollInterval = 1000) {
    this.replicaUrls = replicaUrls;
    this.pollInterval = pollInterval;
    this.currentLeader = null;
    this.replicaStates = new Map();
    this.pollTimer = null;
    this.onLeaderChange = null;
  }

  /**
   * Start polling for leader changes
   */
  start() {
    console.log(`[LeaderManager] Starting with replicas: ${this.replicaUrls.join(', ')}`);
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
  }

  /**
   * Stop polling
   */
  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[LeaderManager] Stopped');
  }

  /**
   * Poll all replicas for status
   */
  async poll() {
    const previousLeader = this.currentLeader;

    // Query all replicas in parallel
    const statusPromises = this.replicaUrls.map((url) =>
      this.getReplicaStatus(url).catch((err) => {
        // Replica is unreachable, but we continue
        return null;
      })
    );

    const results = await Promise.all(statusPromises);

    // Update internal state map
    results.forEach((status, idx) => {
      if (status) {
        this.replicaStates.set(this.replicaUrls[idx], status);
      }
    });

    // Find leader: a LEADER node's status will show state === 'LEADER'
    this.currentLeader = null;
    for (const [url, status] of this.replicaStates) {
      if (status && status.state === 'LEADER') {
        this.currentLeader = url;
        break;
      }
    }

    // Notify if leader changed
    if (this.currentLeader !== previousLeader) {
      const oldLeader = previousLeader || 'none';
      const newLeader = this.currentLeader || 'none';
      console.log(`[LeaderManager] Leader changed: ${oldLeader} → ${newLeader}`);
      
      if (this.onLeaderChange) {
        this.onLeaderChange(this.currentLeader, previousLeader);
      }
    }
  }

  /**
   * Fetch status from a single replica
   * @param {string} replicaUrl - e.g., 'http://localhost:5001'
   */
  getReplicaStatus(replicaUrl) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(`${replicaUrl}/status`);

      const req = http.get(urlObj, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const status = JSON.parse(data);
              resolve(status);
            } else {
              reject(new Error(`Status ${res.statusCode}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.setTimeout(500); // 500ms timeout per request
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  /**
   * Get the current leader URL
   */
  getLeader() {
    return this.currentLeader;
  }

  /**
   * Check if a leader exists
   */
  hasLeader() {
    return this.currentLeader !== null;
  }

  /**
   * Get all replica states
   */
  getReplicaStates() {
    return Object.fromEntries(this.replicaStates);
  }

  /**
   * Register callback for leader changes
   */
  onLeaderChangeCallback(callback) {
    this.onLeaderChange = callback;
  }
}

module.exports = { LeaderManager };
