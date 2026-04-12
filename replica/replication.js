'use strict';

const axios = require('axios');

const REPLICATION_TIMEOUT = parseInt(process.env.REPLICATION_TIMEOUT, 10) || 1000;
const VERBOSE_REPLICATION_LOGS = process.env.VERBOSE_REPLICATION_LOGS === 'true';

function logVerbose(message) {
  if (VERBOSE_REPLICATION_LOGS) {
    console.log(message);
  }
}

class ReplicationService {
  constructor(node, raftLog) {
    this.node = node;
    this.raftLog = raftLog;
  }

  async replicateCommand(command) {
    if (!this.node.isLeader()) {
      return {
        success: false,
        error: 'NOT_LEADER',
      };
    }

    const entry = this.raftLog.append({
      term: this.node.currentTerm,
      command,
    });

    logVerbose(
      `[Replication] Leader ${this.node.nodeId} appended entry index=${entry.index}, term=${entry.term}`
    );

    const appendPayload = this._buildAppendPayload(entry);

    logVerbose(
      `[Replication] Replicating entry index=${entry.index} to ${this.node.peerNodes.length} followers`
    );

    const responses = await Promise.all(
      this.node.peerNodes.map((peerUrl) => this._sendAppend(peerUrl, appendPayload))
    );

    const followerAckCount = responses.filter((response) => response.success).length;
    const totalNodes = this.node.peerNodes.length + 1;
    const successCount = followerAckCount + 1; // include leader

    logVerbose(`[Replication] ACK count ${successCount}/${totalNodes}`);

    if (successCount > totalNodes / 2) {
      const commitIndex = this.raftLog.commit(entry.index);
      logVerbose(`[Replication] Commit successful at index ${commitIndex}`);

      // Push updated leaderCommit so followers advance their commit index too.
      const commitPayload = this._buildAppendPayload(null);
      await Promise.all(
        this.node.peerNodes.map((peerUrl) => this._sendAppend(peerUrl, commitPayload))
      );

      return {
        success: true,
        entry,
        commitIndex,
        successCount,
        totalNodes,
      };
    }

    console.log(
      `[Replication] Commit failed for index ${entry.index} (need majority, got ${successCount}/${totalNodes})`
    );

    return {
      success: false,
      entry,
      commitIndex: this.raftLog.commitIndex,
      successCount,
      totalNodes,
      error: 'MAJORITY_NOT_REACHED',
    };
  }

  async syncFollowers() {
    if (!this.node.isLeader()) {
      return {
        success: false,
        error: 'NOT_LEADER',
      };
    }

    const payload = this._buildAppendPayload(null);

    const responses = await Promise.all(
      this.node.peerNodes.map((peerUrl) => this._sendAppend(peerUrl, payload))
    );

    const syncedFollowers = responses.filter((response) => response.success).length;

    return {
      success: true,
      syncedFollowers,
      totalFollowers: this.node.peerNodes.length,
      responses,
    };
  }

  applyAppendFromLeader(body) {
    const { term, entry, entries, leaderCommit } = body;

    if (!Number.isInteger(term)) {
      return {
        success: false,
        term: this.node.currentTerm,
        error: 'INVALID_TERM',
      };
    }

    if (term < this.node.currentTerm) {
      return {
        success: false,
        term: this.node.currentTerm,
      };
    }

    if (term > this.node.currentTerm || !this.node.isFollower()) {
      this.node.becomeFollower(term);
    } else {
      this.node.currentTerm = term;
    }

    // Basic restart sync: if leader sends the full log, replace follower log.
    if (Array.isArray(entries)) {
      this.raftLog.replaceAll(entries);
    } else if (entry) {
      this.raftLog.append(entry);
    }

    if (Number.isInteger(leaderCommit)) {
      this.raftLog.commit(leaderCommit);
    }

    return {
      success: true,
      term: this.node.currentTerm,
      lastIndex: this.raftLog.getLastIndex(),
      commitIndex: this.raftLog.commitIndex,
    };
  }

  _buildAppendPayload(entry) {
    return {
      term: this.node.currentTerm,
      leaderId: this.node.nodeId,
      entry,
      // Basic sync strategy: include full log so restarted followers can catch up.
      entries: this.raftLog.getEntriesFrom(1),
      leaderCommit: this.raftLog.commitIndex,
    };
  }

  async _sendAppend(peerUrl, payload) {
    try {
      const { data } = await axios.post(`${peerUrl}/append`, payload, {
        timeout: REPLICATION_TIMEOUT,
      });

      const success = Boolean(data && data.success);
      if (success) {
        logVerbose(`[Replication] ACK from ${peerUrl}`);
      } else {
        console.log(`[Replication] NACK from ${peerUrl}`);
      }

      return {
        peerUrl,
        success,
      };
    } catch (error) {
      console.log(`[Replication] Append to ${peerUrl} failed: ${error.message}`);
      return {
        peerUrl,
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = { ReplicationService };
