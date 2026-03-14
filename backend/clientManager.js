/**
 * clientManager.js
 *
 * Manages connected browser clients via WebSocket.
 * - Tracks all active client connections
 * - Broadcasts messages to all clients
 * - Handles client disconnections
 * - Provides client enumeration for debugging
 */

const WebSocket = require('ws');

class ClientManager {
  constructor() {
    this.clients = new Set();
  }

  /**
   * Register a new client connection
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} clientId - Unique client identifier
   */
  addClient(ws, clientId) {
    this.clients.add({
      ws,
      clientId,
      connectedAt: new Date(),
    });
    console.log(
      `[ClientManager] Client ${clientId} connected (total: ${this.clients.size})`
    );
  }

  /**
   * Unregister a client connection
   * @param {WebSocket} ws - WebSocket connection
   */
  removeClient(ws) {
    for (const client of this.clients) {
      if (client.ws === ws) {
        console.log(
          `[ClientManager] Client ${client.clientId} disconnected (total: ${
            this.clients.size - 1
          })`
        );
        this.clients.delete(client);
        return;
      }
    }
  }

  /**
   * Broadcast a message to all connected clients
   * @param {Object} message - Message object to broadcast
   * @param {WebSocket} excludeWs - Optional: do not send to this client
   */
  broadcast(message, excludeWs = null) {
    const data = JSON.stringify(message);
    let sentCount = 0;
    let failedCount = 0;

    for (const client of this.clients) {
      // Skip excluded client
      if (client.ws === excludeWs) {
        continue;
      }

      // Skip if connection is not open
      if (client.ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        client.ws.send(data);
        sentCount++;
      } catch (error) {
        console.error(
          `[ClientManager] Error sending to ${client.clientId}: ${error.message}`
        );
        failedCount++;
      }
    }

    if (sentCount > 0 || failedCount > 0) {
      console.log(
        `[ClientManager] Broadcast: sent to ${sentCount} clients, ${failedCount} failed`
      );
    }
  }

  /**
   * Send a message to a specific client
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Message object
   */
  sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error(`[ClientManager] Error sending to client: ${error.message}`);
        return false;
      }
    }
    return false;
  }

  /**
   * Get count of connected clients
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * Get list of connected client IDs
   */
  getClientIds() {
    return Array.from(this.clients).map((c) => c.clientId);
  }

  /**
   * Get detailed client information
   */
  getClientInfo() {
    return Array.from(this.clients).map((c) => ({
      clientId: c.clientId,
      connectedAt: c.connectedAt,
      readyState: c.ws.readyState,
    }));
  }
}

module.exports = { ClientManager };
