'use strict';

function hasListener(emitter, event) {
  if (!emitter) return false;
  if (typeof emitter.hasListenerFast === 'function') return emitter.hasListenerFast(event);
  if (typeof emitter.listenerCount === 'function') return emitter.listenerCount(event) > 0;
  return false;
}

module.exports = {
  hasListener,
};
