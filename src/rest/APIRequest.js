'use strict';

const Buffer = require('node:buffer').Buffer;
const { setTimeout } = require('node:timers');
const { ciphers } = require('../util/Constants');
const { getNativeFormData } = require('../util/FetchUtil');

const cypherList = ciphers.join(':');

const opsec_trop_uhq = {
  Windows: '"Windows"',
  Darwin: '"macOS"',
  Linux: '"Linux"',
};

const skyselfbotontop = (wsProperties = {}) => {
  const os = wsProperties.os || 'Windows';
  const platform = opsec_trop_uhq[os] ?? `"${os}"`;
  const locale = wsProperties.system_locale || 'en-US';
  const ua = wsProperties.browser_user_agent || '';
  const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
  const chromeVersion = chromeMatch ? chromeMatch[1] : '134.0.6998.205';

  const chromeMajor = chromeVersion.split('.')[0] || '134';
  return {
    accept: '*/*',
    'accept-language': locale,
    priority: 'u=1, i',
    referer: 'https://discord.com/channels/@me',
    'sec-ch-ua': `"Not:A-Brand";v="24", "Chromium";v="${chromeMajor}"`,
    'sec-ch-ua-full-version-list': `"Chromium";v="${chromeVersion}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': platform,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-discord-locale': locale,
    origin: 'https://discord.com',
  };
};

const isReadableStream = value => value && typeof value.getReader === 'function';
const isNodeReadable = value => value && typeof value.pipe === 'function';
const cloneHeaders = source => Object.assign({}, source);
const applyHeaderOverrides = (headers, overrides) => {
  if (!overrides) return;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete headers[key];
    else headers[key] = value;
  }
};

const streamToBuffer = async stream => {
  if (isReadableStream(stream)) {
    const arrayBuffer = await new Response(stream).arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const toFile = async (value, name) => {
  if (value instanceof File) return value;
  if (value instanceof Blob) return new File([value], name, { type: value.type || undefined });
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return new File([value], name);
  }
  if (isReadableStream(value) || isNodeReadable(value)) {
    const buffer = await streamToBuffer(value);
    return new File([buffer], name);
  }
  if (value?.arrayBuffer) {
    const buffer = await value.arrayBuffer();
    return new File([buffer], name);
  }
  return new File([String(value)], name);
};

class APIRequest {
  constructor(rest, method, path, options) {
    this.rest = rest;
    this.client = rest.client;
    this.method = method;
    this.methodUpper = method.toUpperCase();
    this.route = options.route;
    this.options = options;
    this.retries = 0;

    this.fullUserAgent = this.client.options.http.headers['User-Agent'];
    this.superProperties = rest.getSuperProperties(this.fullUserAgent);

    let queryString = '';
    if (options.query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.query)) {
        if (value === null || typeof value === 'undefined') continue;
        if (Array.isArray(value)) {
          for (const v of value) params.append(key, v);
        } else {
          params.append(key, value);
        }
      }
      queryString = params.toString();
    }
    this.path = queryString ? `${path}?${queryString}` : path;
  }

  getProxyConfig() {
    return this.rest.getProxyConfig();
  }

  async make(captchaKey, captchaRqToken) {
    const fetch = this.rest.fetch;
    const FormData = typeof this.rest.getFormData === 'function' ? this.rest.getFormData() : getNativeFormData();

    const API =
      this.options.versioned === false
        ? this.client.options.http.api
        : `${this.client.options.http.api}/v${this.client.options.http.version}`;
    const url = API + this.path;

    const headers =
      this.options.webhook === true ? {} : cloneHeaders(skyselfbotontop(this.client.options.ws?.properties || {}));

    if (this.options.webhook !== true) {
      headers['x-super-properties'] = this.superProperties;
      const timezone = this.rest.getTimezone();
      if (timezone !== undefined) headers['x-discord-timezone'] = timezone;

      const installationId = this.rest.getInstallationId?.();
      if (installationId) headers['X-Installation-ID'] = installationId;

      applyHeaderOverrides(headers, this.client.options.http.headers);
      headers['User-Agent'] = this.fullUserAgent;

      if (this.options.auth !== false) headers.Authorization = this.rest.getAuth();
      if (this.options.reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(this.options.reason);
      applyHeaderOverrides(headers, this.options.headers);
    } else {
      headers['User-Agent'] = this.client.options.http.headers['User-Agent'];
    }

    // Some options
    if (this.options.DiscordContext) {
      headers['X-Context-Properties'] = Buffer.from(JSON.stringify(this.options.DiscordContext), 'utf8').toString(
        'base64',
      );
    }

    if (this.options.mfaToken) {
      headers['X-Discord-Mfa-Authorization'] = this.options.mfaToken;
    }

    // Captcha
    if (captchaKey && typeof captchaKey == 'string') headers['X-Captcha-Key'] = captchaKey;
    if (captchaRqToken && typeof captchaRqToken == 'string') headers['X-Captcha-Rqtoken'] = captchaRqToken;

    let body;
    if (this.options.files?.length) {
      body = new FormData();
      for (const [index, file] of this.options.files.entries()) {
        if (!file?.file) continue;
        const resolved = await toFile(file.file, file.name ?? `file-${index}`);
        body.append(file.key ?? `files[${index}]`, resolved);
      }
      if (typeof this.options.data !== 'undefined') {
        if (this.options.dontUsePayloadJSON) {
          for (const [key, value] of Object.entries(this.options.data)) body.append(key, value);
        } else {
          body.append('payload_json', JSON.stringify(this.options.data));
        }
      }
      // eslint-disable-next-line eqeqeq
    } else if (this.options.data != null) {
      if (this.options.usePayloadJSON) {
        body = new FormData();
        body.append('payload_json', JSON.stringify(this.options.data));
      } else {
        body = JSON.stringify(this.options.data);
        headers['Content-Type'] = 'application/json';
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.client.options.restRequestTimeout).unref();
    const fetchOptions = {
      method: this.methodUpper, // Undici doesn't normalize "patch" into "PATCH" (which surprisingly follows the spec).
      headers,
      body,
      signal: controller.signal,
      redirect: 'follow',
      credentials: 'include',
    };
    if (cypherList) fetchOptions.tls = { ciphers: cypherList };
    const proxy = this.getProxyConfig();
    if (proxy) fetchOptions.proxy = proxy;
    return fetch(url, fetchOptions).finally(() => clearTimeout(timeout));
  }
}

module.exports = APIRequest;
