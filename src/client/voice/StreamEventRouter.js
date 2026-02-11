'use strict';

const { parseStreamKey } = require('./util/Function');

class StreamEventRouter {
  constructor(connection) {
    this.connection = connection;
    this._onRaw = this._onRaw.bind(this);
    this._attached = false;
  }

  attach() {
    if (this._attached) return;
    this.connection.channel.client.on('raw', this._onRaw);
    this._attached = true;
  }

  detach() {
    if (!this._attached) return;
    this.connection.channel.client.removeListener('raw', this._onRaw);
    this._attached = false;
  }

  _onRaw(packet) {
    if (typeof packet !== 'object' || !packet.t || !packet.d?.stream_key) return;
    const { t: event, d: data } = packet;
    const streamKey = parseStreamKey(data.stream_key);
    if (this.connection.channel.id !== streamKey.channelId) return;

    if (streamKey.userId === this.connection.channel.client.user.id && this.connection.streamConnection) {
      this._applyEvent(this.connection.streamConnection, event, data);
    }

    const watched = this.connection.streamWatchConnection.get(streamKey.userId);
    if (watched) {
      this._applyEvent(watched, event, data, true);
    }
  }

  _applyEvent(connection, event, data, isWatcher = false) {
    switch (event) {
      case 'STREAM_CREATE':
        connection.setSessionId(this.connection.authentication.sessionId);
        connection.serverId = data.rtc_server_id;
        break;
      case 'STREAM_SERVER_UPDATE':
        connection.setTokenAndEndpoint(data.token, data.endpoint);
        break;
      case 'STREAM_DELETE':
        connection.disconnect();
        if (isWatcher) connection.receiver.packets.destroyAllStream();
        break;
      case 'STREAM_UPDATE':
        connection.update(data);
        break;
    }
  }
}

module.exports = StreamEventRouter;
