/**
 * raftNode.js
 *
 * Core RAFT node state and state-transition logic.
 *
 * In RAFT every node is always in exactly one of three states:
 *   FOLLOWER  — passive; resets election timer on heartbeats
 *   CANDIDATE — actively seeking votes to become leader
 *   LEADER    — sends periodic heartbeats; drives log replication
 */

'use strict';

const STATES = {
  FOLLOWER: 'FOLLOWER',
  CANDIDATE: 'CANDIDATE',
  LEADER: 'LEADER',
};

class RaftNode {
  /**
   * @param {string}   nodeId    — unique identifier, e.g. "replica1"
   * @param {string[]} peerNodes — HTTP URLs of every other node in the cluster
   */
  constructor(nodeId, peerNodes) {
    this.nodeId    = nodeId;
    this.peerNodes = peerNodes; // e.g. ["http://replica2:5002", "http://replica3:5003"]

    // --- Persistent RAFT state (simplified: in-memory, not durable) ---
    this.currentTerm = 0;   // latest term this node has seen
    this.votedFor    = null; // candidateId we voted for in currentTerm (null = not voted)

    // --- Volatile state ---
    this.state = STATES.FOLLOWER;

    // Timer handles managed externally by timers.js
    this.electionTimer  = null;
    this.heartbeatTimer = null;

    console.log(`Node ${this.nodeId} started as ${this.state}`);
  }

  /**
   * Transition to FOLLOWER.
   * Called when:
   *   - a higher term is discovered in any RPC response
   *   - a valid heartbeat arrives from the current leader
   *
   * @param {number} term — the term that caused the step-down (or current term)
   */
  becomeFollower(term) {
    const prev = this.state;
    this.currentTerm = term;
    this.votedFor    = null; // reset vote so we may vote in this term
    this.state       = STATES.FOLLOWER;
    console.log(`Node ${this.nodeId} became FOLLOWER for term ${term} (was ${prev})`);
  }

  /**
   * Transition to CANDIDATE.
   * Called when the election timer fires with no heartbeat received.
   * Increments term and self-votes.
   */
  becomeCandidate() {
    this.currentTerm += 1;
    this.votedFor     = this.nodeId; // self-vote counts as our first vote
    this.state        = STATES.CANDIDATE;
    console.log(`Node ${this.nodeId} became CANDIDATE for term ${this.currentTerm}`);
  }

  /**
   * Transition to LEADER.
   * Called after receiving a majority of votes in the current election.
   */
  becomeLeader() {
    this.state = STATES.LEADER;
    console.log(`Node ${this.nodeId} became LEADER for term ${this.currentTerm}`);
  }

  // --- Convenience state checkers ---
  isLeader()    { return this.state === STATES.LEADER;    }
  isCandidate() { return this.state === STATES.CANDIDATE; }
  isFollower()  { return this.state === STATES.FOLLOWER;  }
}

module.exports = { RaftNode, STATES };
