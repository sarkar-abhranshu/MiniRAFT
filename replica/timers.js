/**
 * timers.js
 *
 * Manages the two RAFT timers:
 *
 *   Election timer  — started by every FOLLOWER and CANDIDATE.
 *                     Fires after a random 500–800 ms window.
 *                     If it fires without a heartbeat having arrived, the node
 *                     starts a new election.
 *
 *   Heartbeat timer — started only by the LEADER.
 *                     Fires every 150 ms to emit heartbeats that suppress
 *                     followers' election timers.
 *
 * The heartbeat interval (150 ms) must be significantly smaller than the
 * election timeout (500–800 ms) so that a live leader can prevent elections.
 */

'use strict';

const ELECTION_TIMEOUT_MIN = 500; // ms
const ELECTION_TIMEOUT_MAX = 800; // ms
const HEARTBEAT_INTERVAL   = 150; // ms

/** Returns a random election timeout in [MIN, MAX] ms. */
function randomElectionTimeout() {
  return Math.floor(
    Math.random() * (ELECTION_TIMEOUT_MAX - ELECTION_TIMEOUT_MIN) +
      ELECTION_TIMEOUT_MIN
  );
}

/**
 * Resets the election timer on `node`.
 * Any previously running timer is cancelled first so that each heartbeat
 * receipt effectively "resets the clock."
 *
 * @param {import('./raftNode').RaftNode} node
 * @param {Function} onTimeout — called when the timer fires
 */
function resetElectionTimer(node, onTimeout) {
  clearElectionTimer(node);

  const delay = randomElectionTimeout();
  node.electionTimer = setTimeout(() => {
    console.log(
      `Election timeout triggered on ${node.nodeId} (no heartbeat for ${delay}ms)`
    );
    onTimeout();
  }, delay);
}

/**
 * Cancels the election timer without starting a new one.
 * Called when a node transitions to LEADER (leaders do not wait for elections).
 *
 * @param {import('./raftNode').RaftNode} node
 */
function clearElectionTimer(node) {
  if (node.electionTimer) {
    clearTimeout(node.electionTimer);
    node.electionTimer = null;
  }
}

/**
 * Starts the heartbeat interval on the LEADER node.
 * Cancels any previous interval before starting a new one.
 *
 * @param {import('./raftNode').RaftNode} node
 * @param {Function} onHeartbeat — called every HEARTBEAT_INTERVAL ms
 */
function startHeartbeatTimer(node, onHeartbeat) {
  clearHeartbeatTimer(node);
  node.heartbeatTimer = setInterval(onHeartbeat, HEARTBEAT_INTERVAL);
}

/**
 * Stops the leader heartbeat interval.
 * Called when the leader discovers a higher term and steps down.
 *
 * @param {import('./raftNode').RaftNode} node
 */
function clearHeartbeatTimer(node) {
  if (node.heartbeatTimer) {
    clearInterval(node.heartbeatTimer);
    node.heartbeatTimer = null;
  }
}

module.exports = {
  resetElectionTimer,
  clearElectionTimer,
  startHeartbeatTimer,
  clearHeartbeatTimer,
  HEARTBEAT_INTERVAL,
};
