'use strict';

/**
 * A small O(1) FIFO queue with O(1) "priority" insert at the front.
 *
 * Ordering matches Array semantics:
 * - `push()` appends to the end
 * - `unshift()` prepends to the front
 * - `shift()` removes from the front
 * - Multiple `unshift()` calls are LIFO relative to each other (same as Array)
 */
class FastQueue {
  static MIN_BACK_CAPACITY = 16;

  constructor(iterable) {
    this._front = [];
    this._back = new Array(FastQueue.MIN_BACK_CAPACITY);
    this._backHead = 0;
    this._backTail = 0;
    this._backLength = 0;

    if (iterable) {
      for (const value of iterable) this.push(value);
    }
  }

  get length() {
    return this._front.length + this._backLength;
  }

  _resizeBack(newCapacity) {
    const next = new Array(newCapacity);
    const mask = this._back.length - 1;
    for (let i = 0; i < this._backLength; i++) {
      next[i] = this._back[(this._backHead + i) & mask];
    }
    this._back = next;
    this._backHead = 0;
    this._backTail = this._backLength;
  }

  push(value) {
    if (this._backLength === this._back.length) {
      this._resizeBack(this._back.length << 1);
    }

    this._back[this._backTail] = value;
    this._backTail = (this._backTail + 1) & (this._back.length - 1);
    this._backLength++;
    return this.length;
  }

  unshift(value) {
    this._front.push(value);
    return this.length;
  }

  shift() {
    if (this._front.length) return this._front.pop();
    if (this._backLength === 0) return undefined;

    const value = this._back[this._backHead];
    this._back[this._backHead] = undefined;
    this._backHead = (this._backHead + 1) & (this._back.length - 1);
    this._backLength--;

    if (this._backLength === 0) {
      this._backHead = 0;
      this._backTail = 0;
      return value;
    }

    if (
      this._back.length > FastQueue.MIN_BACK_CAPACITY &&
      this._backLength <= this._back.length >> 2 &&
      this._backLength >= FastQueue.MIN_BACK_CAPACITY
    ) {
      this._resizeBack(this._back.length >> 1);
    }

    return value;
  }

  clear() {
    this._front.length = 0;
    this._back = new Array(FastQueue.MIN_BACK_CAPACITY);
    this._backHead = 0;
    this._backTail = 0;
    this._backLength = 0;
  }
}

module.exports = FastQueue;
