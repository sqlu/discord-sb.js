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
    return this.client.channels.cache.find(c => c.type === 'DM' && c.recipient.id === userId) ?? null;
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

    const profilePromise = this.client.api
      .users(id)
      .profile.get({
        query: {
          with_mutual_guilds: true,
          with_mutual_friends: true,
          with_mutual_friends_count: true,
        },
      })
      .catch(() => null);

    const data = await this.client.api.users(id).get();
    const profile = await profilePromise;
    if (profile?.user_profile) {
      data.bio = profile.user_profile.bio ?? null;
      if (typeof profile.user_profile.pronouns !== 'undefined') data.pronouns = profile.user_profile.pronouns;
      if (typeof profile.user_profile.banner !== 'undefined' && typeof data.banner === 'undefined') {
        data.banner = profile.user_profile.banner;
      }
      if (typeof profile.user_profile.accent_color !== 'undefined' && typeof data.accent_color === 'undefined') {
        data.accent_color = profile.user_profile.accent_color;
      }
    }
    if (profile) {
      data.premiumSince = profile.premium_since ?? null;
      data.premiumGuildSince = profile.premium_guild_since ?? null;
      if (typeof profile.premium_type !== 'undefined') data.premiumType = profile.premium_type;
      data.connectedAccounts = Array.isArray(profile.connected_accounts)
        ? profile.connected_accounts.filter(ca => ALLOWED_CONNECTED_ACCOUNT_TYPES.has(ca?.type))
        : null;
      if (typeof profile.legacy_username !== 'undefined') data.legacyUsername = profile.legacy_username;
      else if (typeof profile.user?.legacy_username !== 'undefined') data.legacyUsername = profile.user.legacy_username;
      if (typeof profile.user?.premium_type !== 'undefined' && typeof data.premiumType === 'undefined') {
        data.premiumType = profile.user.premium_type;
      }
    }
    if (typeof data.premium_type !== 'undefined' && typeof data.premiumType === 'undefined') {
      data.premiumType = data.premium_type;
    }
    data.mutualFriendsCount = profile?.mutual_friends_count ?? null;
    data.mutualGuilds = profile?.mutual_guilds ?? null;
    data.mutualGuildsCount = Array.isArray(data.mutualGuilds) ? data.mutualGuilds.length : null;
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
}

module.exports = UserManager;
