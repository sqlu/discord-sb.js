'use strict';

const { Buffer } = require('node:buffer');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const { setTimeout } = require('node:timers');
const { fetch } = require('undici');
const { UserAgent } = require('./Constants');
const Options = require('./Options');
const { WebSocket } = require('../WebSocket');

const defaultClientOptions = Options.createDefault();
const superPropertiesBase64 = Buffer.from(JSON.stringify(defaultClientOptions.ws.properties), 'ascii').toString(
  'base64',
);

const baseURL = 'https://discord.com/ra/';

const wsURL = 'wss://remote-auth-gateway.discord.gg/?v=2';

const receiveEvent = {
  HELLO: 'hello',
  NONCE_PROOF: 'nonce_proof',
  PENDING_REMOTE_INIT: 'pending_remote_init',
  HEARTBEAT_ACK: 'heartbeat_ack',
  PENDING_TICKET: 'pending_ticket',
  CANCEL: 'cancel',
  PENDING_LOGIN: 'pending_login',
};

const sendEvent = {
  INIT: 'init',
  NONCE_PROOF: 'nonce_proof',
  HEARTBEAT: 'heartbeat',
};

const Event = {
  READY: 'ready',
  ERROR: 'error',
  CANCEL: 'cancel',
  WAIT_SCAN: 'pending',
  FINISH: 'finish',
  CLOSED: 'closed',
  DEBUG: 'debug',
};

/**
 * Discord Auth QR
 * @extends {EventEmitter}
 * @abstract
 */
class DiscordAuthWebsocket extends EventEmitter {
  #ws = null;
  #heartbeatTimeout = null;
  #heartbeatInterval = null;
  #expire = null;
  #publicKey = null;
  #privateKey = null;
  #encodedPublicKey = null;
  #ticket = null;
  #fingerprint = '';
  #userDecryptString = '';

  /**
   * Creates a new DiscordAuthWebsocket instance.
   */
  constructor() {
    super();
    this.token = '';
  }

  /**
   * @type {string}
   */
  get AuthURL() {
    return baseURL + this.#fingerprint;
  }

  /**
   * @type {Date}
   */
  get exprire() {
    return this.#expire;
  }

  /**
   * @type {UserRaw}
   */
  get user() {
    return DiscordAuthWebsocket.decryptUser(this.#userDecryptString);
  }

  #createWebSocket(url) {
    this.#ws = new WebSocket(url, {
      headers: {
        Origin: 'https://discord.com',
        'User-Agent': UserAgent,
      },
    });
    this.#handleWebSocket();
  }

  #clearHeartbeatTimer() {
    if (!this.#heartbeatTimeout) return;
    clearTimeout(this.#heartbeatTimeout);
    this.#heartbeatTimeout = null;
  }

  #parseMessage(message) {
    try {
      const payload =
        typeof message === 'string'
          ? message
          : Buffer.isBuffer(message)
          ? message.toString('utf8')
          : message?.data instanceof ArrayBuffer
          ? Buffer.from(message.data).toString('utf8')
          : Buffer.isBuffer(message?.data)
          ? message.data.toString('utf8')
          : message?.data ?? message;
      const serialized = typeof payload === 'string' ? payload : String(payload);
      return JSON.parse(serialized);
    } catch (error) {
      this.emit(Event.ERROR, error);
      return null;
    }
  }

  #handleWebSocket() {
    this.#ws.on('error', error => {
      /**
       * WS Error
       * @event DiscordAuthWebsocket#error
       * @param {Error} error Error
       */
      this.emit(Event.ERROR, error);
    });
    this.#ws.on('open', () => {
      /**
       * Debug Event
       * @event DiscordAuthWebsocket#debug
       * @param {string} msg Debug msg
       */
      this.emit(Event.DEBUG, '[WS] Client Connected');
    });
    this.#ws.on('close', () => {
      this.#clearHeartbeatTimer();
      this.emit(Event.DEBUG, '[WS] Connection closed');
    });
    this.#ws.on('message', this.#handleMessage.bind(this));
  }

  #handleMessage(message) {
    const payload = this.#parseMessage(message);
    if (!payload) return;
    switch (payload.op) {
      case receiveEvent.HELLO: {
        this.#ready(payload);
        break;
      }

      case receiveEvent.NONCE_PROOF: {
        this.#receiveNonceProof(payload);
        break;
      }

      case receiveEvent.PENDING_REMOTE_INIT: {
        this.#fingerprint = payload.fingerprint;
        /**
         * Ready Event
         * @event DiscordAuthWebsocket#ready
         * @param {DiscordAuthWebsocket} client WS
         */
        this.emit(Event.READY, this);
        break;
      }

      case receiveEvent.HEARTBEAT_ACK: {
        this.emit(Event.DEBUG, `Heartbeat acknowledged.`);
        this.#heartbeatAck();
        break;
      }

      case receiveEvent.PENDING_TICKET: {
        this.#pendingLogin(payload);
        break;
      }

      case receiveEvent.CANCEL: {
        /**
         * Cancel
         * @event DiscordAuthWebsocket#cancel
         * @param {DiscordAuthWebsocket} client WS
         */
        this.emit(Event.CANCEL, this);
        this.destroy();
        break;
      }

      case receiveEvent.PENDING_LOGIN: {
        this.#ticket = payload.ticket;
        this.#findRealToken();
        break;
      }
    }
  }

  #send(op, data) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;
    let payload = { op: op };
    if (data !== null) payload = { ...payload, ...data };
    this.#ws.send(JSON.stringify(payload));
  }

  #heartbeatAck() {
    this.#clearHeartbeatTimer();
    this.#heartbeatTimeout = setTimeout(() => {
      this.#send(sendEvent.HEARTBEAT);
    }, this.#heartbeatInterval);
    if (typeof this.#heartbeatTimeout.unref === 'function') {
      this.#heartbeatTimeout.unref();
    }
  }

  #ready(data) {
    this.emit(Event.DEBUG, 'Attempting server handshake...');
    this.#expire = new Date(Date.now() + data.timeout_ms);
    this.#heartbeatInterval = data.heartbeat_interval;
    this.#createKey();
    this.#heartbeatAck();
    this.#init();
  }

  #createKey() {
    const key = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs1',
        format: 'pem',
      },
    });
    this.#privateKey = typeof key.privateKey === 'string' ? key.privateKey : key.privateKey.toString('utf8');
    this.#publicKey = typeof key.publicKey === 'string' ? key.publicKey : key.publicKey.toString('utf8');
    this.#encodedPublicKey = this.#encodePublicKey();
  }

  #encodePublicKey() {
    return this.#publicKey
      .replace('-----BEGIN PUBLIC KEY-----\n', '')
      .replace('\n-----END PUBLIC KEY-----\n', '')
      .replace(/\n/g, '');
  }

  #init() {
    this.#send(sendEvent.INIT, { encoded_public_key: this.#encodedPublicKey });
  }

  #receiveNonceProof(data) {
    const nonce = data.encrypted_nonce;
    const decrypted_nonce = this.#decryptPayload(nonce);
    const proof = crypto.createHash('sha256').update(decrypted_nonce).digest('base64url');
    this.#send(sendEvent.NONCE_PROOF, { proof: proof });
  }

  #decryptPayload(encrypted_payload) {
    const payload = Buffer.from(encrypted_payload, 'base64');
    const data = crypto.privateDecrypt(
      {
        key: this.#privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      payload,
    );
    return data;
  }

  #pendingLogin(data) {
    const user_data = this.#decryptPayload(data.encrypted_user_payload);
    this.#userDecryptString = user_data.toString('utf8');

    /**
     * @typedef {Object} UserRaw
     * @property {Snowflake} id
     * @property {string} username
     * @property {number} discriminator
     * @property {string} avatar
     */

    /**
     * Emitted whenever a user is scan QR Code.
     * @event DiscordAuthWebsocket#pending
     * @param {UserRaw} user Discord User Raw
     */
    this.emit(Event.WAIT_SCAN, this.user);
  }

  #awaitLogin(client) {
    return new Promise(r => {
      this.once(Event.FINISH, token => {
        r(client.login(token));
      });
    });
  }

  /**
   * Connect WS
   * @param {Client} [client] DiscordJS Client
   * @returns {Promise<void>}
   */
  connect(client) {
    this.#createWebSocket(wsURL);
    if (client) {
      return this.#awaitLogin(client);
    } else {
      return Promise.resolve();
    }
  }

  /**
   * Destroy client
   * @returns {void}
   */
  destroy() {
    if (!this.#ws) return;
    this.#clearHeartbeatTimer();
    this.#ws.close();
    this.#ws = null;
    this.emit(Event.DEBUG, 'WebSocket closed.');
    /**
     * Emitted whenever a connection is closed.
     * @event DiscordAuthWebsocket#closed
     */
    this.emit(Event.CLOSED);
  }

  /**
   * Generate QR code for user to scan (Terminal)
   * @returns {void}
   */
  generateQR() {
    if (!this.#fingerprint) return;
    require('qrcode').toString(this.AuthURL, { type: 'utf8', errorCorrectionLevel: 'L' }, (err, url) => {
      if (err) {
        //
      }
      console.log(url);
    });
  }

  async #findRealToken() {
    try {
      const response = await fetch(`https://discord.com/api/v9/users/@me/remote-auth/login`, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Accept-Language': 'en-US',
          'Content-Type': 'application/json',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'X-Debug-Options': 'bugReporterEnabled',
          'X-Super-Properties': superPropertiesBase64,
          'X-Discord-Locale': 'en-US',
          'User-Agent': UserAgent,
          Referer: 'https://discord.com/channels/@me',
          Connection: 'keep-alive',
          Origin: 'https://discord.com',
        },
        body: JSON.stringify({
          ticket: this.#ticket,
        }),
      });

      if (!response.ok) {
        throw new Error(`Remote auth exchange failed with status ${response.status}`);
      }

      const res = await response.json();
      if (res.encrypted_token) {
        this.token = this.#decryptPayload(res.encrypted_token).toString('utf8');
      }
      /**
       * Emitted whenever a real token is found.
       * @event DiscordAuthWebsocket#finish
       * @param {string} token Discord Token
       */
      this.emit(Event.FINISH, this.token);
    } catch (error) {
      this.emit(Event.ERROR, error);
    } finally {
      this.destroy();
    }
  }

  static decryptUser(payload) {
    const values = payload.split(':');
    const id = values[0];
    const username = values[3];
    const discriminator = values[1];
    const avatar = values[2];
    return {
      id,
      username,
      discriminator,
      avatar,
    };
  }
}

module.exports = DiscordAuthWebsocket;
