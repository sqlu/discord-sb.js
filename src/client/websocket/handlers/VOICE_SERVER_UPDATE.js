'use strict';

const { Events } = require('../../../util/Constants');
const { hasListener } = require('../../../util/ListenerUtil');

module.exports = (client, packet) => {
  const hasDebugListener = hasListener(client, Events.DEBUG);
  if (hasDebugListener) {
    client.emit(Events.DEBUG, `[VOICE] received voice server: ${JSON.stringify(packet)}`);
  }
  client.voice.onVoiceServer(packet.d);
};
