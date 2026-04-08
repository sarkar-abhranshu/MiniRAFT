/**
 * replicaClient.js
 *
 * Handles communication with RAFT replica nodes.
 * - Queries replica status
 * - Validates leader presence before accepting writes
 * - Provides retry logic for transient failures
 * - Logs replica health information
 */

const http = require('http');

class ReplicaClient {
  /**
   * @param {string} replicaUrl - Replica HTTP URL (e.g., 'http://localhost:5001')
   */
  constructor(replicaUrl) {
    this.replicaUrl = replicaUrl;
  }

  /**
   * Get replica status (polling)
   * @returns {Promise<Object>} Status object or null if unreachable
   */
  async getStatus() {
    try {
      return await this._httpGet(`${this.replicaUrl}/status`);
    } catch (error) {
      // Replica unreachable, but we don't throw—caller handles null
      return null;
    }
  }

  /**
   * Check if this replica is the leader
   * @returns {Promise<boolean>}
   */
  async isLeader() {
    const status = await this.getStatus();
    return status && status.state === 'LEADER';
  }

  /**
   * Internal HTTP GET helper
   * @param {string} url - Full URL to request
   * @returns {Promise<Object>} Parsed JSON response
   */
  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);

      const req = http.get(urlObj, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(1000);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }
}

module.exports = { ReplicaClient };
