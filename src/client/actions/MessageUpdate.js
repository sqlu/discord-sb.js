'use strict';

const Action = require('./Action');

class MessageUpdateAction extends Action {
  handle(data) {
    const channelData = { id: data.channel_id };
    if ('guild_id' in data) channelData.guild_id = data.guild_id;
    const channel = this.getChannel(channelData);
    if (channel) {
      if (!channel.isText()) return {};

      const { id, channel_id, guild_id, author, timestamp, type } = data;
      const message = this.getMessage({ id, channel_id, guild_id, author, timestamp, type }, channel);
      if (message) {
        const old = message._update(data);
        return {
          old,
          updated: message,
        };
      }
    }

    return {};
  }
}

module.exports = MessageUpdateAction;
