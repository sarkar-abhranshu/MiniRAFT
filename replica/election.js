/**
 * election.js
 *
 * Implements the RAFT leader-election algorithm:
 *
 * startElection()
 *   1. Node transitions to CANDIDATE; increments term; casts self-vote.
 *   2. Sends RequestVote RPCs to every peer in parallel.
 *   3. Tallies responses as they arrive:
 *        • If a peer returns a higher term → revert to FOLLOWER immediately.
 *        • If voteGranted === true       → increment vote count.
 *        • If vote count reaches majority → transition to LEADER and start
 *          sending periodic heartbeats.
 *   4. If election ends without a majority (split vote / unreachable peers)
 *      → revert to FOLLOWER and restart the election timer so a new election
 *        can begin after another random timeout.
 *
 * sendHeartbeats()
 *   Called by the LEADER on every heartbeat tick.
 *   If any peer responds with a higher term the leader steps down.
 */

'use strict';

const axios  = require('axios');
const { STATES } = require('./raftNode');
const {
  resetElectionTimer,
  clearElectionTimer,
  startHeartbeatTimer,
  clearHeartbeatTimer,
} = require('./timers');

// Hard timeout for any single peer RPC call (ms).
// Must be well below ELECTION_TIMEOUT_MIN so that an unresponsive peer does
// not block the election for longer than the election window.
const RPC_TIMEOUT = 300;

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Sends a single RequestVote RPC to one peer.
 * Returns the peer's response object, or null on network failure.
 *
 * @param {string} peerUrl
 * @param {number} term        — candidate's current term
 * @param {string} candidateId — candidate's nodeId
 * @returns {Promise<{term: number, voteGranted: boolean}|null>}
 */
async function requestVoteFromPeer(peerUrl, term, candidateId) {
  try {
    const { data } = await axios.post(
      `${peerUrl}/request-vote`,
      { term, candidateId },
      { timeout: RPC_TIMEOUT }
    );
    return data;
  } catch (err) {
    // Peer is unreachable or timed out — treat as no vote (RAFT handles this
    // gracefully: the candidate simply won't receive that vote).
    console.log(`  RequestVote to ${peerUrl} failed: ${err.message}`);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sends a heartbeat AppendEntries (simplified) RPC to every peer.
 * If any peer signals a higher term the leader steps down immediately.
 *
 * @param {import('./raftNode').RaftNode} node
 * @param {Function} onStepDown — called with the higher term when leader must step down
 */
async function sendHeartbeats(node, onStepDown) {
  // Safety: only a LEADER should be sending heartbeats.
  if (node.state !== STATES.LEADER) return;

  console.log(`Leader ${node.nodeId} sending heartbeat (term ${node.currentTerm})`);

  // Guard against calling onStepDown more than once when multiple peers
  // simultaneously return a higher term.
  let steppedDown = false;

  const requests = node.peerNodes.map(async (peerUrl) => {
    try {
      const { data } = await axios.post(
        `${peerUrl}/heartbeat`,
        { term: node.currentTerm, leaderId: node.nodeId },
        { timeout: RPC_TIMEOUT }
      );

      // If a peer reports a higher term we are no longer the legitimate leader.
      if (!steppedDown && data.term && data.term > node.currentTerm) {
        steppedDown = true;
        console.log(
          `  ${node.nodeId} discovered higher term ${data.term} via heartbeat to ${peerUrl} — stepping down`
        );
        onStepDown(data.term);
      }
    } catch (err) {
      // Unreachable peer — silently continue.  The peer's election timer will
      // eventually fire and it will start a new election with an updated term,
      // which will cause this leader to step down at that point.
      console.log(`  Heartbeat to ${peerUrl} failed: ${err.message}`);
    }
  });

  await Promise.allSettled(requests);
}

/**
 * Runs a complete RAFT leader-election round.
 *
 * @param {import('./raftNode').RaftNode} node
 * @param {Function} onElectionTimeout — the same callback used by the election
 *   timer; passed through so that after a failed election (or a leader step-down)
 *   we can arm a new timer with the correct callback.
 */
async function startElection(node, onElectionTimeout) {
  // Do not start an election if we somehow already lead.
  if (node.state === STATES.LEADER) return;

  // ── Step 1: become CANDIDATE ────────────────────────────────────────────
  node.becomeCandidate();

  const term        = node.currentTerm;
  const candidateId = node.nodeId;

  // Self-vote counts as the first vote.
  const totalNodes = node.peerNodes.length + 1; // peers + self
  const majority   = Math.floor(totalNodes / 2) + 1; // e.g. 2 out of 3
  let votesReceived = 1;

  console.log(
    `${node.nodeId} requesting votes for term ${term} (need ${majority}/${totalNodes})`
  );

  // ── Step 2: send RequestVote to all peers in parallel ───────────────────
  const results = await Promise.allSettled(
    node.peerNodes.map((url) => requestVoteFromPeer(url, term, candidateId))
  );

  // ── Step 3: tally votes ─────────────────────────────────────────────────
  for (let i = 0; i < results.length; i++) {
    // A different election (new term) may have started while we were waiting.
    // Abort counting if we are no longer a candidate (e.g. we received a
    // heartbeat from a legitimate leader and stepped down via rpc.js).
    if (node.state !== STATES.CANDIDATE || node.currentTerm !== term) {
      console.log(
        `${node.nodeId} aborting vote count — state changed to ${node.state} (term ${node.currentTerm})`
      );
      return;
    }

    const result  = results[i];
    const peerUrl = node.peerNodes[i];

    // Network error → no vote
    if (result.status !== 'fulfilled' || result.value === null) continue;

    const { term: peerTerm, voteGranted } = result.value;

    // Peer has a higher term → we are stale; revert immediately.
    if (peerTerm > node.currentTerm) {
      console.log(
        `  ${node.nodeId} discovered higher term ${peerTerm} from ${peerUrl} — reverting to FOLLOWER`
      );
      node.becomeFollower(peerTerm);
      resetElectionTimer(node, onElectionTimeout);
      return;
    }

    if (voteGranted) {
      votesReceived += 1;
      console.log(`  Received vote from ${peerUrl} (total: ${votesReceived})`);
    }

    // ── Step 4: check for majority ────────────────────────────────────────
    if (votesReceived >= majority) {
      node.becomeLeader();
      clearElectionTimer(node);

      // Start heartbeat loop; step down if a higher term is ever discovered.
      startHeartbeatTimer(node, () =>
        sendHeartbeats(node, (higherTerm) => {
          clearHeartbeatTimer(node); // stop sending heartbeats first
          node.becomeFollower(higherTerm);
          resetElectionTimer(node, onElectionTimeout); // re-arm as follower
        })
      );
      return;
    }
  }

  // ── Step 5: election failed (split vote or not enough peers) ────────────
  if (node.state === STATES.CANDIDATE) {
    console.log(
      `${node.nodeId} did not win election for term ${term} (got ${votesReceived}/${majority}) — restarting timer`
    );
    // Revert to follower so we can vote for a future candidate if needed.
    node.becomeFollower(term);
    resetElectionTimer(node, onElectionTimeout);
  }
}

module.exports = { startElection, sendHeartbeats };
