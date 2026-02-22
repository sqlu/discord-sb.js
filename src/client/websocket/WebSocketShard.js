'use strict';

const { Buffer } = require('node:buffer');
const EventEmitter = require('node:events');
const { setTimeout, setInterval, clearTimeout } = require('node:timers');
const GatewaySendScheduler = require('./GatewaySendScheduler');
const WebSocket = require('../../WebSocket');
const { Status, Events, ShardEvents, Opcodes, WSEvents, WSCodes } = require('../../util/Constants');
const Intents = require('../../util/Intents');
const { hasListener } = require('../../util/ListenerUtil');
const Util = require('../../util/Util');

const STATUS_KEYS = Object.keys(Status);
const CONNECTION_STATE = Object.keys(WebSocket.WebSocket);

let zlib;

try {
  zlib = require('zlib-sync');
} catch {} // eslint-disable-line no-empty

/**
 * Represents a Shard's WebSocket connection
 * @extends {EventEmitter}
 */
class WebSocketShard extends EventEmitter {
  constructor(manager, id) {
    super();

    this.getConnectionState = () => (this.connection ? CONNECTION_STATE[this.connection.readyState] : 'No Connection');

    /**
     * The WebSocketManager of the shard
     * @type {WebSocketManager}
     */
    this.manager = manager;

    /**
     * The shard's id
     * @type {number}
     */
    this.id = id;

    /**
     * The resume URL for this shard
     * @type {?string}
     * @private
     */
    this.resumeURL = null;

    /**
     * The current status of the shard
     * @type {Status}
     */
    this.status = Status.IDLE;
    this._hasGuildsIntent = new Intents(this.manager.client.options.intents).has(Intents.FLAGS.GUILDS);
    this._wsPropsNormalized = false;

    /**
     * The current sequence of the shard
     * @type {number}
     * @private
     */
    this.sequence = -1;

    /**
     * The sequence of the shard after close
     * @type {number}
     * @private
     */
    this.closeSequence = 0;

    /**
     * The current session id of the shard
     * @type {?string}
     * @private
     */
    this.sessionId = null;

    /**
     * The previous heartbeat ping of the shard
     * @type {number}
     */
    this.ping = -1;

    /**
     * The last time a ping was sent (a timestamp)
     * @type {number}
     * @private
     */
    this.lastPingTimestamp = -1;

    /**
     * If we received a heartbeat ack back. Used to identify zombie connections
     * @type {boolean}
     * @private
     */
    this.lastHeartbeatAcked = true;

    /**
     * Used to prevent calling {@link WebSocketShard#event:close} twice while closing or terminating the WebSocket.
     * @type {boolean}
     * @private
     */
    this.closeEmitted = false;

    /**
     * Contains the rate limit queue and metadata
     * @name WebSocketShard#ratelimit
     * @type {Object}
     * @private
     */
    const gatewaySchedulerOptions = this.manager.client.options.ws?.gatewayScheduler ?? {};
    this._sendScheduler = new GatewaySendScheduler(this, {
      capacity: gatewaySchedulerOptions.capacity ?? 110,
      windowMs: gatewaySchedulerOptions.windowMs ?? 60e3,
      importantBurst: gatewaySchedulerOptions.importantBurst ?? 8,
    });

    const scheduler = this._sendScheduler;
    Object.defineProperty(this, 'ratelimit', {
      value: {
        queue: {
          push: value => {
            scheduler.normalQueue.push(value);
            return scheduler.length;
          },
          unshift: value => {
            scheduler.importantQueue.unshift(value);
            return scheduler.length;
          },
          shift: () => scheduler._dequeue(),
          clear: () => {
            scheduler.normalQueue.clear();
            scheduler.importantQueue.clear();
            scheduler._importantStreak = 0;
          },
          get length() {
            return scheduler.length;
          },
        },
        total: scheduler.capacity,
        get remaining() {
          return scheduler.remaining;
        },
        set remaining(value) {
          scheduler._tokens = Number.isFinite(value) ? Number(value) : scheduler.capacity;
        },
        time: scheduler.windowMs,
        get timer() {
          return scheduler.timer;
        },
      },
    });

    /**
     * The WebSocket connection for the current shard
     * @name WebSocketShard#connection
     * @type {?WebSocket}
     * @private
     */
    Object.defineProperty(this, 'connection', { value: null, writable: true });

    /**
     * @external Inflate
     * @see {@link https://www.npmjs.com/package/zlib-sync}
     */

    /**
     * The compression to use
     * @name WebSocketShard#inflate
     * @type {?Inflate}
     * @private
     */
    Object.defineProperty(this, 'inflate', { value: null, writable: true });

    /**
     * The HELLO timeout
     * @name WebSocketShard#helloTimeout
     * @type {?NodeJS.Timeout}
     * @private
     */
    Object.defineProperty(this, 'helloTimeout', { value: null, writable: true });

    /**
     * The WebSocket timeout.
     * @name WebSocketShard#wsCloseTimeout
     * @type {?NodeJS.Timeout}
     * @private
     */
    Object.defineProperty(this, 'wsCloseTimeout', { value: null, writable: true });

    /**
     * The first-heartbeat timeout before the regular interval starts.
     * @name WebSocketShard#heartbeatTimeout
     * @type {?NodeJS.Timeout}
     * @private
     */
    Object.defineProperty(this, 'heartbeatTimeout', { value: null, writable: true });

    /**
     * Delayed identify timer used after INVALID_SESSION.
     * @name WebSocketShard#invalidSessionTimeout
     * @type {?NodeJS.Timeout}
     * @private
     */
    Object.defineProperty(this, 'invalidSessionTimeout', { value: null, writable: true });

    /**
     * If the manager attached its event handlers on the shard
     * @name WebSocketShard#eventsAttached
     * @type {boolean}
     * @private
     */
    Object.defineProperty(this, 'eventsAttached', { value: false, writable: true });

    /**
     * A set of guild ids this shard expects to receive
     * @name WebSocketShard#expectedGuilds
     * @type {?Set<string>}
     * @private
     */
    Object.defineProperty(this, 'expectedGuilds', { value: null, writable: true });

    /**
     * The ready timeout
     * @name WebSocketShard#readyTimeout
     * @type {?NodeJS.Timeout}
     * @private
     */
    Object.defineProperty(this, 'readyTimeout', { value: null, writable: true });

    /**
     * Time when the WebSocket connection was opened
     * @name WebSocketShard#connectedAt
     * @type {number}
     * @private
     */
    Object.defineProperty(this, 'connectedAt', { value: 0, writable: true });

    this._timeSpentSessionInterval = null;
    this._timeSpentSessionInitTimestamp = null;
  }

  /**
   * Emits a debug event.
   * @param {string} message The debug message
   * @private
   */
  debug(message) {
    this.manager.debug(message, this);
  }

  /**
   * Connects the shard to the gateway.
   * @private
   * @returns {Promise<void>} A promise that will resolve if the shard turns ready successfully,
   * or reject if we couldn't connect
   */
  connect() {
    const { client } = this.manager;

    if (this.connection?.readyState === WebSocket.OPEN && this.status === Status.READY) {
      return Promise.resolve();
    }

    const gateway = this.resumeURL ?? this.manager.gateway;

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.removeListener(ShardEvents.CLOSE, onClose);
        this.removeListener(ShardEvents.READY, onReady);
        this.removeListener(ShardEvents.RESUMED, onResumed);
        this.removeListener(ShardEvents.INVALID_SESSION, onInvalidOrDestroyed);
        this.removeListener(ShardEvents.DESTROYED, onInvalidOrDestroyed);
      };

      const onReady = () => {
        cleanup();
        resolve();
      };

      const onResumed = () => {
        cleanup();
        resolve();
      };

      const onClose = event => {
        cleanup();
        reject(event);
      };

      const onInvalidOrDestroyed = () => {
        cleanup();
        // eslint-disable-next-line prefer-promise-reject-errors
        reject();
      };

      this.once(ShardEvents.READY, onReady);
      this.once(ShardEvents.RESUMED, onResumed);
      this.once(ShardEvents.CLOSE, onClose);
      this.once(ShardEvents.INVALID_SESSION, onInvalidOrDestroyed);
      this.once(ShardEvents.DESTROYED, onInvalidOrDestroyed);

      if (this.connection?.readyState === WebSocket.OPEN) {
        this.debug('An open connection was found, attempting an immediate identify.');
        this.identify();
        return;
      }

      if (this.connection) {
        this.debug(`A connection object was found. Cleaning up before continuing.
    State: ${this.getConnectionState()}`);
        this.destroy({ emit: false });
      }

      const wsQuery = { v: client.options.ws.version };
      const hasProxyAgent = Util.verifyProxyAgent(client.options.ws.agent);

      if (zlib) {
        this.inflate = new zlib.Inflate({
          chunkSize: 65535,
          flush: zlib.Z_SYNC_FLUSH,
          to: WebSocket.encoding === 'json' ? 'string' : '',
        });
        wsQuery.compress = 'zlib-stream';
      }

      this.debug(
        `[CONNECT]
    Gateway    : ${gateway}
    Version    : ${client.options.ws.version}
    Encoding   : ${WebSocket.encoding}
    Compression: ${zlib ? 'zlib-stream' : 'none'}
    Agent      : ${hasProxyAgent}`,
      );

      this.status = this.status === Status.DISCONNECTED ? Status.RECONNECTING : Status.CONNECTING;
      this.setHelloTimeout();
      this.setWsCloseTimeout(-1);
      this.connectedAt = Date.now();

      // Adding a handshake timeout to just make sure no zombie connection appears.
      const ws = (this.connection = WebSocket.create(gateway, wsQuery, {
        handshakeTimeout: 30_000,
        agent: hasProxyAgent ? client.options.ws.agent : undefined,
      }));
      ws.onopen = this.onOpen.bind(this);
      ws.onmessage = this.onMessage.bind(this);
      ws.onerror = this.onError.bind(this);
      ws.onclose = this.onClose.bind(this);
    });
  }

  /**
   * Called whenever a connection is opened to the gateway.
   * @private
   */
  onOpen() {
    this.debug(`[CONNECTED] Took ${Date.now() - this.connectedAt}ms`);
    this.status = Status.NEARLY;
  }

  /**
   * Called whenever a message is received.
   * @param {MessageEvent} event Event received
   * @private
   */
  onMessage({ data }) {
    let raw;
    if (data instanceof ArrayBuffer) data = new Uint8Array(data);
    if (zlib) {
      const l = data.length;
      const flush =
        l >= 4 && data[l - 4] === 0x00 && data[l - 3] === 0x00 && data[l - 2] === 0xff && data[l - 1] === 0xff;

      this.inflate.push(data, flush && zlib.Z_SYNC_FLUSH);
      if (!flush) return;
      raw = this.inflate.result;
    } else {
      raw = data;
    }
    let packet;
    try {
      packet = WebSocket.unpack(raw);
    } catch (err) {
      this.manager.client.emit(Events.SHARD_ERROR, err, this.id);
      return;
    }
    const client = this.manager.client;
    const hasRawListener = hasListener(client, Events.RAW);
    if (hasRawListener) {
      client.emit(Events.RAW, packet, this.id);
    }
    if (packet.op === Opcodes.DISPATCH && hasListener(this.manager, packet.t)) {
      this.manager.emit(packet.t, packet.d, this.id);
    }
    this.onPacket(packet);
  }

  /**
   * Called whenever an error occurs with the WebSocket.
   * @param {ErrorEvent} event The error that occurred
   * @private
   */
  onError(event) {
    const error = event?.error ?? event;
    if (!error) return;

    /**
     * Emitted whenever a shard's WebSocket encounters a connection error.
     * @event Client#shardError
     * @param {Error} error The encountered error
     * @param {number} shardId The shard that encountered this error
     */
    this.manager.client.emit(Events.SHARD_ERROR, error, this.id);
  }

  /**
   * @external CloseEvent
   * @see {@link https://developer.mozilla.org/docs/Web/API/CloseEvent}
   */

  /**
   * @external ErrorEvent
   * @see {@link https://developer.mozilla.org/docs/Web/API/ErrorEvent}
   */

  /**
   * @external MessageEvent
   * @see {@link https://developer.mozilla.org/docs/Web/API/MessageEvent}
   */

  /**
   * Called whenever a connection to the gateway is closed.
   * @param {CloseEvent} event Close event that was received
   * @private
   */
  onClose(event) {
    this.closeEmitted = true;
    if (this.sequence !== -1) this.closeSequence = this.sequence;
    this.sequence = -1;
    this.setHeartbeatTimer(-1);
    this.setHelloTimeout(-1);
    // Clearing the WebSocket close timeout as close was emitted.
    this.setWsCloseTimeout(-1);
    // If we still have a connection object, clean up its listeners
    if (this.connection) {
      this._cleanupConnection();
      // Having this after _cleanupConnection to just clean up the connection and not listen to ws.onclose
      this.destroy({ reset: !this.sessionId, emit: false, log: false });
    }
    this.status = Status.DISCONNECTED;
    this.emitClose(event);
  }

  /**
   * This method is responsible to emit close event for this shard.
   * This method helps the shard reconnect.
   * @param {CloseEvent} [event] Close event that was received
   */
  emitClose(
    event = {
      code: 1011,
      reason: WSCodes[1011],
      wasClean: false,
    },
  ) {
    this.debug(`[CLOSE]
    Event Code: ${event.code}
    Clean     : ${event.wasClean}
    Reason    : ${event.reason ?? 'No reason received'}`);
    /**
     * Emitted when a shard's WebSocket closes.
     * @private
     * @event WebSocketShard#close
     * @param {CloseEvent} event The received event
     */
    this.emit(ShardEvents.CLOSE, event);
  }

  /**
   * Called whenever a packet is received.
   * @param {Object} packet The received packet
   * @private
   */
  onPacket(packet) {
    if (!packet) {
      this.debug(`Received broken packet: '${packet}'.`);
      return;
    }

    switch (packet.t) {
      case WSEvents.READY:
        /**
         * Emitted when the shard receives the READY payload and is now waiting for guilds
         * @event WebSocketShard#ready
         */
        this.emit(ShardEvents.READY);

        this.resumeURL = packet.d.resume_gateway_url;
        this.sessionId = packet.d.session_id;
        this.expectedGuilds = new Set();
        for (const guildData of packet.d.guilds) {
          if (guildData?.unavailable == true) this.expectedGuilds.add(guildData.id);
        }
        this.status = Status.WAITING_FOR_GUILDS;
        this.debug(`[READY] Session ${this.sessionId} | Resume url ${this.resumeURL}.`);
        this.lastHeartbeatAcked = true;
        this.sendUpdateTimeSpentSessionId();
        this.sendHeartbeat('ReadyHeartbeat');
        if (!this._timeSpentSessionInterval) {
          this._timeSpentSessionInterval = setInterval(() => {
            if (this.connection?.readyState === WebSocket.OPEN) {
              this.sendUpdateTimeSpentSessionId();
              this.sendHeartbeat('TimeSpentSessionHeartbeat');
            }
          }, 30 * 60 * 1000).unref();
        }
        break;
      case WSEvents.RESUMED: {
        /**
         * Emitted when the shard resumes successfully
         * @event WebSocketShard#resumed
         */
        this.emit(ShardEvents.RESUMED);

        this.status = Status.READY;
        const replayed = packet.s - this.closeSequence;
        this.debug(`[RESUMED] Session ${this.sessionId} | Replayed ${replayed} events.`);
        this.lastHeartbeatAcked = true;
        this.sendUpdateTimeSpentSessionId();
        this.sendHeartbeat('ResumeHeartbeat');
        break;
      }
    }

    if (packet.s > this.sequence) this.sequence = packet.s;

    switch (packet.op) {
      case Opcodes.HELLO:
        this.setHelloTimeout(-1);
        this.setHeartbeatTimer(packet.d.heartbeat_interval);
        this.identify();
        break;
      case Opcodes.RECONNECT:
        this.debug('[RECONNECT] Discord asked us to reconnect');
        this.destroy({ closeCode: 4_000 });
        break;
      case Opcodes.INVALID_SESSION: {
        this.debug(`[INVALID SESSION] Resumable: ${packet.d}.`);
        // If we can resume the session, do so immediately
        if (packet.d) {
          this.identifyResume();
          return;
        }
        // Reset the sequence
        this.sequence = -1;
        // Reset the session id as it's invalid
        this.sessionId = null;
        // Set the status to reconnecting
        this.status = Status.RECONNECTING;
        const retryDelay = Math.floor(Math.random() * 4_000) + 1_000;
        this.debug(`[INVALID SESSION] Scheduling re-identify in ${retryDelay}ms.`);
        // Finally, emit the INVALID_SESSION event
        /**
         * Emitted when the session has been invalidated.
         * @event WebSocketShard#invalidSession
         */
        this.emit(ShardEvents.INVALID_SESSION);
        if (this.invalidSessionTimeout) {
          clearTimeout(this.invalidSessionTimeout);
        }
        this.invalidSessionTimeout = setTimeout(() => {
          this.invalidSessionTimeout = null;
          if (this.connection?.readyState === WebSocket.OPEN) {
            this.identifyNew();
          } else {
            this.destroy({ reset: true, emit: false, log: false });
          }
        }, retryDelay).unref();
        break;
      }
      case Opcodes.HEARTBEAT_ACK:
        this.ackHeartbeat();
        break;
      case Opcodes.HEARTBEAT:
        this.sendHeartbeat('HeartbeatRequest', true);
        break;
      default:
        this.manager.handlePacket(packet, this);
        if (this.status === Status.WAITING_FOR_GUILDS && packet.t === WSEvents.GUILD_CREATE) {
          this.expectedGuilds.delete(packet.d.id);
          this.checkReady();
        }
    }
  }

  /**
   * Checks if the shard can be marked as ready
   * @private
   */
  checkReady() {
    // Step 0. Clear the ready timeout, if it exists
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
    // Step 1. If we don't have any other guilds pending, we are ready
    if (!this.expectedGuilds.size) {
      this.debug('Shard received all its guilds. Marking as fully ready.');
      this.status = Status.READY;

      /**
       * Emitted when the shard is fully ready.
       * This event is emitted if:
       * * all guilds were received by this shard
       * * the ready timeout expired, and some guilds are unavailable
       * @event WebSocketShard#allReady
       * @param {?Set<string>} unavailableGuilds Set of unavailable guilds, if any
       */
      this.emit(ShardEvents.ALL_READY);
      return;
    }
    // Step 2. Create a timeout that will mark the shard as ready if there are still unavailable guilds
    // * The timeout is 15 seconds by default
    // * This can be optionally changed in the client options via the `waitGuildTimeout` option
    // * a timeout time of zero will skip this timeout, which potentially could cause the Client to miss guilds.

    const { waitGuildTimeout } = this.manager.client.options;

    this.readyTimeout = setTimeout(
      () => {
        this.debug(
          `Shard ${this._hasGuildsIntent ? 'did' : 'will'} not receive any more guild packets` +
            `${this._hasGuildsIntent ? ` in ${waitGuildTimeout} ms` : ''}.\nUnavailable guild count: ${
              this.expectedGuilds.size
            }`,
        );

        this.readyTimeout = null;

        this.status = Status.READY;

        this.emit(ShardEvents.ALL_READY, this.expectedGuilds);
      },
      this._hasGuildsIntent ? waitGuildTimeout : 0,
    ).unref();
  }

  /**
   * Sets the HELLO packet timeout.
   * @param {number} [time] If set to -1, it will clear the hello timeout
   * @private
   */
  setHelloTimeout(time) {
    if (time === -1) {
      if (this.helloTimeout) {
        this.debug('Clearing the HELLO timeout.');
        clearTimeout(this.helloTimeout);
        this.helloTimeout = null;
      }
      return;
    }
    this.debug('Setting a HELLO timeout for 20s.');
    this.helloTimeout = setTimeout(() => {
      this.debug('Did not receive HELLO in time. Destroying and connecting again.');
      this.destroy({ reset: true, closeCode: 4009 });
    }, 20_000).unref();
  }

  /**
   * Sets the WebSocket Close timeout.
   * This method is responsible for detecting any zombie connections if the WebSocket fails to close properly.
   * @param {number} [time] If set to -1, it will clear the timeout
   * @private
   */
  setWsCloseTimeout(time) {
    if (this.wsCloseTimeout) {
      this.debug('[WebSocket] Clearing the close timeout.');
      clearTimeout(this.wsCloseTimeout);
    }
    if (time === -1) {
      this.wsCloseTimeout = null;
      return;
    }
    this.wsCloseTimeout = setTimeout(() => {
      this.setWsCloseTimeout(-1);

      // Check if close event was emitted.
      if (this.closeEmitted) {
        this.debug(`[WebSocket] close was already emitted, assuming the connection was closed properly.`);
        // Setting the variable false to check for zombie connections.
        this.closeEmitted = false;
        return;
      }

      this.debug(
        // eslint-disable-next-line max-len
        `[WebSocket] Close Emitted: ${this.closeEmitted} | did not close properly, assuming a zombie connection.\nEmitting close and reconnecting again.`,
      );

      if (this.connection) this._cleanupConnection();

      this.emitClose({
        code: 4009,
        reason: 'Session time out.',
        wasClean: false,
      });
    }, time);
  }

  /**
   * Sets the heartbeat timer for this shard.
   * @param {number} time If -1, clears the interval, any other number sets an interval
   * @private
   */
  setHeartbeatTimer(time) {
    if (time === -1) {
      if (this.heartbeatTimeout) {
        this.debug('Clearing the first heartbeat timeout.');
        clearTimeout(this.heartbeatTimeout);
        this.heartbeatTimeout = null;
      }
      if (this.heartbeatInterval) {
        this.debug('Clearing the heartbeat interval.');
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      if (this._timeSpentSessionInterval) {
        clearInterval(this._timeSpentSessionInterval);
        this._timeSpentSessionInterval = null;
      }
      return;
    }
    this.debug(`Setting a heartbeat interval for ${time}ms.`);
    // Sanity checks
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    const jitter = Math.floor(Math.random() * time);
    this.debug(`Scheduling first heartbeat in ${jitter}ms.`);
    this.heartbeatTimeout = setTimeout(() => {
      this.heartbeatTimeout = null;
      this.sendHeartbeat('HeartbeatJitter', true);
      this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), time).unref();
    }, jitter).unref();
  }

  /**
   * Sends a heartbeat to the WebSocket.
   * If this shard didn't receive a heartbeat last time, it will destroy it and reconnect
   * @param {string} [tag='HeartbeatTimer'] What caused this heartbeat to be sent
   * @param {boolean} [ignoreHeartbeatAck] If we should send the heartbeat forcefully.
   * @private
   */
  sendHeartbeat(
    tag = 'HeartbeatTimer',
    ignoreHeartbeatAck = this.status === Status.WAITING_FOR_GUILDS ||
      this.status === Status.IDENTIFYING ||
      this.status === Status.RESUMING,
  ) {
    if (ignoreHeartbeatAck && !this.lastHeartbeatAcked) {
      this.debug(`[${tag}] Didn't process heartbeat ack yet but we are still connected. Sending one now.`);
    } else if (!this.lastHeartbeatAcked) {
      this.debug(
        `[${tag}] Didn't receive a heartbeat ack last time, assuming zombie connection. Destroying and reconnecting.
    Status          : ${STATUS_KEYS[this.status]}
    Sequence        : ${this.sequence}
    Connection State: ${this.connection ? CONNECTION_STATE[this.connection.readyState] : 'No Connection??'}`,
      );
      this.destroy({ reset: true, closeCode: 4009 });
      return;
    }

    this.debug(`[${tag}] Sending a heartbeat.`);
    this.lastHeartbeatAcked = false;
    this.lastPingTimestamp = Date.now();

    const useQos = this.manager.client.options.ws?.useQosHeartbeat;
    if (useQos) {
      this.send(
        {
          op: Opcodes.QOS_HEARTBEAT,
          d: {
            seq: this.sequence,
            qos: { ver: 27, active: true, reasons: ['foregrounded'] },
          },
        },
        true,
      );
    } else {
      this.send({ op: Opcodes.HEARTBEAT, d: this.sequence }, true);
    }
  }

  sendUpdateTimeSpentSessionId() {
    const props = this.manager.client.options.ws?.properties;
    if (!props?.client_heartbeat_session_id || !props?.client_launch_id) return;

    this._timeSpentSessionInitTimestamp ??= Date.now();
    this.send(
      {
        op: Opcodes.UPDATE_TIME_SPENT_SESSION_ID,
        d: {
          initialization_timestamp: this._timeSpentSessionInitTimestamp,
          session_id: props.client_heartbeat_session_id,
          client_launch_id: props.client_launch_id,
        },
      },
      true,
    );
    this.debug('[UPDATE_TIME_SPENT] Sent Opcode 41.');
  }

  /**
   * Acknowledges a heartbeat.
   * @private
   */
  ackHeartbeat() {
    this.lastHeartbeatAcked = true;
    const latency = Date.now() - this.lastPingTimestamp;
    this.debug(`Heartbeat acknowledged, latency of ${latency}ms.`);
    this.ping = latency;
  }

  /**
   * Identifies the client on the connection.
   * @private
   * @returns {void}
   */
  identify() {
    if (this.invalidSessionTimeout) {
      clearTimeout(this.invalidSessionTimeout);
      this.invalidSessionTimeout = null;
    }
    return this.sessionId ? this.identifyResume() : this.identifyNew();
  }

  /**
   * Identifies as a new connection on the gateway.
   * @private
   */
  identifyNew() {
    const { client } = this.manager;
    if (!client.token) {
      this.debug('[IDENTIFY] No token available to identify a new session.');
      return;
    }

    this.status = Status.IDENTIFYING;

    if (!this._wsPropsNormalized) {
      const wsProperties = client.options.ws.properties;
      for (const key of Object.keys(wsProperties)) {
        if (!key.startsWith('$')) continue;
        wsProperties[key.slice(1)] = wsProperties[key];
        delete wsProperties[key];
      }
      if (typeof client.rest.invalidateSuperProperties === 'function') client.rest.invalidateSuperProperties();
      this._wsPropsNormalized = true;
    }

    // Clone the identify payload and assign the token and shard info
    const d = {
      ...client.options.ws,
      token: client.token,
      large_threshold: 250,
      presence: {
        status: 'unknown',
        since: 0,
        activities: [],
        afk: false,
      },
      client_state: {
        ...client.options.ws.client_state,
        api_code_version: 0,
      },
    };

    delete d.version;
    delete d.agent;

    const installationId = client.rest.getInstallationId?.();
    if (installationId) d.installation_id = installationId;

    this.debug(`[IDENTIFY] Shard ${this.id}`);
    this.send({ op: Opcodes.IDENTIFY, d }, true);
  }

  /**
   * Resumes a session on the gateway.
   * @private
   */
  identifyResume() {
    if (!this.sessionId) {
      this.debug('[RESUME] No session id was present; identifying as a new session.');
      this.identifyNew();
      return;
    }

    this.status = Status.RESUMING;

    this.debug(`[RESUME] Session ${this.sessionId}, sequence ${this.closeSequence}`);

    const d = {
      token: this.manager.client.token,
      session_id: this.sessionId,
      seq: this.closeSequence,
    };

    this.send({ op: Opcodes.RESUME, d }, true);
  }

  /**
   * Adds a packet to the queue to be sent to the gateway.
   * <warn>If you use this method, make sure you understand that you need to provide
   * a full [Payload](https://discord.com/developers/docs/topics/gateway-events#payload-structure).
   * Do not use this method if you don't know what you're doing.</warn>
   * @param {Object} data The full packet to send
   * @param {boolean} [important=false] If this packet should be added first in queue
   */
  send(data, important = false) {
    this._sendScheduler.enqueue(data, important);
  }

  /**
   * Sends data, bypassing the queue.
   * @param {Object} data Packet to send
   * @returns {void}
   * @private
   */
  _send(data) {
    const client = this.manager.client;
    const hasDebugListener = hasListener(client, Events.DEBUG);
    const dataJSON = hasDebugListener ? JSON.stringify(data) : null;
    if (this.connection?.readyState !== WebSocket.OPEN) {
      if (hasDebugListener) {
        this.debug(`Tried to send packet '${dataJSON}' but no WebSocket is available!`);
      }
      this.destroy({ closeCode: 4_000 });
      return;
    }

    let packed;
    try {
      packed = WebSocket.pack(data);
    } catch (err) {
      client.emit(Events.SHARD_ERROR, err, this.id);
      return;
    }

    const byteSize = typeof packed === 'string' ? Buffer.byteLength(packed) : packed.byteLength ?? packed.length ?? 0;
    if (byteSize > 15 * 1024) {
      if (hasDebugListener) {
        this.debug(`[WebSocketShard] refusing oversized payload (${byteSize} bytes)`);
      }
      client.emit(
        Events.SHARD_ERROR,
        new Error(`Gateway payload exceeds 15KiB (${byteSize} bytes).`), // eslint-disable-line no-restricted-syntax
        this.id,
      );
      return;
    }

    if (hasDebugListener) {
      this.debug(`[WebSocketShard] send packet '${dataJSON}'`);
    }
    this.connection.send(packed, err => {
      if (err) client.emit(Events.SHARD_ERROR, err, this.id);
    });
  }

  /**
   * Processes the current WebSocket queue.
   * @returns {void}
   * @private
   */
  processQueue() {
    this._sendScheduler.process();
  }

  /**
   * Destroys this shard and closes its WebSocket connection.
   * @param {Object} [options={ closeCode: 1000, reset: false, emit: true, log: true }] Options for destroying the shard
   * @private
   */
  destroy({ closeCode = 1_000, reset = false, emit = true, log = true } = {}) {
    if (log) {
      this.debug(`[DESTROY]
    Close Code    : ${closeCode}
    Reset         : ${reset}
    Emit DESTROYED: ${emit}`);
    }

    // Step 0: Remove all timers
    this.setHeartbeatTimer(-1);
    this.setHelloTimeout(-1);
    if (this.invalidSessionTimeout) {
      clearTimeout(this.invalidSessionTimeout);
      this.invalidSessionTimeout = null;
    }

    this.debug(
      `[WebSocket] Destroy: Attempting to close the WebSocket. | WS State: ${
        this.connection ? this.getConnectionState() : CONNECTION_STATE[WebSocket.CLOSED]
      }`,
    );
    // Step 1: Close the WebSocket connection, if any, otherwise, emit DESTROYED
    if (this.connection) {
      // If the connection is currently opened, we will (hopefully) receive close
      if (this.connection?.readyState === WebSocket.OPEN) {
        this.connection.close(closeCode);
        this.debug(`[WebSocket] Close: Tried closing. | WS State: ${this.getConnectionState()}`);
      } else {
        // Connection is not OPEN
        this.debug(`WS State: ${this.getConnectionState()}`);
        // Attempt to close the connection just in case
        try {
          this.connection.close(closeCode);
        } catch (err) {
          this.debug(
            `[WebSocket] Close: Something went wrong while closing the WebSocket: ${
              err.message || err
            }. Forcefully terminating the connection | WS State: ${this.getConnectionState()}`,
          );
          this.connection.terminate();
        }
        // Emit the destroyed event if needed
        if (emit) this._emitDestroyed();
      }
    } else if (emit) {
      // We requested a destroy, but we had no connection. Emit destroyed
      this._emitDestroyed();
    }

    this.debug(
      `[WebSocket] Adding a WebSocket close timeout to ensure a correct WS reconnect.
        Timeout: ${this.manager.client.options.closeTimeout}ms`,
    );
    this.setWsCloseTimeout(this.manager.client.options.closeTimeout);

    // Step 2: Null the connection object
    this.connection = null;

    // Step 3: Set the shard status to DISCONNECTED
    this.status = Status.DISCONNECTED;

    // Step 4: Cache the old sequence (use to attempt a resume)
    if (this.sequence !== -1) this.closeSequence = this.sequence;

    // Step 5: Reset the sequence, resume URL and session id if requested
    if (reset) {
      this.resumeURL = null;
      this.sequence = -1;
      this.sessionId = null;
    }

    // Step 6: reset the rate limit data
    this._sendScheduler.clear();
  }

  /**
   * Cleans up the WebSocket connection listeners.
   * @private
   */
  _cleanupConnection() {
    this.connection.onopen = this.connection.onclose = this.connection.onmessage = null;
    this.connection.onerror = () => null;
  }

  /**
   * Emits the DESTROYED event on the shard
   * @private
   */
  _emitDestroyed() {
    /**
     * Emitted when a shard is destroyed, but no WebSocket connection was present.
     * @private
     * @event WebSocketShard#destroyed
     */
    this.emit(ShardEvents.DESTROYED);
  }
}

module.exports = WebSocketShard;
