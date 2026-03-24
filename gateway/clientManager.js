/**
 * clientManager.js
 *
 * Manages connected browser clients via WebSocket.
 */

'use strict';

const WebSocket = require('ws');

class ClientManager {
  constructor() {
    this.clients = new Set();
  }

  addClient(ws, clientId) {
    this.clients.add({
      ws,
      clientId,
      connectedAt: new Date(),
    });
    console.log(`[ClientManager] Client ${clientId} connected (total: ${this.clients.size})`);
  }

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
