'use strict';

const CachedManager = require('./CachedManager');
const { Error } = require('../errors');
const { GuildMember } = require('../structures/GuildMember');
const { Message } = require('../structures/Message');
const ThreadMember = require('../structures/ThreadMember');
const User = require('../structures/User');

const ALLOWED_CONNECTED_ACCOUNT_TYPES = new Set([
  'spotify',
  'twitter',
  'x',
  'github',
  'youtube',
  'twitch',
  'steam',
  'reddit',
  'facebook',
  'roblox',
  'tiktok',
  'domain',
  'bluesky',
  'amazonmusic',
  'battlenet',
  'bungeenet',
  'crunchyroll',
  'ebay',
  'epicgames',
  'lol',
  'paypal',
  'playstation',
  'riotgames',
  'xbox',
]);

/**
 * Manages API methods for users and stores their cache.
 * @extends {CachedManager}
 */
class UserManager extends CachedManager {
  constructor(client, iterable) {
    super(client, User, iterable);
  }

  /**
   * The cache of this manager
   * @type {Collection<Snowflake, User>}
   * @name UserManager#cache
   */

  /**
   * Data that resolves to give a User object. This can be:
   * * A User object
   * * A Snowflake
   * * A Message object (resolves to the message author)
   * * A GuildMember object
   * * A ThreadMember object
   * @typedef {User|Snowflake|Message|GuildMember|ThreadMember} UserResolvable
   */

  /**
   * The DM between the client's user and a user
   * @param {Snowflake} userId The user id
   * @returns {?DMChannel}
   * @private
   */
  dmChannel(userId) {
    return this.client.channels.cache.find(c => c.type === 'DM' && c.recipient?.id === userId) ?? null;
  }

  /**
   * Creates a {@link DMChannel} between the client and a user.
   * @param {UserResolvable} user The UserResolvable to identify
   * @param {BaseFetchOptions} [options] Additional options for this fetch
   * @returns {Promise<DMChannel>}
   */
  async createDM(user, { cache = true, force = false } = {}) {
    const id = this.resolveId(user);

    if (!force) {
      const dmChannel = this.dmChannel(id);
      if (dmChannel && !dmChannel.partial) return dmChannel;
    }

    const data = await this.client.api.users['@me'].channels.post({
      data: {
        recipients: [id],
      },
      DiscordContext: {},
    });

    const dm_channel = await this.client.channels._add(data, null, { cache });
    dm_channel.sync();
    return dm_channel;
  }

  /**
   * Deletes a {@link DMChannel} (if one exists) between the client and a user. Resolves with the channel if successful.
   * @param {UserResolvable} user The UserResolvable to identify
   * @returns {Promise<DMChannel>}
   */
  async deleteDM(user) {
    const id = this.resolveId(user);
    const dmChannel = this.dmChannel(id);
    if (!dmChannel) throw new Error('USER_NO_DM_CHANNEL');
    await this.client.api.channels(dmChannel.id).delete();
    this.client.channels._remove(dmChannel.id);
    return dmChannel;
  }

  /**
   * Obtains a user from Discord, or the user cache if it's already available.
   * @param {UserResolvable} user The user to fetch
   * @param {BaseFetchOptions} [options] Additional options for this fetch
   * @returns {Promise<User>}
   */
  async fetch(user, { cache = true, force = false } = {}) {
    const id = this.resolveId(user);
    if (!force) {
      const existing = this.cache.get(id);
      if (existing && !existing.partial && typeof existing.bio !== 'undefined') return existing;
    }

    const profile = await this.client.api.users(id).profile.get({
      query: {
        with_mutual_guilds: true,
        with_mutual_friends: true,
        with_mutual_friends_count: true,
      },
    });

    const data = this._buildUserDataFromProfile(profile, id);
    return this._add(data, cache);
  }

  /**
   * Sends a message to a user.
   * @param {UserResolvable} user The UserResolvable to identify
   * @param {string|MessagePayload|MessageOptions} options The options to provide
   * @returns {Promise<Message>}
   */
  async send(user, options) {
    return (await this.createDM(user)).send(options);
  }

  /**
   * Resolves a {@link UserResolvable} to a {@link User} object.
   * @param {UserResolvable} user The UserResolvable to identify
   * @returns {?User}
   */
  resolve(user) {
    if (user instanceof GuildMember || user instanceof ThreadMember) return user.user;
    if (user instanceof Message) return user.author;
    return super.resolve(user);
  }

  /**
   * Resolves a {@link UserResolvable} to a {@link User} id.
   * @param {UserResolvable} user The UserResolvable to identify
   * @returns {?Snowflake}
   */
  resolveId(user) {
    if (user instanceof ThreadMember) return user.id;
    if (user instanceof GuildMember) return user.user.id;
    if (user instanceof Message) return user.author.id;
    return super.resolveId(user);
  }

  /**
   * Counts the number of group DMs that include both the client user and the target user.
   * @param {Snowflake} userId // pas uhq
   * @returns {?number}
   * @private
   */
  _getMutualGroups(userId) {
    const meId = this.client.user?.id;
    if (!meId || !userId) return null;

    const results = [];
    for (const channel of this.client.channels.cache.values()) {
      if (channel?.type !== 'GROUP_DM') continue;

      const baseRecipients = (channel._recipients ?? []).filter(r => r?.id);
      const recipientIds = new Set(baseRecipients.map(r => r.id));
      recipientIds.add(meId);

      if (!recipientIds.has(userId)) continue;

      results.push(channel);
    }

    return results;
  }

  /**
   * Flattens a profile response into the User shape while keeping nullability explicit.
   * @param {Object} profile The profile payload from the API
   * @param {Snowflake} userId The user id for mutual calculations
   * @returns {Object}
   * @private
   */
  _buildUserDataFromProfile(profile, userId) {
    if (!profile?.user) throw new Error('USER_PROFILE_MISSING');

    const data = { ...profile.user };
    const userProfile = profile.user_profile ?? {};
    const profileUser = profile.user ?? {};

    const assignNullable = (source, key, targetKey = key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        data[targetKey] = source[key] ?? null;
      }
    };

    assignNullable(userProfile, 'bio');
    assignNullable(userProfile, 'pronouns');

    if (typeof userProfile.banner !== 'undefined' && typeof data.banner === 'undefined') {
      data.banner = userProfile.banner;
    }
    if (typeof userProfile.accent_color !== 'undefined' && typeof data.accent_color === 'undefined') {
      data.accent_color = userProfile.accent_color;
    }

    data.premiumSince = profile.premium_since ?? null;
    data.premiumGuildSince = profile.premium_guild_since ?? null;
    assignNullable(profile, 'premium_type', 'premiumType');
    assignNullable(profileUser, 'premium_type', 'premiumType');
    if (typeof data.premium_type !== 'undefined' && typeof data.premiumType === 'undefined') {
      data.premiumType = data.premium_type;
    }
    if (Array.isArray(profile.badges)) {
      const premiumBadge = profile.badges.find(badge => badge?.id === 'premium');
      if (premiumBadge) {
        data.premiumBadge = {
          id: 'premium',
          asset: premiumBadge.asset ?? premiumBadge.icon ?? premiumBadge.icon_hash ?? null,
          description: premiumBadge.description ?? null,
        };
      } else {
        data.premiumBadge = null;
      }
    } else {
      data.premiumBadge = null;
    }

    if (Array.isArray(profile.connected_accounts)) {
      data.connectedAccounts = profile.connected_accounts.filter(ca => ALLOWED_CONNECTED_ACCOUNT_TYPES.has(ca?.type));
    } else {
      data.connectedAccounts = null;
    }

    if (typeof profile.legacy_username !== 'undefined') {
      data.legacyUsername = profile.legacy_username;
    } else if (typeof profileUser.legacy_username !== 'undefined') {
      data.legacyUsername = profileUser.legacy_username;
    } else {
      data.legacyUsername ??= null;
    }

    data.mutualFriendsCount = profile?.mutual_friends_count ?? null;
    data.mutualGuilds = profile?.mutual_guilds ?? null;
    data.mutualGuildsCount = Array.isArray(data.mutualGuilds) ? data.mutualGuilds.length : null;

    const mutualGroups = this._getMutualGroups(userId);
    data.mutualGroups = mutualGroups ?? null;
    data.mutualGroupsCount = mutualGroups?.length ?? null;

    return data;
  }
}

module.exports = UserManager;
