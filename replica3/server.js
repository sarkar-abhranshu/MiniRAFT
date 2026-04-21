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

"use strict";

require("events").defaultMaxListeners = 50;

const express = require("express");
const { RaftNode } = require("./raftNode");
const { resetElectionTimer } = require("./timers");
const { startElection } = require("./election");
const { handleRequestVote, handleHeartbeat } = require("./rpc");
const { RaftLog } = require("./log");
const { ReplicationService } = require("./replication");

// ─── Configuration ───────────────────────────────────────────────────────────

const NODE_ID = process.env.NODE_ID || "replica1";
const PORT = parseInt(process.env.PORT, 10) || 5001;

// Resolves peer replica URLs from environment variables with sensible fallbacks.
function resolvePeers() {
  if (process.env.PEERS) {
    return process.env.PEERS.split(",")
      .map((u) => u.trim())
      .filter(Boolean);
  }
  // Fallback: derive peers from a CLUSTER env var listing all node URLs
  if (process.env.CLUSTER) {
    const self = process.env.NODE_ID || NODE_ID;
    return process.env.CLUSTER.split(",")
      .map((u) => u.trim())
      .filter((u) => !u.includes(`/${self}`) && !u.includes(`:${PORT}`));
  }
  console.warn(
    `[${NODE_ID}] WARNING: No PEERS or CLUSTER env var set. Node will run isolated.`,
  );
  return [];
}

const PEER_URLS = resolvePeers();

// ─── RAFT node ────────────────────────────────────────────────────────────────

const node = new RaftNode(NODE_ID, PEER_URLS);
const raftLog = new RaftLog();
const replicationService = new ReplicationService(node, raftLog);

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
app.post("/request-vote", handleRequestVote(node, onElectionTimeout));

// Heartbeat — the LEADER notifies us it is still alive.
app.post("/heartbeat", handleHeartbeat(node, onElectionTimeout));

// Leader route: accepts client commands and starts replication.
app.post("/client/append", async (req, res) => {
  if (!node.isLeader()) {
    return res.status(403).json({
      success: false,
      error: "NOT_LEADER",
      nodeId: node.nodeId,
      state: node.state,
    });
  }

  const command = req.body && req.body.command ? req.body.command : req.body;
  if (!command || typeof command !== "object") {
    return res.status(400).json({
      success: false,
      error: "INVALID_COMMAND",
    });
  }

  try {
    const replicationResult =
      await replicationService.replicateCommand(command);

    if (!replicationResult.success) {
      return res.status(503).json(replicationResult);
    }

    return res.json(replicationResult);
  } catch (error) {
    console.error(`Replication error on ${NODE_ID}: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: "REPLICATION_ERROR",
      message: error.message,
    });
  }
});

// Follower route: receives AppendEntries and stores entries.
app.post("/append", (req, res) => {
  const result = replicationService.applyAppendFromLeader(req.body || {});

  if (result.success) {
    // AppendEntries also acts as a liveness signal from the leader.
    resetElectionTimer(node, onElectionTimeout);
  }

  return res.json(result);
});

// Compatibility alias for AppendEntries path naming.
app.post("/append-entries", (req, res) => {
  const result = replicationService.applyAppendFromLeader(req.body || {});
  if (result.success) {
    resetElectionTimer(node, onElectionTimeout);
  }
  return res.json(result);
});

// GET /sync-log?from=N — returns all committed log entries from index N onward
app.get("/sync-log", (req, res) => {
  const fromIndex = parseInt(req.query.from, 10) || 0;
  const entries = raftLog.getEntriesFrom(fromIndex);
  return res.json({
    nodeId: node.nodeId,
    commitIndex: raftLog.commitIndex,
    entries,
  });
});

// POST /sync-log — leader pushes missing entries to a rejoining follower
app.post("/sync-log", (req, res) => {
  const { entries, commitIndex } = req.body || {};
  if (Array.isArray(entries)) {
    raftLog.replaceAll(entries);
  }
  if (Number.isInteger(commitIndex)) {
    raftLog.commit(commitIndex);
  }
  resetElectionTimer(node, onElectionTimeout);
  return res.json({
    success: true,
    nodeId: node.nodeId,
    commitIndex: raftLog.commitIndex,
    lastIndex: raftLog.getLastIndex(),
  });
});

// Manual helper: allow forcing a full-log sync from the current leader.
app.post("/sync-followers", async (_req, res) => {
  if (!node.isLeader()) {
    return res.status(403).json({
      success: false,
      error: "NOT_LEADER",
      nodeId: node.nodeId,
      state: node.state,
    });
  }

  const syncResult = await replicationService.syncFollowers();
  return res.json(syncResult);
});

// Returns the full local log snapshot for debugging/inspection.
app.get("/log", (_req, res) => {
  res.json({
    nodeId: node.nodeId,
    commitIndex: raftLog.commitIndex,
    entries: raftLog.getAllEntries(),
  });
});

// ── Debug / health endpoint ───────────────────────────────────────────────────
// Useful for verifying state from the outside:
//   curl http://localhost:5001/status
app.get("/status", (_req, res) => {
  res.json({
    nodeId: node.nodeId,
    state: node.state,
    currentTerm: node.currentTerm,
    votedFor: node.votedFor,
    peers: node.peerNodes,
    commitIndex: raftLog.commitIndex,
    lastLogIndex: raftLog.getLastIndex(),
    lastLogTerm: raftLog.getLastTerm(),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Node ${NODE_ID} listening on port ${PORT}`);
  console.log(`  Peers: ${PEER_URLS.join(", ") || "(none)"}`);

  // Kick off the RAFT protocol: every node begins as a FOLLOWER and waits
  // for a heartbeat; if none arrives within the election timeout it starts
  // a leader election.
  resetElectionTimer(node, onElectionTimeout);
});
