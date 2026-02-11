'use strict';

const { setTimeout } = require('node:timers');
const { setTimeout: sleep } = require('node:timers/promises');
const { AsyncQueue } = require('@sapphire/async-queue');
const DiscordAPIError = require('./DiscordAPIError');
const HTTPError = require('./HTTPError');
const RateLimitError = require('./RateLimitError');
const {
  Events: { DEBUG, RATE_LIMIT, INVALID_REQUEST_WARNING, API_RESPONSE, API_REQUEST },
} = require('../util/Constants');
const { hasListener } = require('../util/ListenerUtil');

const captchaMessage = [
  'incorrect-captcha',
  'response-already-used',
  'captcha-required',
  'invalid-input-response',
  'invalid-response',
  'You need to update your app',
  'response-already-used-error',
  'rqkey-mismatch',
  'sitekey-secret-mismatch',
];

function parseResponse(res) {
  if (res.headers.get('content-type')?.startsWith('application/json')) return res.json();
  return res.arrayBuffer();
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

/* Invalid request limiting is done on a per-IP basis, not a per-token basis.
 * The best we can do is track invalid counts process-wide (on the theory that
 * users could have multiple bots run from one process) rather than per-bot.
 * Therefore, store these at file scope here rather than in the client's
 * RESTManager object.
 */
let invalidCount = 0;
let invalidCountResetTime = null;

class RequestHandler {
  constructor(manager) {
    this.manager = manager;
    this.queue = new AsyncQueue();
    this.reset = -1;
    this.remaining = -1;
    this.limit = -1;
  }

  async push(request) {
    await this.queue.wait();
    try {
      return await this.execute(request);
    } finally {
      this.queue.shift();
    }
  }

  get globalLimited() {
    return this.manager.globalRemaining <= 0 && Date.now() < this.manager.globalReset;
  }

  get localLimited() {
    return this.remaining <= 0 && Date.now() < this.reset;
  }

  get limited() {
    return this._getActiveRateLimit() !== null;
  }

  get _inactive() {
    return this.queue.remaining === 0 && !this.limited;
  }

  _getActiveRateLimit(now = Date.now(), request) {
    if (this.manager.coordinator?.getActiveRateLimit) {
      return this.manager.coordinator.getActiveRateLimit(this, now, request);
    }

    if (!request?.options?.webhook && this.manager.globalRemaining <= 0 && now < this.manager.globalReset) {
      const timeout = this.manager.globalReset + this.manager.client.options.restTimeOffset - now;
      return { isGlobal: true, limit: this.manager.globalLimit, timeout };
    }

    if (this.remaining <= 0 && now < this.reset) {
      const timeout = this.reset + this.manager.client.options.restTimeOffset - now;
      return { isGlobal: false, limit: this.limit, timeout };
    }

    return null;
  }

  _getDelayPromise(isGlobal, timeout) {
    const delay = Math.max(timeout, 0);
    if (isGlobal) {
      if (!this.manager.globalDelay) {
        this.manager.globalDelay = this.globalDelayFor(delay);
      }
      return this.manager.globalDelay;
    }
    return sleep(delay);
  }

  globalDelayFor(ms) {
    return new Promise(resolve => {
      setTimeout(() => {
        this.manager.globalDelay = null;
        resolve();
      }, ms).unref();
    });
  }

  /*
   * Determines whether the request should be queued or whether a RateLimitError should be thrown
   */
  async onRateLimit(request, limit, timeout, isGlobal) {
    const { options } = this.manager.client;
    if (!options.rejectOnRateLimit) return;

    const rateLimitData = {
      timeout,
      limit,
      method: request.method,
      path: request.path,
      route: request.route,
      global: isGlobal,
    };
    const shouldThrow =
      typeof options.rejectOnRateLimit === 'function'
        ? await options.rejectOnRateLimit(rateLimitData)
        : options.rejectOnRateLimit.some(route => rateLimitData.route.startsWith(route.toLowerCase()));
    if (shouldThrow) {
      throw new RateLimitError(rateLimitData);
    }
  }

  async execute(request, captchaKey, captchaToken) {
    const run = async (activeCaptchaKey, activeCaptchaToken) => {
      const hasDebugListener = hasListener(this.manager.client, DEBUG);
      const hasRateLimitListener = hasListener(this.manager.client, RATE_LIMIT);
      const hasApiRequestListener = hasListener(this.manager.client, API_REQUEST);
      const hasApiResponseListener = hasListener(this.manager.client, API_RESPONSE);
      const invalidRequestInterval = this.manager.client.options.invalidRequestWarningInterval;
      const hasInvalidRequestListener =
        hasListener(this.manager.client, INVALID_REQUEST_WARNING) && invalidRequestInterval > 0;

      /*
       * After calculations have been done, pre-emptively stop further requests
       * Potentially loop until this task can run if e.g. the global rate limit is hit twice
       */
      for (
        let rateLimitState = this._getActiveRateLimit(Date.now(), request);
        rateLimitState;
        rateLimitState = this._getActiveRateLimit(Date.now(), request)
      ) {
        const { isGlobal, limit, timeout } = rateLimitState;
        const safeTimeout = Math.max(timeout, 0);

        if (hasRateLimitListener) {
          /**
           * Emitted when the client hits a rate limit while making a request
           * @event BaseClient#rateLimit
           * @param {RateLimitData} rateLimitData Object containing the rate limit info
           */
          this.manager.client.emit(RATE_LIMIT, {
            timeout: safeTimeout,
            limit,
            method: request.method,
            path: request.path,
            route: request.route,
            global: isGlobal,
          });
        }

        const delayPromise = this._getDelayPromise(isGlobal, safeTimeout);

        // Determine whether a RateLimitError should be thrown
        await this.onRateLimit(request, limit, safeTimeout, isGlobal); // eslint-disable-line no-await-in-loop

        // Wait for the timeout to expire in order to avoid an actual 429
        await delayPromise; // eslint-disable-line no-await-in-loop
      }

      // As the request goes out, update the global usage information
      if (this.manager.coordinator?.markRequestStart) {
        this.manager.coordinator.markRequestStart(request, Date.now());
      } else {
        const now = Date.now();
        if (!request.options?.webhook && (!this.manager.globalReset || this.manager.globalReset < now)) {
          this.manager.globalReset = now + 1_000;
          this.manager.globalRemaining = this.manager.globalLimit;
        }
        if (!request.options?.webhook) this.manager.globalRemaining--;
      }

      /**
       * Represents a request that will or has been made to the Discord API
       * @typedef {Object} APIRequest
       * @property {HTTPMethod} method The HTTP method used in this request
       * @property {string} path The full path used to make the request
       * @property {string} route The API route identifying the rate limit for this request
       * @property {Object} options Additional options for this request
       * @property {number} retries The number of times this request has been attempted
       */

      if (hasApiRequestListener) {
        /**
         * Emitted before every API request.
         * This event can emit several times for the same request, e.g. when hitting a rate limit.
         * <info>This is an informational event that is emitted quite frequently,
         * it is highly recommended to check `request.path` to filter the data.</info>
         * @event BaseClient#apiRequest
         * @param {APIRequest} request The request that is about to be sent
         */
        this.manager.client.emit(API_REQUEST, {
          method: request.method,
          path: request.path,
          route: request.route,
          options: request.options,
          retries: request.retries,
        });
      }

      // Perform the request
      let res;
      try {
        res = await request.make(activeCaptchaKey, activeCaptchaToken);
      } catch (error) {
        // Retry the specified number of times for request abortions
        if (request.retries === this.manager.client.options.retryLimit) {
          throw new HTTPError(error.message, error.constructor.name, error.status, request);
        }

        request.retries++;
        return run();
      }

      if (hasApiResponseListener) {
        /**
         * Emitted after every API request has received a response.
         * This event does not necessarily correlate to completion of the request, e.g. when hitting a rate limit.
         * <info>This is an informational event that is emitted quite frequently,
         * it is highly recommended to check `request.path` to filter the data.</info>
         * @event BaseClient#apiResponse
         * @param {APIRequest} request The request that triggered this response
         * @param {Response} response The response received from the Discord API
         */
        this.manager.client.emit(
          API_RESPONSE,
          {
            method: request.method,
            path: request.path,
            route: request.route,
            options: request.options,
            retries: request.retries,
          },
          res.clone(),
        );
      }

      let sublimitTimeout;
      if (res.headers) {
        const applied = this.manager.coordinator?.applyHeaders?.(this, request, res.headers);
        if (applied) {
          sublimitTimeout = applied.sublimitTimeout;
        } else {
          const serverDate = res.headers.get('date');
          const bucketHash = res.headers.get('x-ratelimit-bucket');
          const limit = res.headers.get('x-ratelimit-limit');
          const remaining = res.headers.get('x-ratelimit-remaining');
          const reset = res.headers.get('x-ratelimit-reset');
          const resetAfter = res.headers.get('x-ratelimit-reset-after');

          if (bucketHash) this.manager.bindBucket?.(request.method, request.route, bucketHash, this);

          this.limit = limit ? Number(limit) : Infinity;
          this.remaining = remaining ? Number(remaining) : 1;
          this.reset = reset || resetAfter ? calculateReset(reset, resetAfter, serverDate) : Date.now();

          if (!resetAfter && serverDate && request.route.includes('reactions')) {
            this.reset = new Date(serverDate).getTime() - getAPIOffset(serverDate) + 250;
          }

          let retryAfter = res.headers.get('retry-after');
          retryAfter = retryAfter ? Number(retryAfter) * 1_000 : -1;
          if (retryAfter > 0) {
            const isGlobalScope = this.manager.coordinator?.isGlobalScope
              ? this.manager.coordinator.isGlobalScope(res.headers)
              : res.headers.get('x-ratelimit-global') || res.headers.get('x-ratelimit-scope') === 'global';
            if (isGlobalScope) {
              this.manager.globalRemaining = 0;
              this.manager.globalReset = Date.now() + retryAfter;
            } else if (!this.localLimited) {
              sublimitTimeout = retryAfter;
            }
          }
        }
      }

      // Count the invalid requests
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        const isShared429 =
          res.status === 429 &&
          (this.manager.coordinator?.isSharedScope
            ? this.manager.coordinator.isSharedScope(res.headers)
            : res.headers?.get('x-ratelimit-scope') === 'shared');
        if (!isShared429) {
          const invalidNow = Date.now();
          if (!invalidCountResetTime || invalidCountResetTime < invalidNow) {
            invalidCountResetTime = invalidNow + 1_000 * 60 * 10;
            invalidCount = 0;
          }
          invalidCount++;

          let breakerDelay = 0;
          if (invalidCount >= 9_000) breakerDelay = 5_000;
          else if (invalidCount >= 5_000) breakerDelay = 1_500;
          else if (invalidCount >= 2_500) breakerDelay = 500;

          if (breakerDelay > 0) {
            await sleep(breakerDelay);
          }

          const emitInvalid = hasInvalidRequestListener && invalidCount % invalidRequestInterval === 0;
          if (emitInvalid) {
            /**
             * @typedef {Object} InvalidRequestWarningData
             * @property {number} count Number of invalid requests that have been made in the window
             * @property {number} remainingTime Time in milliseconds remaining before the count resets
             */

            /**
             * Emitted periodically when the process sends invalid requests to let users avoid the
             * 10k invalid requests in 10 minutes threshold that causes a ban
             * @event BaseClient#invalidRequestWarning
             * @param {InvalidRequestWarningData} invalidRequestWarningData Object containing the invalid request info
             */
            this.manager.client.emit(INVALID_REQUEST_WARNING, {
              count: invalidCount,
              remainingTime: invalidCountResetTime - invalidNow,
            });
          }
        }
      }

      // Handle 2xx and 3xx responses
      if (res.ok) {
        // Nothing wrong with the request, proceed with the next one
        return parseResponse(res);
      }

      // Handle 4xx responses
      if (res.status >= 400 && res.status < 500) {
        // Handle ratelimited requests
        if (res.status === 429) {
          const rateLimitNow = Date.now();
          const rateLimitState = this._getActiveRateLimit(rateLimitNow, request);
          let isGlobal = rateLimitState?.isGlobal ?? (!request.options?.webhook && this.globalLimited);
          const limit = rateLimitState?.limit ?? (isGlobal ? this.manager.globalLimit : this.limit);
          const computedTimeout =
            rateLimitState?.timeout ??
            (isGlobal
              ? this.manager.globalReset + this.manager.client.options.restTimeOffset - rateLimitNow
              : this.reset + this.manager.client.options.restTimeOffset - rateLimitNow);
          let safeTimeout = Math.max(computedTimeout, 0);
          let bodyRetryAfter = null;
          const headerGlobal =
            this.manager.coordinator?.isGlobalScope?.(res.headers) ??
            Boolean(res.headers.get('x-ratelimit-global') || res.headers.get('x-ratelimit-scope') === 'global');
          if (headerGlobal) isGlobal = true;
          if (!sublimitTimeout) {
            const resolved = this.manager.coordinator?.resolve429Timeout
              ? await this.manager.coordinator.resolve429Timeout(res, safeTimeout)
              : { safeTimeout, bodyRetryAfter, bodyGlobal: false, scope: null };
            safeTimeout = resolved.safeTimeout;
            bodyRetryAfter = resolved.bodyRetryAfter;
            if (resolved.bodyGlobal && safeTimeout > 0) {
              isGlobal = true;
              this.manager.globalRemaining = 0;
              this.manager.globalReset = Date.now() + safeTimeout;
            }
          }

          if (isGlobal && safeTimeout > 0) {
            this.manager.globalRemaining = 0;
            this.manager.globalReset = Date.now() + safeTimeout;
          }

          if (hasDebugListener) {
            this.manager.client.emit(
              DEBUG,
              `[Request Handler] Hit a 429 while executing a request.
    Global  : ${isGlobal}
    Method  : ${request.method}
    Path    : ${request.path}
    Route   : ${request.route}
    Limit   : ${limit}
    Timeout : ${safeTimeout}ms
    Sublimit: ${sublimitTimeout ? `${sublimitTimeout}ms` : 'None'}
    Fallback: ${bodyRetryAfter ? `${bodyRetryAfter}ms` : 'None'}`,
            );
          }

          await this.onRateLimit(request, limit, safeTimeout, isGlobal);

          // If caused by a sublimit, wait it out here so other requests on the route can be handled
          if (sublimitTimeout) {
            await sleep(sublimitTimeout);
          } else if (bodyRetryAfter && bodyRetryAfter > 0) {
            await sleep(bodyRetryAfter);
          } else if (this.manager.coordinator?.sleepBackoff) {
            await this.manager.coordinator.sleepBackoff(429, Math.max(request.retries, 1));
          } else {
            const fallback = Math.min(1_500, 125 * 2 ** Math.min(Math.max(request.retries, 1), 5));
            await sleep(fallback);
          }
          request.retries++;
          return run();
        }

        // Handle possible malformed requests
        let data;
        try {
          data = await parseResponse(res);
          // Captcha
          if (
            data?.captcha_service &&
            typeof this.manager.client.options.captchaSolver == 'function' &&
            request.retries < this.manager.client.options.captchaRetryLimit &&
            captchaMessage.some(s => data.captcha_key[0].includes(s))
          ) {
            // Retry the request after a captcha is solved
            if (hasDebugListener) {
              this.manager.client.emit(
                DEBUG,
                `[Request Handler] Hit a captcha while executing a request (${data.captcha_key.join(', ')})
    Method  : ${request.method}
    Path    : ${request.path}
    Route   : ${request.route}
    Sitekey : ${data.captcha_sitekey}
    rqToken : ${data.captcha_rqtoken}`,
              );
            }
            const captcha = await this.manager.client.options.captchaSolver(data, request.fullUserAgent);
            if (hasDebugListener) {
              this.manager.client.emit(
                DEBUG,
                `[Request Handler] Captcha details:
    Method  : ${request.method}
    Path    : ${request.path}
    Route   : ${request.route}
    Key     : ${captcha ? `${captcha.slice(0, 120)}...` : '[Captcha not solved]'}
    rqToken : ${data.captcha_rqtoken}`,
              );
            }
            request.retries++;
            return run(captcha, data.captcha_rqtoken);
          }
          // Two factor handling
          if (data?.code && data.code == 60003 && request.options.auth !== false && request.retries < 1) {
            // https://gist.github.com/Dziurwa14/de2498e5ee28d2089f095aa037957cbb
            // 60003: Two factor is required for this operation
            /**
             * {
             *     message: "Two factor is required for this operation";
             *     code: 60003;
             *     mfa: {
             *         ticket: string;
             *         methods: {
             *             type: "password" | "totp" | "sms" | "backup" | "webauthn";
             *             backup_codes_allowed?: boolean;
             *         }[];
             *     };
             * };
             */
            if (
              data.mfa.methods.find(o => o.type === 'totp') &&
              typeof this.manager.client.options.TOTPKey === 'string'
            ) {
              // Get mfa code
              const otp = this.manager.client.authenticator.generate(this.manager.client.options.TOTPKey);
              if (hasDebugListener) {
                this.manager.client.emit(
                  DEBUG,
                  `[Request Handler] ${data.message}
    Method  : ${request.method}
    Path    : ${request.path}
    Route   : ${request.route}
    mfaCode : ${otp}`,
                );
              }
              // Get ticket
              const mfaData = data.mfa;
              const mfaPost = await this.manager.client.api.mfa.finish.post({
                data: {
                  ticket: mfaData.ticket,
                  data: otp,
                  mfa_type: 'totp',
                },
              });
              request.options.mfaToken = mfaPost.token;
              request.retries++;
              return run();
            }
          }
        } catch (err) {
          throw new HTTPError(err.message, err.constructor.name, err.status, request);
        }

        throw new DiscordAPIError(data, res.status, request);
      }

      // Handle 5xx responses
      if (res.status >= 500 && res.status < 600) {
        // Retry the specified number of times for possible serverside issues
        if (request.retries === this.manager.client.options.retryLimit) {
          throw new HTTPError(res.statusText, res.constructor.name, res.status, request);
        }

        await this.manager.coordinator?.sleepBackoff?.(res.status, request.retries);
        request.retries++;
        return run();
      }

      // Fallback in the rare case a status code outside the range 200..=599 is returned
      return null;
    };

    return run(captchaKey, captchaToken);
  }
}

module.exports = RequestHandler;

/**
 * @external HTTPMethod
 * @see {@link https://developer.mozilla.org/docs/Web/HTTP/Methods}
 */

/**
 * @external Response
 * @see {@link https://developer.mozilla.org/docs/Web/API/Response}
 */
