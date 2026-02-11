'use strict';

const Action = require('./Action');
const { Events } = require('../../util/Constants');
const { hasListener } = require('../../util/ListenerUtil');

class MessageReactionRemoveAll extends Action {
  handle(data) {
    const hasReactionListener = hasListener(this.client, Events.MESSAGE_REACTION_REMOVE_ALL);
    const channelData = { id: data.channel_id };
    if ('guild_id' in data) channelData.guild_id = data.guild_id;
    const channel = this.getChannel(channelData);
    if (!channel || !channel.isText()) return false;

    // Verify message
    const message = this.getMessage(data, channel);
    if (!message) return false;

    // Copy removed reactions only when needed for the event payload.
    const removed = hasReactionListener ? message.reactions.cache.clone() : null;

    message.reactions.cache.clear();
    if (hasReactionListener) this.client.emit(Events.MESSAGE_REACTION_REMOVE_ALL, message, removed);

    return { message };
  }
}

/**
 * Emitted whenever all reactions are removed from a cached message.
 * @event Client#messageReactionRemoveAll
 * @param {Message} message The message the reactions were removed from
 * @param {Collection<string|Snowflake, MessageReaction>} reactions The cached message reactions that were removed.
 */

module.exports = MessageReactionRemoveAll;
