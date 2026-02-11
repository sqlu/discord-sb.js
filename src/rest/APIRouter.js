/* eslint-disable space-before-function-paren */
'use strict';

const methods = new Set(['get', 'post', 'delete', 'patch', 'put']);
const reflectors = new Set([
  'toString',
  'valueOf',
  'inspect',
  'constructor',
  Symbol.toPrimitive,
  Symbol.for('nodejs.util.inspect.custom'),
]);
const idRouteRegex = /\d{16,19}/;
const majorIdRoutes = new Set(['channels', 'guilds', 'webhooks']);
const kState = Symbol('api_route_state');

function buildRoute(manager) {
  const createProxy = state => {
    // The target must be callable for the `apply` trap to work.
    // eslint-disable-next-line func-style
    const target = function () {}; // eslint-disable-line func-names
    Object.defineProperty(target, kState, { value: state, writable: true });
    return new Proxy(target, handler);
  };

  const appendSegment = (state, segment) => {
    const seg = String(segment);

    const nextPath = `${state.path}/${seg}`;
    const nextPrev = seg;

    const freezeBuckets = state.bucketFrozen || state.prev === 'reactions';
    if (freezeBuckets) {
      return {
        path: nextPath,
        bucketRoute: state.bucketRoute,
        bucketFrozen: true,
        prev: nextPrev,
      };
    }

    const bucketSegment = idRouteRegex.test(seg) && !majorIdRoutes.has(state.prev) ? ':id' : seg;
    const nextBucket = `${state.bucketRoute}/${bucketSegment}`;

    return {
      path: nextPath,
      bucketRoute: nextBucket,
      bucketFrozen: false,
      prev: nextPrev,
    };
  };

  const handler = {
    get(target, name) {
      const state = target[kState];

      // Avoid the proxy being treated as a thenable by Promise resolution / `await`.
      if (name === 'then') return undefined;

      if (reflectors.has(name)) return () => state.path;

      if (methods.has(name)) {
        return options =>
          manager.request(
            name,
            state.path,
            Object.assign(
              {
                versioned: manager.versioned,
                route: state.bucketRoute,
              },
              options,
            ),
          );
      }
      if (typeof name === 'symbol') return undefined;

      return createProxy(appendSegment(state, name));
    },
    apply(target, _, args) {
      let state = target[kState];
      for (const arg of args) {
        // eslint-disable-next-line eqeqeq
        if (arg == null) continue;
        state = appendSegment(state, arg);
      }
      return createProxy(state);
    },
  };

  return createProxy({ path: '', bucketRoute: '', bucketFrozen: false, prev: '' });
}

module.exports = buildRoute;
