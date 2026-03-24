/**
 * rpc.js
 *
 * Express middleware factories for the two RAFT RPC endpoints:
 *
 *   POST /request-vote
 *     Received by a node when a CANDIDATE is soliciting votes.
 *     A node grants its vote if:
 *       (a) the candidate's term is >= our currentTerm, AND
 *       (b) we have not already voted for a different candidate in this term.
 *
 *   POST /heartbeat
 *     Received by FOLLOWERS (and any stale CANDIDATE/LEADER) from the current
 *     LEADER.  A valid heartbeat:
 *       • Updates our term if the leader's term is higher.
 *       • Resets our election timer — suppressing spurious elections.
 *       • If we were a LEADER with a stale term, we stop our heartbeat loop
 *         and revert to FOLLOWER.
 */

'use strict';

const axios = require('axios');
const { resetElectionTimer, clearHeartbeatTimer } = require('./timers');
const { STATES } = require('./raftNode');

const RPC_TIMEOUT = 350;

function majorityCount(node) {
  const total = node.peerNodes.length + 1;
  return Math.floor(total / 2) + 1;
}

function applyLeaderContact(node, term, leaderId, onElectionTimeout) {
  // ── Reject stale leaders ───────────────────────────────────────────────
  if (term < node.currentTerm) {
    return { accepted: false, response: { term: node.currentTerm, success: false } };
  }

  // ── Step down if stale leader/candidate ────────────────────────────────
  if (node.state === STATES.LEADER || node.state === STATES.CANDIDATE) {
    clearHeartbeatTimer(node);
  }

  if (term > node.currentTerm || node.state !== STATES.FOLLOWER) {
    node.becomeFollower(term);
  } else {
    node.currentTerm = term;
  }

  node.leaderId = leaderId || node.leaderId;
  resetElectionTimer(node, onElectionTimeout);

  return { accepted: true };
}

/**
 * Returns an Express route handler for POST /request-vote.
 *
 * @param {import('./raftNode').RaftNode} node
 * @param {Function} onElectionTimeout — used to re-arm the election timer
 *   when we discover a higher term via an incoming vote request.
 */
function handleRequestVote(node, onElectionTimeout) {
  return (req, res) => {
    const { term, candidateId } = req.body;

    // ── Reject stale candidates ────────────────────────────────────────────
    // A lower term means the candidate is from an old epoch; refuse.
    if (term < node.currentTerm) {
      console.log(
        `${node.nodeId} denied vote to ${candidateId} (stale term ${term} < ${node.currentTerm})`
      );
      return res.json({ term: node.currentTerm, voteGranted: false });
    }

    // ── Discover a newer term ──────────────────────────────────────────────
    // If the candidate has a higher term we must update our term and revert
    // to FOLLOWER before deciding whether to grant the vote.
    if (term > node.currentTerm) {
      // Stop heartbeat loop if we were previously the leader.
      if (node.state === STATES.LEADER) {
        clearHeartbeatTimer(node);
      }
      node.becomeFollower(term);
      // Re-arm election timer: we are now a follower in a new term.
      resetElectionTimer(node, onElectionTimeout);
    }

    // ── Grant or deny the vote ─────────────────────────────────────────────
    // We can vote for this candidate only if we have not yet voted in this
    // term (votedFor === null) or we already voted for the same candidate
    // (idempotent re-vote in case of retried RPC).
    const canVote =
      node.votedFor === null || node.votedFor === candidateId;

    if (canVote) {
      node.votedFor = candidateId;
      console.log(
        `${node.nodeId} granted vote to ${candidateId} for term ${term}`
      );
      return res.json({ term: node.currentTerm, voteGranted: true });
    }

    console.log(
      `${node.nodeId} denied vote to ${candidateId} ` +
        `(already voted for ${node.votedFor} in term ${term})`
    );
    return res.json({ term: node.currentTerm, voteGranted: false });
  };
}

/**
 * Returns an Express route handler for POST /heartbeat.
 *
 * @param {import('./raftNode').RaftNode} node
 * @param {Function} onElectionTimeout — used to re-arm the election timer after
 *   receiving a valid heartbeat (this resets the countdown).
 */
function handleHeartbeat(node, onElectionTimeout) {
  return (req, res) => {
    const { term, leaderId, leaderCommit } = req.body;

    const applied = applyLeaderContact(node, term, leaderId, onElectionTimeout);
    if (!applied.accepted) return res.json(applied.response);

    if (typeof leaderCommit === 'number') {
      node.commitIndex = Math.min(leaderCommit, node.log.length - 1);
    }

    return res.json({ term: node.currentTerm, success: true });
  };
}

/**
 * POST /append-entries
 * Simplified log replication: appends entries and advances commit index.
 */
function handleAppendEntries(node, onElectionTimeout) {
  return (req, res) => {
    const { term, leaderId, entries, leaderCommit } = req.body;

    const applied = applyLeaderContact(node, term, leaderId, onElectionTimeout);
    if (!applied.accepted) return res.json(applied.response);

    if (Array.isArray(entries) && entries.length > 0) {
      for (const entry of entries) {
        node.log.push(entry);
      }
    }

    if (typeof leaderCommit === 'number') {
      node.commitIndex = Math.min(leaderCommit, node.log.length - 1);
    }

    return res.json({
      term: node.currentTerm,
      success: true,
      lastIndex: node.log.length - 1,
      commitIndex: node.commitIndex,
    });
  };
}

/**
 * GET/POST /sync-log
 * Returns committed log entries only.
 */
function handleSyncLog(node) {
  return (_req, res) => {
    const committed = node.commitIndex >= 0 ? node.log.slice(0, node.commitIndex + 1) : [];
    res.json({
      term: node.currentTerm,
      nodeId: node.nodeId,
      leaderId: node.leaderId,
      commitIndex: node.commitIndex,
      committed,
    });
  };
}

/**
 * POST /client-stroke
 * Gateway submits a drawing command to the current leader.
 * The leader replicates the entry and returns the committed command.
 */
function handleClientStroke(node, onElectionTimeout) {
  return async (req, res) => {
    if (node.state !== STATES.LEADER) {
      return res.status(409).json({
        error: 'NOT_LEADER',
        term: node.currentTerm,
        leaderId: node.leaderId,
      });
    }

    const command = req.body && req.body.command;
    if (!command || typeof command !== 'object') {
      return res.status(400).json({ error: 'BAD_COMMAND' });
    }

    const entry = { term: node.currentTerm, command };
    const entryIndex = node.log.length;
    node.log.push(entry);

    const majority = majorityCount(node);
    let successCount = 1; // self
    let higherTerm = null;

    const payload = {
      term: node.currentTerm,
      leaderId: node.nodeId,
      entries: [entry],
      leaderCommit: node.commitIndex,
    };

    const requests = node.peerNodes.map(async (peerUrl) => {
      try {
        const { data } = await axios.post(`${peerUrl}/append-entries`, payload, {
          timeout: RPC_TIMEOUT,
        });

        if (data && typeof data.term === 'number' && data.term > node.currentTerm) {
          higherTerm = data.term;
          return;
        }

        if (data && data.success) {
          successCount += 1;
        }
      } catch {
        // peer down/unreachable
      }
    });

    await Promise.allSettled(requests);

    if (higherTerm !== null) {
      clearHeartbeatTimer(node);
      node.becomeFollower(higherTerm);
      resetElectionTimer(node, onElectionTimeout);
      return res.status(409).json({ error: 'STEPPED_DOWN', term: node.currentTerm });
    }

    if (successCount >= majority) {
      node.commitIndex = entryIndex;
      return res.json({
        committed: true,
        index: entryIndex,
        committedMessage: command,
      });
    }

    return res.status(503).json({ committed: false, reason: 'NO_MAJORITY' });
  };
}

module.exports = {
  handleRequestVote,
  handleHeartbeat,
  handleAppendEntries,
  handleSyncLog,
  handleClientStroke,
};
