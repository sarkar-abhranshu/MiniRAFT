/**
 * leaderManager.js
 *
 * Polls replicas' /status endpoints to identify the current RAFT leader.
 */

'use strict';

const http = require('http');

class LeaderManager {
  /**
   * Creates a leader tracker for the provided replica URLs and polling interval.
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
   * Starts periodic polling so leader changes are detected continuously.
   */
  start() {
    console.log(`[LeaderManager] Starting with replicas: ${this.replicaUrls.join(', ')}`);
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
  }

  /**
   * Stops periodic leader polling and clears the active timer.
   */
  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[LeaderManager] Stopped');
  }

  /**
   * Polls all replicas, refreshes cached states, and updates the current leader pointer.
   */
  async poll() {
    const previousLeader = this.currentLeader;

    const statusPromises = this.replicaUrls.map((url) =>
      this.getReplicaStatus(url).catch(() => null)
    );
    const results = await Promise.all(statusPromises);

    results.forEach((status, idx) => {
      const url = this.replicaUrls[idx];
      if (status) {
        this.replicaStates.set(url, status);
      } else {
        this.replicaStates.delete(url);
      }
    });

    this.currentLeader = null;
    for (const [url, status] of this.replicaStates) {
      if (status && status.state === 'LEADER') {
        this.currentLeader = url;
        break;
      }
    }

    if (this.currentLeader !== previousLeader) {
      if (this.onLeaderChange) this.onLeaderChange(this.currentLeader, previousLeader);
    }
  }

  /**
   * Fetches and parses the /status response for one replica endpoint.
   */
  getReplicaStatus(replicaUrl) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(`${replicaUrl}/status`);
      const req = http.get(urlObj, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            if (res.statusCode === 200) return resolve(JSON.parse(data));
            reject(new Error(`Status ${res.statusCode}`));
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(500);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  /**
   * Returns the currently known leader URL, or null when no leader is known.
   */
  getLeader() {
    return this.currentLeader;
  }

  /**
   * Indicates whether leader discovery currently has a valid leader endpoint.
   */
  hasLeader() {
    return this.currentLeader !== null;
  }

  /**
   * Registers a callback invoked whenever the detected leader changes.
   */
  onLeaderChangeCallback(callback) {
    this.onLeaderChange = callback;
  }
}

module.exports = { LeaderManager };
