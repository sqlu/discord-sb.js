'use strict';

const Action = require('./Action');
const { Events } = require('../../util/Constants');

class MessageReactionRemove extends Action {
  handle(data) {
    if (!data.emoji) return false;

    const user = this.getUser(data);
    if (!user) return false;

    const channelData = { id: data.channel_id, user_id: data.user_id };
    if ('guild_id' in data) channelData.guild_id = data.guild_id;
    const channel = this.getChannel(channelData);
    if (!channel || !channel.isText()) return false;

    // Verify message
    const message = this.getMessage(data, channel);
    if (!message) return false;

    // Verify reaction
    const reaction = this.getReaction(data, message, user);
    if (!reaction) return false;
    reaction._remove(user, data.burst);
    /**
     * Emitted whenever a reaction is removed from a cached message.
     * @event Client#messageReactionRemove
     * @param {MessageReaction} messageReaction The reaction object
     * @param {User} user The user whose emoji or reaction emoji was removed
     * @param {MessageReactionEventDetails} details Details of removing the reaction
     */
    this.client.emit(Events.MESSAGE_REACTION_REMOVE, reaction, user, { type: data.type, burst: data.burst });

    return { message, reaction, user };
  }
}

module.exports = MessageReactionRemove;
