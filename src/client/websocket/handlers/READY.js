'use strict';

const USER_REQUIRED_ACTION = require('./USER_REQUIRED_ACTION_UPDATE');
const { Opcodes } = require('../../../util/Constants');

let ClientUser;

module.exports = (client, { d: data }, shard) => {
  const buildSubscriptions = guilds => {
    const subscriptions = {};
    for (const guild of guilds) {
      subscriptions[guild.id] = {
        typing: true,
        threads: true,
        activities: true,
        member_updates: true,
        thread_member_lists: [],
        members: [],
        channels: {},
      };
    }
    return subscriptions;
  };

  // Check
  USER_REQUIRED_ACTION(client, { d: data });

  // Overwrite ClientPresence
  client.presence.userId = data.user.id;

  if (client.user) {
    client.user._patch(data.user);
  } else {
    ClientUser ??= require('../../../structures/ClientUser');
    client.user = new ClientUser(client, data.user);
    client.users.cache.set(client.user.id, client.user);
  }

  for (const private_channel of data.private_channels) {
    client.channels._add(private_channel);
  }

  for (const guild of data.guilds) {
    guild.shardId = shard.id;
    client.guilds._add(guild);
  }

  // User Notes
  client.notes._reload(data.notes);

  // Relationship
  client.relationships._setup(data.relationships);

  if (Array.isArray(data.relationships)) {
    for (const relation of data.relationships) {
      const user = client.users._add(relation.user);
      if (!user) continue;
      if (relation.type === 1) {
        client.user.friends.set(user.id, user);
      } else if (relation.type === 2) {
        client.user.blocked.set(user.id, user);
      } else if (relation.type === 3) {
        client.user.pending.set(user.id, user);
      } else if (relation.type === 4) {
        client.user.outgoing.set(user.id, user);
      }
    }
  }

  // ClientSetting
  client.settings._patch(data.user_settings);

  // GuildSetting
  for (const gSetting of Array.isArray(data.user_guild_settings) ? data.user_guild_settings : []) {
    const guild = client.guilds.cache.get(gSetting.guild_id);
    if (guild) guild.settings._patch(gSetting);
  }
  // Todo: data.auth_session_id_hash
  client.sessions.currentSessionIdHash = data.auth_session_id_hash;

  if (data.guilds.length) {
    if (data.guilds.length > 80) {
      // Split data bc 15kb
      const data1 = data.guilds.slice(0, Math.floor(data.guilds.length / 2));
      const data2 = data.guilds.slice(Math.floor(data.guilds.length / 2));
      client.ws.broadcast({
        op: Opcodes.GUILD_SUBSCRIPTIONS_BULK,
        d: {
          subscriptions: buildSubscriptions(data1),
        },
      });
      client.ws.broadcast({
        op: Opcodes.GUILD_SUBSCRIPTIONS_BULK,
        d: {
          subscriptions: buildSubscriptions(data2),
        },
      });
    } else {
      client.ws.broadcast({
        op: Opcodes.GUILD_SUBSCRIPTIONS_BULK,
        d: {
          subscriptions: buildSubscriptions(data.guilds),
        },
      });
    }
  }

  const dmChannels = Array.isArray(data.private_channels) ? data.private_channels : [];
  const { DMChannelVoiceStatusSync } = client.options;

  if (DMChannelVoiceStatusSync >= 1 && dmChannels.length) {
    for (const c of dmChannels) {
      client.ws.broadcast({
        op: Opcodes.DM_UPDATE,
        d: {
          channel_id: c.id,
        },
      });
    }

    client.sleep(DMChannelVoiceStatusSync * (dmChannels.length - 1)).then(() => shard.checkReady());
  } else {
    Promise.resolve().then(() => shard.checkReady());
  }
};
