'use strict';

const { PartialTypes } = require('../../util/Constants');

/*

ABOUT ACTIONS

Actions are similar to WebSocket Packet Handlers, but since introducing
the REST API methods, in order to prevent rewriting code to handle data,
"actions" have been introduced. They're basically what Packet Handlers
used to be but they're strictly for manipulating data and making sure
that WebSocket events don't clash with REST methods.

*/

class GenericAction {
  constructor(client) {
    this.client = client;
    this._partials = new Set(client.options.partials);
  }

  handle(data) {
    return data;
  }

  getPayload(data, manager, id, partialType, cache) {
    const existing = manager.cache.get(id);
    if (!existing && this._partials.has(partialType)) {
      return manager._add(data, cache);
    }
    return existing;
  }

  getChannel(data) {
    const injected = data[this.client.actions.injectedChannel];
    if (injected) return injected;

    const id = data.channel_id ?? data.id;
    const existing = this.client.channels.cache.get(id);
    if (existing) return existing;

    let recipients;
    if (!('recipients' in data) && this.client.user) {
      // Try to resolve the recipient, but do not add the client user.
      const recipient = data.author ?? data.user ?? { id: data.user_id };
      if (recipient.id !== this.client.user.id) recipients = [recipient];
    }

    if (id === data.id && !recipients) {
      return this.getPayload(data, this.client.channels, id, PartialTypes.CHANNEL);
    }

    const payload = { ...data, id };
    if (recipients) payload.recipients = recipients;

    return this.getPayload(payload, this.client.channels, id, PartialTypes.CHANNEL);
  }

  getMessage(data, channel, cache) {
    const injected = data[this.client.actions.injectedMessage];
    if (injected) return injected;

    const id = data.message_id ?? data.id;
    const existing = channel.messages.cache.get(id);
    if (existing) return existing;

    return this.getPayload(
      {
        id,
        channel_id: channel.id,
        guild_id: data.guild_id ?? channel.guild?.id,
      },
      channel.messages,
      id,
      PartialTypes.MESSAGE,
      cache,
    );
  }

  getReaction(data, message, user) {
    const id = data.emoji.id ?? decodeURIComponent(data.emoji.name);
    return this.getPayload(
      {
        emoji: data.emoji,
        count: message.partial ? null : 0,
        me: user?.id === this.client.user.id,
      },
      message.reactions,
      id,
      PartialTypes.REACTION,
    );
  }

  getMember(data, guild) {
    return this.getPayload(data, guild.members, data.user.id, PartialTypes.GUILD_MEMBER);
  }

  getUser(data) {
    const injected = data[this.client.actions.injectedUser];
    if (injected) return injected;

    const id = data.user_id;
    const existing = this.client.users.cache.get(id);
    if (existing) return existing;

    return this.getPayload({ id }, this.client.users, id, PartialTypes.USER);
  }

  getUserFromMember(data) {
    if (data.guild_id && data.member?.user) {
      const guild = this.client.guilds.cache.get(data.guild_id);
      if (guild) {
        return guild.members._add(data.member).user;
      } else {
        return this.client.users._add(data.member.user);
      }
    }
    return this.getUser(data);
  }

  getScheduledEvent(data, guild) {
    const id = data.guild_scheduled_event_id ?? data.id;
    return this.getPayload(
      { id, guild_id: data.guild_id ?? guild.id },
      guild.scheduledEvents,
      id,
      PartialTypes.GUILD_SCHEDULED_EVENT,
    );
  }
}

module.exports = GenericAction;
