'use strict';

const noop = () => {}; // eslint-disable-line no-empty-function
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
const majorIdRoutes = new Set(['channels', 'guilds']);

function buildRouteBucket(route) {
  const routeBucket = [];
  for (let i = 0; i < route.length; i++) {
    const previous = route[i - 1];
    if (previous === 'reactions') break;
    const segment = route[i];
    if (idRouteRegex.test(segment) && !majorIdRoutes.has(previous)) routeBucket.push(':id');
    else routeBucket.push(segment);
  }
  return routeBucket;
}

function buildRoute(manager) {
  const route = [''];
  const handler = {
    get(target, name) {
      if (reflectors.has(name)) return () => route.join('/');
      if (methods.has(name)) {
        const routeBucket = buildRouteBucket(route);
        return options =>
          manager.request(
            name,
            route.join('/'),
            Object.assign(
              {
                versioned: manager.versioned,
                route: routeBucket.join('/'),
              },
              options,
            ),
          );
      }
      route.push(name);
      return new Proxy(noop, handler);
    },
    apply(target, _, args) {
      route.push(...args.filter(x => x != null)); // eslint-disable-line eqeqeq
      return new Proxy(noop, handler);
    },
  };
  return new Proxy(noop, handler);
}

module.exports = buildRoute;
