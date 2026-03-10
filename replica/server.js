/**
 * server.js
 *
 * Entry point for a RAFT replica node.
 *
 * Configuration via environment variables:
 *   NODE_ID   — unique node name, e.g. "replica1"  (default: "replica1")
 *   PORT      — HTTP port to listen on, e.g. 5001   (default: 5001)
 *   PEERS     — comma-separated peer URLs (overrides the default cluster list)
 *               e.g. "http://localhost:5002,http://localhost:5003"
 *
 * Usage — Docker (hostnames resolved by Docker networking):
 *   NODE_ID=replica1 PORT=5001 node server.js
 *
 * Usage — local (all replicas on localhost with different ports):
 *   NODE_ID=replica1 PORT=5001 PEERS=http://localhost:5002,http://localhost:5003 node server.js
 *   NODE_ID=replica2 PORT=5002 PEERS=http://localhost:5001,http://localhost:5003 node server.js
 *   NODE_ID=replica3 PORT=5003 PEERS=http://localhost:5001,http://localhost:5002 node server.js
 */

'use strict';

const express  = require('express');
const { RaftNode }           = require('./raftNode');
const { resetElectionTimer } = require('./timers');
const { startElection }      = require('./election');
const { handleRequestVote, handleHeartbeat } = require('./rpc');

// ─── Configuration ───────────────────────────────────────────────────────────

const NODE_ID = process.env.NODE_ID || 'replica1';
const PORT    = parseInt(process.env.PORT, 10) || 5001;

/**
 * Default cluster topology.
 * When running in Docker, container hostnames resolve automatically.
 * When running locally, override with the PEERS env variable.
 */
const DEFAULT_CLUSTER = [
  { id: 'replica1', url: 'http://replica1:5001' },
  { id: 'replica2', url: 'http://replica2:5002' },
  { id: 'replica3', url: 'http://replica3:5003' },
];

function resolvePeers() {
  if (process.env.PEERS) {
    // Explicit peer list from environment (used for local / non-Docker runs).
    return process.env.PEERS.split(',').map((u) => u.trim()).filter(Boolean);
  }
  // Filter self out of the default cluster list.
  return DEFAULT_CLUSTER
    .filter((n) => n.id !== NODE_ID)
    .map((n) => n.url);
}

const PEER_URLS = resolvePeers();

// ─── RAFT node ────────────────────────────────────────────────────────────────

const node = new RaftNode(NODE_ID, PEER_URLS);

// ─── Election timeout callback ────────────────────────────────────────────────
//
// Called whenever the election timer fires without a heartbeat having been
// received.  This is the primary trigger for starting a new election.

function onElectionTimeout() {
  // A LEADER never needs to hold an election — it already won one.
  if (node.isLeader()) return;

  startElection(node, onElectionTimeout).catch((err) => {
    // Unexpected error during election (e.g. Node.js runtime error, not just
    // a network failure — those are already handled inside election.js).
    console.error(`Unexpected election error on ${NODE_ID}: ${err.message}`);
    // Ensure the node can still participate in future elections.
    node.becomeFollower(node.currentTerm);
    resetElectionTimer(node, onElectionTimeout);
  });
}

// ─── Express application ──────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── RAFT RPC endpoints ───────────────────────────────────────────────────────

// RequestVote — a CANDIDATE asks us to vote for it.
app.post('/request-vote', handleRequestVote(node, onElectionTimeout));

// Heartbeat — the LEADER notifies us it is still alive.
app.post('/heartbeat', handleHeartbeat(node, onElectionTimeout));

// ── Debug / health endpoint ───────────────────────────────────────────────────
// Useful for verifying state from the outside:
//   curl http://localhost:5001/status
app.get('/status', (_req, res) => {
  res.json({
    nodeId:      node.nodeId,
    state:       node.state,
    currentTerm: node.currentTerm,
    votedFor:    node.votedFor,
    peers:       node.peerNodes,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Node ${NODE_ID} listening on port ${PORT}`);
  console.log(`  Peers: ${PEER_URLS.join(', ') || '(none)'}`);

  // Kick off the RAFT protocol: every node begins as a FOLLOWER and waits
  // for a heartbeat; if none arrives within the election timeout it starts
  // a leader election.
  resetElectionTimer(node, onElectionTimeout);
});
