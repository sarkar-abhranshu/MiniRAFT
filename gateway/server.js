/**
 * server.js
 *
 * MiniRAFT Gateway service
 * - WebSocket server for browser clients
 * - Forwards client strokes ONLY to the current RAFT leader
 * - Broadcasts ONLY committed strokes (as confirmed by the leader)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { LeaderManager } = require('./leaderManager');
const { ClientManager } = require('./clientManager');

const PORT = parseInt(process.env.PORT, 10) || 4000;

const DEFAULT_REPLICAS = [
  'http://replica1:5001',
  'http://replica2:5002',
  'http://replica3:5003',
];

const REPLICA_URLS = process.env.REPLICAS
  ? process.env.REPLICAS.split(',').map((url) => url.trim()).filter(Boolean)
  : DEFAULT_REPLICAS;

const LEADER_POLL_INTERVAL = parseInt(process.env.LEADER_POLL, 10) || 1000;

const strokeHistory = [];
const MAX_HISTORY = 1000;

const FRONTEND_DIR = process.env.FRONTEND_DIR
  ? path.resolve(process.env.FRONTEND_DIR)
  : path.resolve(__dirname, '../frontend');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Serves static frontend files and blocks path traversal attempts.
const httpServer = http.createServer((req, res) => {
  const requestPath = req.url === '/' ? '/index.html' : (req.url || '/index.html').split('?')[0];
  const safePath = path.normalize(requestPath).replace(/^\/+/, '');
  const filePath = path.resolve(FRONTEND_DIR, safePath);

  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  // Reads and returns the requested asset with the correct MIME type.
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server: httpServer });
const clientManager = new ClientManager();
const leaderManager = new LeaderManager(REPLICA_URLS, LEADER_POLL_INTERVAL);

/**
 * Stores a committed message in memory so new clients can be synced on connect.
 */
function rememberCommitted(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'clear') {
    strokeHistory.length = 0;
    return;
  }

  strokeHistory.push(message);
  if (strokeHistory.length > MAX_HISTORY) strokeHistory.shift();
}

/**
 * Sends the in-memory stroke history to one client as a sync payload.
 */
function sendStrokeHistoryToClient(ws) {
  clientManager.sendToClient(ws, { type: 'sync', strokes: strokeHistory });
}

/**
 * Performs a timeout-bounded POST request and returns normalized response data.
 */
async function postJson(url, body, timeoutMs = 800) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Forwards a client write command to the current leader with retry + re-discovery.
 */
async function forwardToLeader(commandMessage) {
  const MAX_ATTEMPTS = 6;
  const RETRY_DELAY_MS = 500;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let leader = leaderManager.getLeader();
    if (!leader) {
      await leaderManager.poll();
      leader = leaderManager.getLeader();
    }

    if (!leader) {
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw new Error('No leader available to accept writes');
    }

    let resp;
    try {
      resp = await postJson(`${leader}/client/append`, { command: commandMessage });
    } catch {
      await leaderManager.poll();
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw new Error('No leader available to accept writes');
    }

    if (resp.ok && resp.data) {
      if (resp.data.committedMessage) return resp.data.committedMessage;
      if (resp.data.success && resp.data.entry && resp.data.entry.command) {
        return resp.data.entry.command;
      }
    }

    if (resp.status === 409 || resp.status === 503 || resp.status === 403) {
      await leaderManager.poll();
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
    }

    throw new Error('Leader rejected request');
  }

  throw new Error('No leader available to accept writes');
}

// Registers each browser socket and routes inbound messages to RAFT leader writes.
wss.on('connection', (ws) => {
  const clientId = `Client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  clientManager.addClient(ws, clientId);
  sendStrokeHistoryToClient(ws);

  // Handles incoming client commands and forwards only write operations to the leader.
  ws.on('message', async (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      console.error(`[Gateway] Bad JSON from ${clientId}: ${error.message}`);
      return;
    }

    try {
      if (message.type === 'stroke' || message.type === 'clear') {
        const committed = await forwardToLeader(message);
        rememberCommitted(committed);
        clientManager.broadcast(committed);
        return;
      }

      if (message.type === 'stroke_complete') {
        console.log(`[Gateway] Stroke added: client=${clientId} strokeId=${message.strokeId || 'unknown'} segments=${message.segments || 0}`);
        return;
      }

      if (message.type === 'sync') {
        sendStrokeHistoryToClient(ws);
        return;
      }

      console.log(`[Gateway] Unknown message type: ${message.type}`);
    } catch (error) {
      clientManager.sendToClient(ws, { type: 'error', message: error.message });
    }
  });

  // Removes disconnected clients from the active socket registry.
  ws.on('close', () => clientManager.removeClient(ws));
  // Logs socket-level errors so transient client issues are visible in gateway logs.
  ws.on('error', (error) => console.error(`[Gateway] WebSocket error: ${error.message}`));
});

// Logs top-level WebSocket server errors.
wss.on('error', (error) => {
  console.error(`[Gateway] Server error: ${error.message}`);
});

// Records leader transitions observed by periodic leader polling.
leaderManager.onLeaderChangeCallback((newLeader, oldLeader) => {
  console.log(`[Gateway] Leader changed: ${oldLeader || 'none'} -> ${newLeader || 'none'}`);
});

leaderManager.start();

// Starts the combined HTTP + WebSocket listener.
httpServer.listen(PORT, () => {
  console.log(`[Gateway] HTTP + WebSocket listening on :${PORT}`);
});

console.log(`[Gateway] Frontend directory: ${FRONTEND_DIR}`);
console.log(`[Gateway] Replicas: ${REPLICA_URLS.join(', ')}`);

// Gracefully stops polling, closes sockets, and then closes the HTTP server.
process.on('SIGINT', () => {
  console.log('\n[Gateway] Shutting down...');
  leaderManager.stop();

  // Closes every active client connection before shutting down the server.
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.close();
  });

  // Closes WebSocket and HTTP listeners in sequence.
  wss.close(() => {
    httpServer.close(() => process.exit(0));
  });
  // Forces process exit if graceful shutdown does not finish in time.
  setTimeout(() => process.exit(1), 3000);
});
