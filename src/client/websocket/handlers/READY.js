'use strict';

const { Buffer } = require('node:buffer');
const USER_REQUIRED_ACTION = require('./USER_REQUIRED_ACTION_UPDATE');
const { Opcodes } = require('../../../util/Constants');

let ClientUser;
const MAX_SUBSCRIPTION_PACKET_BYTES = 14 * 1024;
const SUBSCRIPTION_PAYLOAD_PREFIX = `{"op":${Opcodes.GUILD_SUBSCRIPTIONS_BULK},"d":{"subscriptions":{`;
const SUBSCRIPTION_PAYLOAD_SUFFIX = '}}}';
const SUBSCRIPTION_PAYLOAD_BASE_SIZE =
  Buffer.byteLength(SUBSCRIPTION_PAYLOAD_PREFIX) + Buffer.byteLength(SUBSCRIPTION_PAYLOAD_SUFFIX);

const createSubscription = () => ({
  typing: true,
  threads: true,
  activities: true,
  member_updates: true,
  thread_member_lists: [],
  members: [],
  channels: {},
});
const SERIALIZED_SUBSCRIPTION = JSON.stringify(createSubscription());
const SERIALIZED_SUBSCRIPTION_SIZE = Buffer.byteLength(SERIALIZED_SUBSCRIPTION);
const getSubscriptionEntrySize = guildId =>
  Buffer.byteLength(JSON.stringify(guildId)) + 1 + SERIALIZED_SUBSCRIPTION_SIZE;

module.exports = (client, { d: data }, shard) => {
  const buildSubscriptionChunks = guilds => {
    const chunks = [];
    let subscriptions = {};
    let subscriptionCount = 0;
    let payloadSize = SUBSCRIPTION_PAYLOAD_BASE_SIZE;

    for (const guild of guilds) {
      const entrySize = getSubscriptionEntrySize(guild.id);
      const separatorSize = subscriptionCount > 0 ? 1 : 0;

      if (subscriptionCount > 0 && payloadSize + separatorSize + entrySize > MAX_SUBSCRIPTION_PACKET_BYTES) {
        chunks.push(subscriptions);

        subscriptions = {};
        subscriptionCount = 0;
        payloadSize = SUBSCRIPTION_PAYLOAD_BASE_SIZE;
      }

      subscriptions[guild.id] = createSubscription();
      payloadSize += (subscriptionCount > 0 ? 1 : 0) + entrySize;
      subscriptionCount++;

      if (subscriptionCount === 1 && payloadSize > MAX_SUBSCRIPTION_PACKET_BYTES) {
        chunks.push(subscriptions);
        subscriptions = {};
        subscriptionCount = 0;
        payloadSize = SUBSCRIPTION_PAYLOAD_BASE_SIZE;
      }
    }

    if (subscriptionCount > 0) {
      chunks.push(subscriptions);
    }

    return chunks;
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

  const installationId = data.apex_experiments?.installation ?? data.installation;
  if (installationId && typeof client.rest.setInstallationId === 'function') {
    client.rest.setInstallationId(installationId);
  }

  if (data.guilds.length) {
    for (const subscriptions of buildSubscriptionChunks(data.guilds)) {
      shard.send({
        op: Opcodes.GUILD_SUBSCRIPTIONS_BULK,
        d: {
          subscriptions,
        },
      });
    }
  }

  const dmChannels = Array.isArray(data.private_channels) ? data.private_channels : [];
  const { DMChannelVoiceStatusSync } = client.options;

  if (DMChannelVoiceStatusSync >= 1 && dmChannels.length) {
    for (const c of dmChannels) {
      shard.send({
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
