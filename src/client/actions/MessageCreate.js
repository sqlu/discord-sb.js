'use strict';

const process = require('node:process');
const Action = require('./Action');
const { Events } = require('../../util/Constants');
const { hasListener } = require('../../util/ListenerUtil');

let deprecationEmitted = false;

class MessageCreateAction extends Action {
  handle(data) {
    const client = this.client;
    const channelData = { id: data.channel_id, author: data.author };
    if ('guild_id' in data) channelData.guild_id = data.guild_id;
    const channel = this.getChannel(channelData);
    if (channel) {
      if (!channel.isText()) return {};

      const existing = channel.messages.cache.get(data.id);
      if (existing && existing.author?.id !== this.client.user.id) return { message: existing };
      const message = existing ?? channel.messages._add(data);
      channel.lastMessageId = data.id;

      /**
       * Emitted whenever a message is created.
       * @event Client#messageCreate
       * @param {Message} message The created message
       */
      client.emit(Events.MESSAGE_CREATE, message);

      /**
       * Emitted whenever a message is created.
       * @event Client#message
       * @param {Message} message The created message
       * @deprecated Use {@link Client#event:messageCreate} instead
       */
      const hasMessageListener = hasListener(client, 'message');
      if (hasMessageListener && client.emit('message', message) && !deprecationEmitted) {
        deprecationEmitted = true;
        process.emitWarning('The message event is deprecated. Use messageCreate instead', 'DeprecationWarning');
      }

      return { message };
    }

    return {};
  }
}

module.exports = MessageCreateAction;
