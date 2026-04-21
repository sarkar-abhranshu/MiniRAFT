'use strict';

class RaftLog {
  /**
   * Initializes an empty in-memory log and commit index for this replica.
   */
  constructor() {
    this.entries = [];
    this.commitIndex = 0;
  }

  /**
   * Appends or overwrites an entry at a target index while preserving index order.
   */
  append(entry) {
    const lastIndex = this.getLastIndex();
    const requestedIndex = Number.isInteger(entry.index) ? entry.index : lastIndex + 1;
    const index = requestedIndex > 0 ? requestedIndex : lastIndex + 1;

    // If an entry arrives for an existing index, truncate from that point.
    this.entries = this.entries.filter((item) => item.index < index);

    const normalizedEntry = {
      term: Number(entry.term) || 0,
      index,
      command: entry.command || {},
    };

    this.entries.push(normalizedEntry);
    return normalizedEntry;
  }

  /**
   * Returns the largest log index currently stored, or 0 for an empty log.
   */
  getLastIndex() {
    if (this.entries.length === 0) {
      return 0;
    }
    return this.entries[this.entries.length - 1].index;
  }

  /**
   * Returns the term of the most recent log entry, or 0 if the log is empty.
   */
  getLastTerm() {
    if (this.entries.length === 0) {
      return 0;
    }
    return this.entries[this.entries.length - 1].term;
  }

  /**
   * Advances commitIndex to a bounded value without moving it backwards.
   */
  commit(index) {
    const boundedIndex = Math.max(0, Math.min(index, this.getLastIndex()));
    this.commitIndex = Math.max(this.commitIndex, boundedIndex);
    return this.commitIndex;
  }

  /**
   * Returns all entries whose index is greater than or equal to the given index.
   */
  getEntriesFrom(index) {
    return this.entries.filter((entry) => entry.index >= index);
  }

  /**
   * Returns a shallow copy of the full log for read-only consumers.
   */
  getAllEntries() {
    return [...this.entries];
  }

  /**
   * Replaces the full log state from a leader-provided entry list.
   */
  replaceAll(entries) {
    this.entries = entries
      .map((entry, position) => ({
        term: Number(entry.term) || 0,
        index: Number.isInteger(entry.index) ? entry.index : position + 1,
        command: entry.command || {},
      }))
      .sort((a, b) => a.index - b.index);

    this.commitIndex = Math.min(this.commitIndex, this.getLastIndex());
    return this.getAllEntries();
  }
}

module.exports = { RaftLog };
