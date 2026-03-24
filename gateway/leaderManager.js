/**
 * leaderManager.js
 *
 * Polls replicas' /status endpoints to identify the current RAFT leader.
 */

'use strict';

const http = require('http');

class LeaderManager {
  constructor(replicaUrls, pollInterval = 1000) {
    this.replicaUrls = replicaUrls;
    this.pollInterval = pollInterval;
    this.currentLeader = null;
    this.replicaStates = new Map();
    this.pollTimer = null;
    this.onLeaderChange = null;
  }

  start() {
    console.log(`[LeaderManager] Starting with replicas: ${this.replicaUrls.join(', ')}`);
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[LeaderManager] Stopped');
  }

  async poll() {
    const previousLeader = this.currentLeader;

    const statusPromises = this.replicaUrls.map((url) =>
      this.getReplicaStatus(url).catch(() => null)
    );
    const results = await Promise.all(statusPromises);

    results.forEach((status, idx) => {
      if (status) this.replicaStates.set(this.replicaUrls[idx], status);
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

  getLeader() {
    return this.currentLeader;
  }

  hasLeader() {
    return this.currentLeader !== null;
  }

  onLeaderChangeCallback(callback) {
    this.onLeaderChange = callback;
  }
}

module.exports = { LeaderManager };
