'use strict';

const { setTimeout } = require('node:timers');
const FastQueue = require('../../util/FastQueue');

class GatewaySendScheduler {
  constructor(shard, options = {}) {
    this.shard = shard;
    this.capacity = Number(options.capacity) > 0 ? Number(options.capacity) : 110;
    this.windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : 60_000;
    this.importantBurst = Number(options.importantBurst) > 0 ? Number(options.importantBurst) : 8;
    this._tokens = this.capacity;
    this._lastRefill = Date.now();
    this._timer = null;
    this._importantStreak = 0;

    this.importantQueue = new FastQueue();
    this.normalQueue = new FastQueue();
  }

  get length() {
    return this.importantQueue.length + this.normalQueue.length;
  }

  get remaining() {
    return this._tokens;
  }

  get timer() {
    return this._timer;
  }

  enqueue(data, important = false) {
    if (important) {
      this.importantQueue.unshift(data);
    } else {
      this.normalQueue.push(data);
    }
    this.process();
  }

  clear() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.importantQueue.clear();
    this.normalQueue.clear();
    this._tokens = this.capacity;
    this._lastRefill = Date.now();
    this._importantStreak = 0;
  }

  process() {
    this._refill(Date.now());

    while (this._tokens >= 1 && this.length > 0) {
      const next = this._dequeue();
      if (typeof next === 'undefined') break;
      this.shard._send(next);
      this._tokens -= 1;
    }

    if (this.length > 0) {
      this._schedule();
    } else if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _dequeue() {
    const hasImportant = this.importantQueue.length > 0;
    const hasNormal = this.normalQueue.length > 0;
    if (!hasImportant && !hasNormal) return undefined;

    if (hasImportant && (!hasNormal || this._importantStreak < this.importantBurst)) {
      this._importantStreak++;
      return this.importantQueue.shift();
    }

    this._importantStreak = 0;
    return this.normalQueue.shift();
  }

  _schedule() {
    if (this._timer) return;
    const ratePerMs = this.capacity / this.windowMs;
    const missing = Math.max(1 - this._tokens, 0);
    const delay = Math.max(Math.ceil(missing / ratePerMs), 1);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.process();
    }, delay).unref();
  }

  _refill(now) {
    if (now <= this._lastRefill) return;
    const elapsed = now - this._lastRefill;
    this._lastRefill = now;
    const refill = elapsed * (this.capacity / this.windowMs);
    if (refill <= 0) return;
    this._tokens = Math.min(this.capacity, this._tokens + refill);
  }
}

module.exports = GatewaySendScheduler;
