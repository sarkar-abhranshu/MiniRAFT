'use strict';

class RaftLog {
  constructor() {
    this.entries = [];
    this.commitIndex = 0;
  }

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

  getLastIndex() {
    if (this.entries.length === 0) {
      return 0;
    }
    return this.entries[this.entries.length - 1].index;
  }

  getLastTerm() {
    if (this.entries.length === 0) {
      return 0;
    }
    return this.entries[this.entries.length - 1].term;
  }

  commit(index) {
    const boundedIndex = Math.max(0, Math.min(index, this.getLastIndex()));
    this.commitIndex = Math.max(this.commitIndex, boundedIndex);
    return this.commitIndex;
  }

  getEntriesFrom(index) {
    return this.entries.filter((entry) => entry.index >= index);
  }

  getAllEntries() {
    return [...this.entries];
  }

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
