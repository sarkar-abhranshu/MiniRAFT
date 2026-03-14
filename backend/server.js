/**
 * server.js
 *
 * Gateway Server for Distributed Drawing Board with Mini-RAFT Cluster
 *
 * This WebSocket gateway:
 * - Accepts connections from browser clients
 * - Manages real-time stroke broadcast
 * - Discovers and tracks the current RAFT leader
 * - Handles replica failures gracefully
 * - Maintains stroke history for client synchronization
 *
 * Configuration via environment variables:
 *   PORT          — WebSocket port (default: 8080)
 *   REPLICAS      — comma-separated replica URLs (default: http://localhost:5001,http://localhost:5002,http://localhost:5003)
 *   LEADER_POLL   — leader poll interval in ms (default: 1000)
 */

'use strict';

const WebSocket = require('ws');
const { LeaderManager } = require('./leaderManager');
const { ClientManager } = require('./clientManager');
const { ReplicaClient } = require('./replicaClient');

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT, 10) || 8080;

// Default replica URLs (for Docker and local running)
const DEFAULT_REPLICAS = [
  'http://localhost:5001',
  'http://localhost:5002',
  'http://localhost:5003',
];

// Override with REPLICAS env var if provided (comma-separated)
const REPLICA_URLS = process.env.REPLICAS
  ? process.env.REPLICAS.split(',').map((url) => url.trim())
  : DEFAULT_REPLICAS;

const LEADER_POLL_INTERVAL = parseInt(process.env.LEADER_POLL, 10) || 1000;

// ─── State ────────────────────────────────────────────────────────────────────

const strokeHistory = [];
const MAX_HISTORY = 1000;

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocket.Server({ port: PORT });
const clientManager = new ClientManager();
const leaderManager = new LeaderManager(REPLICA_URLS, LEADER_POLL_INTERVAL);

// ─── Event Handlers ───────────────────────────────────────────────────────────

/**
 * Handle new WebSocket connection
 */
wss.on('connection', (ws, _req) => {
  const clientId = `Client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Register client
  clientManager.addClient(ws, clientId);

  // Send current stroke history to newly connected client
  sendStrokeHistoryToClient(ws);

  /**
   * Handle incoming messages
   */
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'stroke':
          handleStroke(message);
          break;

        case 'clear':
          handleClear();
          break;

        case 'sync':
          handleSync(ws);
          break;

        default:
          console.log(`[Gateway] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[Gateway] Error parsing message from ${clientId}: ${error.message}`);
    }
  });

  /**
   * Handle client disconnect
   */
  ws.on('close', () => {
    clientManager.removeClient(ws);
  });

  /**
   * Handle client errors
   */
  ws.on('error', (error) => {
    console.error(`[Gateway] WebSocket error: ${error.message}`);
  });
});

/**
 * Handle server errors
 */
wss.on('error', (error) => {
  console.error(`[Gateway] Server error: ${error.message}`);
});

// ─── Message Handlers ─────────────────────────────────────────────────────────

/**
 * Handle incoming stroke from client
 * Stores locally and broadcasts to all clients
 */
function handleStroke(stroke) {
  // Store in history
  strokeHistory.push(stroke);
  if (strokeHistory.length > MAX_HISTORY) {
    strokeHistory.shift();
  }

  // Broadcast to all clients
  clientManager.broadcast(stroke);

  console.log(`[Gateway] Stroke stored and broadcasted (history: ${strokeHistory.length})`);
}

/**
 * Handle clear board request
 */
function handleClear() {
  strokeHistory.length = 0;

  const clearMessage = { type: 'clear' };
  clientManager.broadcast(clearMessage);

  console.log('[Gateway] Board cleared and broadcasted');
}

/**
 * Handle sync request from client
 * Send full stroke history
 */
function handleSync(ws) {
  sendStrokeHistoryToClient(ws);
}

/**
 * Send stroke history to a specific client
 */
function sendStrokeHistoryToClient(ws) {
  const syncMessage = {
    type: 'sync',
    strokes: strokeHistory,
  };

  clientManager.sendToClient(ws, syncMessage);
  console.log(`[Gateway] Sync response sent (${strokeHistory.length} strokes)`);
}

// ─── Leader Manager Callbacks ─────────────────────────────────────────────────

/**
 * React to leader changes
 */
leaderManager.onLeaderChangeCallback((newLeader, oldLeader) => {
  const oldId = oldLeader ? new URL(oldLeader).port : 'none';
  const newId = newLeader ? new URL(newLeader).port : 'none';

  if (newLeader) {
    console.log(
      `[Gateway] ✓ NEW LEADER DETECTED: port ${newId} (was: ${oldId})`
    );
  } else {
    console.log(`[Gateway] ✗ NO LEADER AVAILABLE (was: ${oldId})`);
  }
});

// ─── Startup & Shutdown ───────────────────────────────────────────────────────

console.log(`
╔════════════════════════════════════════════════════════════════╗
║  Mini-RAFT Gateway Server                                      ║
║  WebSocket: ws://localhost:${PORT}                                      ║
║  Replicas:  ${REPLICA_URLS.join(', ')}  ║
╚════════════════════════════════════════════════════════════════╝
`);

// Start leader polling
leaderManager.start();

/**
 * Graceful shutdown
 */
process.on('SIGINT', () => {
  console.log('\n[Gateway] Shutting down...');

  // Stop leader polling
  leaderManager.stop();

  // Close all client connections
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  });

  // Close WebSocket server
  wss.close(() => {
    console.log('[Gateway] Server closed');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    console.error('[Gateway] Forced shutdown');
    process.exit(1);
  }, 5000);
});

console.log('[Gateway] Listening for connections...');
console.log('[Gateway] Press Ctrl+C to stop\n');
