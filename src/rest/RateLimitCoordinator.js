'use strict';

const { setTimeout: sleep } = require('node:timers/promises');

function parseJSONResponse(res) {
  if (res.headers.get('content-type')?.startsWith('application/json')) return res.json();
  return Promise.resolve(null);
}

function getAPIOffset(serverDate) {
  if (!serverDate) return 0;
  const parsed = new Date(serverDate).getTime();
  if (!Number.isFinite(parsed)) return 0;
  return parsed - Date.now();
}

function calculateReset(reset, resetAfter, serverDate) {
  if (resetAfter) return Date.now() + Number(resetAfter) * 1_000;
  const parsedReset = new Date(Number(reset) * 1_000).getTime();
  if (!Number.isFinite(parsedReset)) return Date.now();
  return parsedReset - getAPIOffset(serverDate);
}

class RateLimitCoordinator {
  constructor(manager) {
    this.manager = manager;
    this.buckets = new Map();
  }

  getRateLimitScope(headers, bodyGlobal = false) {
    const scopeHeader = String(headers?.get('x-ratelimit-scope') || '').toLowerCase();
    if (scopeHeader === 'global' || scopeHeader === 'shared' || scopeHeader === 'user') {
      return scopeHeader;
    }
    if (bodyGlobal) return 'global';
    return null;
  }

  isSharedScope(headers) {
    return this.getRateLimitScope(headers) === 'shared';
  }

  isGlobalScope(headers, bodyGlobal = false) {
    if (headers?.get('x-ratelimit-global')) return true;
    return this.getRateLimitScope(headers, bodyGlobal) === 'global';
  }

  getActiveRateLimit(handler, now = Date.now(), request) {
    if (!request?.options?.webhook && this.manager.globalRemaining <= 0 && now < this.manager.globalReset) {
      const timeout = this.manager.globalReset + this.manager.client.options.restTimeOffset - now;
      return { isGlobal: true, limit: this.manager.globalLimit, timeout };
    }

    if (handler.remaining <= 0 && now < handler.reset) {
      const timeout = handler.reset + this.manager.client.options.restTimeOffset - now;
      return { isGlobal: false, limit: handler.limit, timeout };
    }

    return null;
  }

  markRequestStart(request, now = Date.now()) {
    if (request?.options?.webhook) return;
    if (!this.manager.globalReset || this.manager.globalReset < now) {
      this.manager.globalReset = now + 1_000;
      this.manager.globalRemaining = this.manager.globalLimit;
    }
    this.manager.globalRemaining--;
  }

  applyHeaders(handler, request, headers) {
    if (!headers) return { sublimitTimeout: null };

    const serverDate = headers.get('date');
    const bucketHash = headers.get('x-ratelimit-bucket');
    const limit = headers.get('x-ratelimit-limit');
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');
    const resetAfter = headers.get('x-ratelimit-reset-after');

    if (bucketHash) {
      this.manager.bindBucket?.(request.method, request.route, bucketHash, handler);
    }

    handler.limit = limit ? Number(limit) : Infinity;
    handler.remaining = remaining ? Number(remaining) : 1;
    handler.reset = reset || resetAfter ? calculateReset(reset, resetAfter, serverDate) : Date.now();

    if (!resetAfter && serverDate && request.route.includes('reactions')) {
      handler.reset = new Date(serverDate).getTime() - getAPIOffset(serverDate) + 250;
    }

    let retryAfter = headers.get('retry-after');
    retryAfter = retryAfter ? Number(retryAfter) * 1_000 : -1;

    let sublimitTimeout = null;
    if (retryAfter > 0) {
      if (this.isGlobalScope(headers)) {
        this.manager.globalRemaining = 0;
        this.manager.globalReset = Date.now() + retryAfter;
      } else if (!(handler.remaining <= 0 && Date.now() < handler.reset)) {
        sublimitTimeout = retryAfter;
      }
    }

    if (bucketHash) {
      this.buckets.set(bucketHash, {
        limit: handler.limit,
        remaining: handler.remaining,
        reset: handler.reset,
      });
    }

    return { sublimitTimeout };
  }

  async resolve429Timeout(res, computedTimeout) {
    let safeTimeout = Math.max(computedTimeout, 0);
    let bodyRetryAfter = null;
    let bodyGlobal = false;

    if (safeTimeout <= 0 || !res.headers.get('x-ratelimit-global')) {
      try {
        const body = await parseJSONResponse(res.clone());
        const retryAfter = Number(body?.retry_after);
        bodyGlobal = Boolean(body?.global);
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          bodyRetryAfter = retryAfter * 1_000;
          safeTimeout = bodyRetryAfter;
        }
      } catch {
        // Ignore invalid fallback payload.
      }
    }

    const scope = this.getRateLimitScope(res.headers, bodyGlobal);
    if (scope === 'global') bodyGlobal = true;
    return { safeTimeout, bodyRetryAfter, bodyGlobal, scope };
  }

  getRetryBackoff(status, retries) {
    if (!retries) return 0;
    const base = status === 429 ? 125 : 200;
    const cap = status === 429 ? 1_500 : 3_000;
    const exp = Math.min(cap, base * 2 ** Math.min(retries, 5));
    const jitter = Math.floor(Math.random() * (exp * 0.2));
    return exp + jitter;
  }

  async sleepBackoff(status, retries) {
    const delay = this.getRetryBackoff(status, retries);
    if (delay > 0) await sleep(delay);
  }
}

module.exports = RateLimitCoordinator;
