'use strict';

const Action = require('./Action');
const { deletedMessages } = require('../../structures/Message');
const { Events } = require('../../util/Constants');

class MessageDeleteAction extends Action {
  handle(data) {
    const client = this.client;
    const channelData = { id: data.channel_id };
    if ('guild_id' in data) channelData.guild_id = data.guild_id;
    const channel = this.getChannel(channelData);
    let message;
    if (channel) {
      if (!channel.isText()) return {};

      message = this.getMessage(data, channel);
      if (message) {
        channel.messages.cache.delete(message.id);
        deletedMessages.add(message);
        /**
         * Emitted whenever a message is deleted.
         * @event Client#messageDelete
         * @param {Message} message The deleted message
         */
        client.emit(Events.MESSAGE_DELETE, message);
      }
    }

    return { message };
  }
}

module.exports = MessageDeleteAction;
