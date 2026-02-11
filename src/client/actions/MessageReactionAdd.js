'use strict';

const Action = require('./Action');
const { Events } = require('../../util/Constants');
const { PartialTypes } = require('../../util/Constants');

/*
{ user_id: 'id',
     message_id: 'id',
     emoji: { name: '�', id: null },
     channel_id: 'id',
     burst: boolean
     // If originating from a guild
     guild_id: 'id',
     member: { ..., user: { ... } } }
*/

class MessageReactionAdd extends Action {
  handle(data, fromStructure = false) {
    if (!data.emoji) return false;

    const user = this.getUserFromMember(data);
    if (!user) return false;

    const channelData = { id: data.channel_id, user_id: data.user_id };
    if ('guild_id' in data) channelData.guild_id = data.guild_id;
    const channel = this.getChannel(channelData);
    if (!channel || !channel.isText()) return false;

    // Verify message
    const message = this.getMessage(data, channel);
    if (!message) return false;

    // Verify reaction
    const includePartial = this.client.options.partials.includes(PartialTypes.REACTION);
    if (message.partial && !includePartial) return false;
    const reactionData = {
      emoji: data.emoji,
      count: message.partial ? null : 0,
      me: user.id === this.client.user.id,
    };
    if ('count' in data) reactionData.count = data.count;
    if ('me' in data) reactionData.me = data.me;
    if ('me_burst' in data) reactionData.me_burst = data.me_burst;
    if ('burst_colors' in data) reactionData.burst_colors = data.burst_colors;
    if ('count_details' in data) reactionData.count_details = data.count_details;

    const reaction = message.reactions._add(reactionData);
    if (!reaction) return false;
    reaction._add(user, data.burst);
    if (fromStructure) return { message, reaction, user };
    /**
     * Provides additional information about altered reaction
     * @typedef {Object} MessageReactionEventDetails
     * @property {ReactionType} type The type of the reaction
     * @property {boolean} burst Determines whether a super reaction was used
     */
    /**
     * Emitted whenever a reaction is added to a cached message.
     * @event Client#messageReactionAdd
     * @param {MessageReaction} messageReaction The reaction object
     * @param {User} user The user that applied the guild or reaction emoji
     * @param {MessageReactionEventDetails} details Details of adding the reaction
     */
    this.client.emit(Events.MESSAGE_REACTION_ADD, reaction, user, { type: data.type, burst: data.burst });

    return { message, reaction, user };
  }
}

module.exports = MessageReactionAdd;
