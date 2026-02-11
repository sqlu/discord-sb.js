'use strict';

const { Collection } = require('@discordjs/collection');
const Action = require('./Action');
const { deletedMessages } = require('../../structures/Message');
const { Events } = require('../../util/Constants');

class MessageDeleteBulkAction extends Action {
  handle(data) {
    const client = this.client;
    const channel = client.channels.cache.get(data.channel_id);

    if (channel) {
      if (!channel.isText()) return {};

      const ids = data.ids;
      const { cache } = channel.messages;
      const channelId = channel.id;
      const guildId = data.guild_id;
      const messages = new Collection();
      for (const id of ids) {
        const message =
          cache.get(id) ?? this.getMessage({ id, channel_id: channelId, guild_id: guildId }, channel, false);
        if (message) {
          deletedMessages.add(message);
          messages.set(message.id, message);
          cache.delete(id);
        }
      }

      /**
       * Emitted whenever messages are deleted in bulk.
       * @event Client#messageDeleteBulk
       * @param {Collection<Snowflake, Message>} messages The deleted messages, mapped by their id
       */
      if (messages.size > 0) client.emit(Events.MESSAGE_BULK_DELETE, messages);
      return { messages };
    }
    return {};
  }
}

module.exports = MessageDeleteBulkAction;
