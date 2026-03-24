/**
 * server.js
 *
 * MiniRAFT Gateway service
 * - WebSocket server for browser clients
 * - Forwards client strokes ONLY to the current RAFT leader
 * - Broadcasts ONLY committed strokes (as confirmed by the leader)
 */

'use strict';

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

const wss = new WebSocket.Server({ port: PORT });
const clientManager = new ClientManager();
const leaderManager = new LeaderManager(REPLICA_URLS, LEADER_POLL_INTERVAL);

function rememberCommitted(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'clear') {
    strokeHistory.length = 0;
    return;
  }

  strokeHistory.push(message);
  if (strokeHistory.length > MAX_HISTORY) strokeHistory.shift();
}

function sendStrokeHistoryToClient(ws) {
  clientManager.sendToClient(ws, { type: 'sync', strokes: strokeHistory });
}

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

async function forwardToLeader(commandMessage) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let leader = leaderManager.getLeader();
    if (!leader) {
      await leaderManager.poll();
      leader = leaderManager.getLeader();
    }

    if (!leader) {
      throw new Error('No leader available to accept writes');
    }

    let resp;
    try {
      resp = await postJson(`${leader}/client-stroke`, { command: commandMessage });
    } catch {
      await leaderManager.poll();
      continue;
    }

    if (resp.ok && resp.data && resp.data.committedMessage) {
      return resp.data.committedMessage;
    }

    // Leader changed or couldn't commit; refresh leader and retry once.
    if (resp.status === 409 || resp.status === 503) {
      await leaderManager.poll();
      continue;
    }

    throw new Error('Leader rejected request');
  }

  throw new Error('No leader available to accept writes');
}

wss.on('connection', (ws) => {
  const clientId = `Client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  clientManager.addClient(ws, clientId);
  sendStrokeHistoryToClient(ws);

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

      if (message.type === 'sync') {
        sendStrokeHistoryToClient(ws);
        return;
      }

      console.log(`[Gateway] Unknown message type: ${message.type}`);
    } catch (error) {
      clientManager.sendToClient(ws, { type: 'error', message: error.message });
    }
  });

  ws.on('close', () => clientManager.removeClient(ws));
  ws.on('error', (error) => console.error(`[Gateway] WebSocket error: ${error.message}`));
});

wss.on('error', (error) => {
  console.error(`[Gateway] Server error: ${error.message}`);
});

leaderManager.onLeaderChangeCallback((newLeader, oldLeader) => {
  console.log(`[Gateway] Leader changed: ${oldLeader || 'none'} -> ${newLeader || 'none'}`);
});

leaderManager.start();

console.log(`[Gateway] WebSocket listening on :${PORT}`);
console.log(`[Gateway] Replicas: ${REPLICA_URLS.join(', ')}`);

process.on('SIGINT', () => {
  console.log('\n[Gateway] Shutting down...');
  leaderManager.stop();

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.close();
  });

  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000);
});
