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

const { resetElectionTimer, clearHeartbeatTimer } = require('./timers');
const { STATES } = require('./raftNode');

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
    const { term, leaderId } = req.body;

    // ── Reject stale leaders ───────────────────────────────────────────────
    // A lower term means this heartbeat is from a deposed leader; ignore it.
    if (term < node.currentTerm) {
      console.log(
        `${node.nodeId} rejected stale heartbeat from ${leaderId} ` +
          `(term ${term} < ${node.currentTerm})`
      );
      return res.json({ term: node.currentTerm, success: false });
    }

    // ── Step down if we are a stale leader or candidate ───────────────────
    // A valid heartbeat (term >= our term) from another node means there is
    // already an elected leader; we must yield.
    if (node.state === STATES.LEADER || node.state === STATES.CANDIDATE) {
      // Stop sending our own heartbeats before stepping down.
      clearHeartbeatTimer(node);
      console.log(
        `${node.nodeId} stepping down from ${node.state} due to heartbeat from ${leaderId}`
      );
    }

    // Update term and revert to FOLLOWER. Only log/reset votedFor when the
    // term actually changes — avoids noisy repeated "became FOLLOWER" lines on
    // every steady-state heartbeat while already a follower at the same term.
    if (term > node.currentTerm || node.state !== STATES.FOLLOWER) {
      node.becomeFollower(term);
    } else {
      // Same term, already follower: just sync term silently.
      node.currentTerm = term;
    }

    // ── Reset election timer ───────────────────────────────────────────────
    // This is the key mechanism that prevents spurious elections: every valid
    // heartbeat resets the countdown, so followers only call an election when
    // the leader is truly unreachable.
    resetElectionTimer(node, onElectionTimeout);

    return res.json({ term: node.currentTerm, success: true });
  };
}

module.exports = { handleRequestVote, handleHeartbeat };
