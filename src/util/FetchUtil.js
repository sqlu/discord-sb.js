'use strict';

const isBun = typeof Bun !== 'undefined';

if (!isBun) {
  throw new Error('discord-sb.js Bun-only build requires Bun runtime.');
}

const getNativeFetch = () => globalThis.fetch.bind(globalThis);

let _impitInstance = null;
const getImpitFetch = (options = {}) => {
  if (_impitInstance) return _impitInstance.fetch.bind(_impitInstance);
  try {
    const { Impit } = require('impit');
    _impitInstance = new Impit({
      browser: options.browser ?? 'chrome',
      proxyUrl: options.proxyUrl ?? undefined,
      ignoreTlsErrors: options.ignoreTlsErrors ?? false,
    });
    return _impitInstance.fetch.bind(_impitInstance);
  } catch (e) {
    return null;
  }
};
const getNativeFormData = () => globalThis.FormData;

const createCookieJar = () => new Bun.CookieMap();

const serializeCookieMap = cookieMap => {
  if (!cookieMap || cookieMap.size === 0) return '';
  const parts = [];
  for (const [name, value] of cookieMap) parts.push(`${name}=${value}`);
  return parts.join('; ');
};

const applyCookiesToHeaders = (headers, cookieJar) => {
  if (!cookieJar || cookieJar.size === 0) return;
  if (headers.has('cookie')) return;
  const cookieHeader = serializeCookieMap(cookieJar);
  if (cookieHeader) headers.set('cookie', cookieHeader);
};

const storeCookiesFromResponse = (response, cookieJar) => {
  if (!cookieJar || !response?.headers?.getAll) return;
  const setCookies = response.headers.getAll('set-cookie');
  if (!setCookies?.length) return;
  for (const setCookie of setCookies) {
    try {
      const parsed = Bun.Cookie.parse(setCookie);
      if (parsed) cookieJar.set(parsed.toJSON());
    } catch {
      // Ignore invalid cookie entries
    }
  }
};

const wrapFetchWithCookies =
  (fetchFn, cookieJar) =>
  async (url, options = {}) => {
    const headers = new Headers(options.headers ?? {});
    applyCookiesToHeaders(headers, cookieJar);
    const response = await fetchFn(url, { ...options, headers });
    storeCookiesFromResponse(response, cookieJar);
    return response;
  };

module.exports = {
  isBun,
  getNativeFetch,
  getImpitFetch,
  getNativeFormData,
  createCookieJar,
  wrapFetchWithCookies,
  applyCookiesToHeaders,
  storeCookiesFromResponse,
};
