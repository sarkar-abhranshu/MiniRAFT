/**
 * clientManager.js
 *
 * Manages connected browser clients via WebSocket.
 */

'use strict';

const WebSocket = require('ws');

class ClientManager {
  /**
   * Initializes the in-memory set that tracks active WebSocket clients.
   */
  constructor() {
    this.clients = new Set();
  }

  /**
   * Registers a new client connection and stores metadata used for logging.
   */
  addClient(ws, clientId) {
    this.clients.add({
      ws,
      clientId,
      connectedAt: new Date(),
    });
    console.log(`[ClientManager] Client ${clientId} connected (total: ${this.clients.size})`);
  }

  /**
   * Removes a disconnected client socket from the active client set.
   */
  removeClient(ws) {
    for (const client of this.clients) {
      if (client.ws === ws) {
        console.log(
          `[ClientManager] Client ${client.clientId} disconnected (total: ${this.clients.size - 1})`
        );
        this.clients.delete(client);
        return;
      }
    }
  }

  /**
   * Broadcasts a JSON message to every connected client except an optional excluded socket.
   */
  broadcast(message, excludeWs = null) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.ws === excludeWs) continue;
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      try {
        client.ws.send(data);
      } catch (error) {
        console.error(`[ClientManager] Error sending to ${client.clientId}: ${error.message}`);
      }
    }
  }

  /**
   * Sends a JSON message to one specific client if the socket is still open.
   */
  sendToClient(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(`[ClientManager] Error sending to client: ${error.message}`);
      return false;
    }
  }
}

module.exports = { ClientManager };
