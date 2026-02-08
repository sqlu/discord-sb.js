'use strict';

const Buffer = require('node:buffer').Buffer;
const { setInterval } = require('node:timers');
const { Collection } = require('@discordjs/collection');
const APIRequest = require('./APIRequest');
const routeBuilder = require('./APIRouter');
const RequestHandler = require('./RequestHandler');
const { Error } = require('../errors');
const { Endpoints } = require('../util/Constants');
const FetchUtil = require('../util/FetchUtil');
class RESTManager {
  constructor(client) {
    this.client = client;
    this.handlers = new Collection();
    this.versioned = true;
    this.globalLimit = client.options.restGlobalRateLimit > 0 ? client.options.restGlobalRateLimit : Infinity;
    this.globalRemaining = this.globalLimit;
    this.globalReset = null;
    this.globalDelay = null;
    this.cookieJar = FetchUtil.createCookieJar();
    this.fetch = FetchUtil.wrapFetchWithCookies(FetchUtil.getNativeFetch(), this.cookieJar);

    this._api = routeBuilder(this);
    this._cdn = null;
    this._cdnRoot = null;
    this._superProperties = null;
    this._superPropertiesUA = null;
    this._superPropertiesWsProps = null;
    this._authToken = null;
    this._auth = null;

    if (client.options.restSweepInterval > 0) {
      this.sweepInterval = setInterval(() => {
        this.handlers.sweep(handler => handler._inactive);
      }, client.options.restSweepInterval * 1_000).unref();
    }
  }

  get api() {
    return this._api;
  }

  getAuth() {
    const token = this.client.token ?? this.client.accessToken;
    if (!token) throw new Error('TOKEN_MISSING');
    if (token === this._authToken && this._auth) return this._auth;
    this._authToken = token;
    this._auth = token.replace(/Bot /g, '');
    return this._auth;
  }

  invalidateSuperProperties() {
    this._superProperties = null;
    this._superPropertiesUA = null;
    this._superPropertiesWsProps = null;
  }

  getSuperProperties(userAgent) {
    const wsProps = this.client.options.ws.properties;
    if (wsProps.browser_user_agent !== userAgent) wsProps.browser_user_agent = userAgent;

    if (this._superProperties && this._superPropertiesUA === userAgent && this._superPropertiesWsProps === wsProps) {
      return this._superProperties;
    }

    this._superPropertiesUA = userAgent;
    this._superPropertiesWsProps = wsProps;
    this._superProperties = Buffer.from(JSON.stringify(wsProps), 'ascii').toString('base64');
    return this._superProperties;
  }

  get cdn() {
    const root = this.client.options.http.cdn;
    if (!this._cdn || this._cdnRoot !== root) {
      this._cdn = Endpoints.CDN(root);
      this._cdnRoot = root;
    }
    return this._cdn;
  }

  request(method, url, options = {}) {
    const apiRequest = new APIRequest(this, method, url, options);
    let handler = this.handlers.get(apiRequest.route);

    if (!handler) {
      handler = new RequestHandler(this);
      this.handlers.set(apiRequest.route, handler);
    }

    return handler.push(apiRequest);
  }

  get endpoint() {
    return this.client.options.http.api;
  }

  set endpoint(endpoint) {
    this.client.options.http.api = endpoint;
  }
}

module.exports = RESTManager;
