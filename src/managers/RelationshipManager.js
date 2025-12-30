'use strict';

const { Collection } = require('@discordjs/collection');
const BaseManager = require('./BaseManager');
const { GuildMember } = require('../structures/GuildMember');
const { Message } = require('../structures/Message');
const ThreadMember = require('../structures/ThreadMember');
const User = require('../structures/User');
const { RelationshipTypes } = require('../util/Constants');

/**
 * Manages API methods for Relationships and stores their cache.
 */
class RelationshipManager extends BaseManager {
  constructor(client, users) {
    super(client);
    this._friendCache = new Collection();
    this._blockedCache = new Collection();
    this._incomingCache = new Collection();
    this._outgoingCache = new Collection();
    /**
     * A collection of users this manager is caching. (Type: Number)
     * @type {Collection<Snowflake, RelationshipType>}
     */
    this.cache = new Collection();
    /**
     * @type {Collection<Snowflake, string>}
     */
    this.friendNicknames = new Collection();
    /**
     * @type {Collection<Snowflake, Date>}
     */
    this.sinceCache = new Collection();
    this._setup(users);
  }

  /**
   * Get all friends
   * @type {Collection<Snowflake, User>}
   * @readonly
   */
  get friendCache() {
    return this._friendCache;
  }

  /**
   * Get all blocked users
   * @type {Collection<Snowflake, User>}
   * @readonly
   */
  get blockedCache() {
    return this._blockedCache;
  }

  /**
   * Get all incoming friend requests
   * @type {Collection<Snowflake, User>}
   * @readonly
   */
  get incomingCache() {
    return this._incomingCache;
  }

  /**
   * Get all outgoing friend requests
   * @type {Collection<Snowflake, User>}
   * @readonly
   */
  get outgoingCache() {
    return this._outgoingCache;
  }

  /**
   * @typedef {Object} RelationshipJSONData
   * @property {Snowflake} id The ID of the target user
   * @property {RelationshipType} type The type of relationship
   * @property {string | null} nickname The nickname of the user in this relationship (1-32 characters)
   * @property {string} since When the user requested a relationship (ISO8601 timestamp)
   */

  /**
   * Return array of cache
   * @returns {RelationshipJSONData[]}
   */
  toJSON() {
    return this.cache.map((value, key) => ({
      id: key,
      type: RelationshipTypes[value],
      nickname: this.friendNicknames.get(key),
      since: this.sinceCache.get(key).toISOString(),
    }));
  }

  /**
   * @private
   * @param {Array<User>} users An array of users to add to the cache
   * @returns {void}
   */
  _setup(users) {
    if (!Array.isArray(users)) return;
    // Reset caches so full fetches don't leave stale relationships behind
    this.cache.clear();
    this.friendNicknames.clear();
    this.sinceCache.clear();
    this._friendCache.clear();
    this._blockedCache.clear();
    this._incomingCache.clear();
    this._outgoingCache.clear();
    for (const relationShip of users) {
      if (relationShip.user) this.client.users._add(relationShip.user);
      this.friendNicknames.set(relationShip.id, relationShip.nickname);
      this.cache.set(relationShip.id, relationShip.type);
      this.sinceCache.set(relationShip.id, new Date(relationShip.since || 0));
      this._updateRelationshipCaches(relationShip.id, relationShip.type);
    }
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
    if (user instanceof User) return user.id;
    if (typeof user === 'string') return user.match(/\d{17,19}/)?.[0] || null;
    return null;
  }

  /**
   * Resolves a {@link UserResolvable} to a {@link User} username.
   * @param {UserResolvable} user The UserResolvable to identify
   * @returns {?string}
   */
  resolveUsername(user) {
    if (user instanceof ThreadMember) return user.member.user.username;
    if (user instanceof GuildMember) return user.user.username;
    if (user instanceof Message) return user.author.username;
    if (user instanceof User) return user.username;
    return user;
  }

  /**
   * Obtains a user from Discord, or the user cache if it's already available.
   * @param {UserResolvable} [user] The user to fetch
   * @param {BaseFetchOptions} [options] Additional options for this fetch
   * @returns {Promise<RelationshipType|RelationshipManager>}
   */
  async fetch(user, { force = false } = {}) {
    if (user) {
      const id = this.resolveId(user);
      if (!force) {
        const existing = this.cache.get(id);
        if (existing && !existing.partial) return existing;
      }
      // Try incremental hydrate: if user already cached, avoid full sync
      if (this.cache.has(id)) return this.cache.get(id);
      const data = await this.client.api.users['@me']
        .relationships(id)
        .get()
        .catch(() => null);
      if (data) {
        const type = data.type ?? RelationshipTypes.NONE;
        this.cache.set(id, type);
        this.friendNicknames.set(id, data.nickname);
        this.sinceCache.set(id, new Date(data.since || 0));
        this._updateRelationshipCaches(id, type);
        if (data.user) this.client.users._add(data.user);
        return type;
      }
      // Fallback: full refresh
      const list = await this.client.api.users['@me'].relationships.get();
      this._setup(list);
      return this.cache.get(id) ?? null;
    } else {
      const data = await this.client.api.users['@me'].relationships.get();
      this._setup(data);
      return this;
    }
  }

  /**
   * Refreshes the relationship caches from the API.
   * @returns {Promise<RelationshipManager>}
   */
  async refreshCache() {
    const data = await this.client.api.users['@me'].relationships.get();
    this._setup(data);
    return this;
  }

  /**
   * Deletes a friend / blocked relationship with a client user or cancels a friend request.
   * @param {UserResolvable} user Target
   * @returns {Promise<boolean>}
   */
  async deleteRelationship(user) {
    const id = this.resolveId(user);
    if (!id) return false;
    if (
      ![
        RelationshipTypes.FRIEND,
        RelationshipTypes.BLOCKED,
        RelationshipTypes.PENDING_OUTGOING,
        RelationshipTypes.PENDING_INCOMING,
      ].includes(this.cache.get(id))
    ) {
      return Promise.resolve(false);
    }
    await this.client.api.users['@me'].relationships[id].delete({
      DiscordContext: { location: 'ContextMenu' },
    });
    this.cache.delete(id);
    this.friendNicknames.delete(id);
    this.sinceCache.delete(id);
    this._updateRelationshipCaches(id, RelationshipTypes.NONE);
    return true;
  }

  /**
   * Sends a friend request.
   * @param {UserResolvable} options Target (User Object, Username, User Id)
   * @returns {Promise<boolean>}
   */
  async sendFriendRequest(options) {
    const id = this.resolveId(options);
    if (id) {
      if ([RelationshipTypes.FRIEND, RelationshipTypes.PENDING_OUTGOING].includes(this.cache.get(id))) {
        return Promise.resolve(false);
      }
      await this.client.api.users['@me'].relationships[id].put({
        data: {},
        DiscordContext: { location: 'ContextMenu' },
      });
      this.cache.set(id, RelationshipTypes.PENDING_OUTGOING);
      this.sinceCache.set(id, new Date());
      this._updateRelationshipCaches(id, RelationshipTypes.PENDING_OUTGOING);
    } else {
      const username = this.resolveUsername(options);
      if (typeof username !== 'string') return false;
      await this.client.api.users['@me'].relationships.post({
        versioned: true,
        data: {
          username,
          discriminator: null,
        },
        DiscordContext: { location: 'Add Friend' },
      });
    }
    return true;
  }

  /**
   * Accepts a friend request.
   * @param {UserResolvable} user The user to add as a friend
   * @returns {Promise<boolean>}
   */
  async addFriend(user) {
    const id = this.resolveId(user);
    if (!id) return false;
    // Check if already friends
    if (this.cache.get(id) === RelationshipTypes.FRIEND) return Promise.resolve(false);
    // Check if outgoing request
    if (this.cache.get(id) === RelationshipTypes.PENDING_OUTGOING) return Promise.resolve(false);
    await this.client.api.users['@me'].relationships[id].put({
      data: { confirm_stranger_request: true },
      DiscordContext: { location: 'Friends' },
    });
    this.cache.set(id, RelationshipTypes.FRIEND);
    this.sinceCache.set(id, new Date());
    this._updateRelationshipCaches(id, RelationshipTypes.FRIEND);
    return true;
  }

  /**
   * Changes the nickname of a friend.
   * @param {UserResolvable} user The user to change the nickname
   * @param {?string} nickname New nickname
   * @returns {Promise<boolean>}
   */
  async setNickname(user, nickname = null) {
    const id = this.resolveId(user);
    if (this.cache.get(id) !== RelationshipTypes.FRIEND) return Promise.resolve(false);
    await this.client.api.users['@me'].relationships[id].patch({
      data: {
        nickname: typeof nickname === 'string' ? nickname : null,
      },
    });
    if (nickname) {
      this.friendNicknames.set(id, nickname);
    } else {
      this.friendNicknames.delete(id);
    }
    return true;
  }

  /**
   * Blocks a user.
   * @param {UserResolvable} user User to block
   * @returns {Promise<boolean>}
   */
  async addBlocked(user) {
    const id = this.resolveId(user);
    if (!id) return false;
    // Check
    if (this.cache.get(id) === RelationshipTypes.BLOCKED) return Promise.resolve(false);
    await this.client.api.users['@me'].relationships[id].put({
      data: {
        type: RelationshipTypes.BLOCKED,
      },
      DiscordContext: { location: 'ContextMenu' },
    });
    this.cache.set(id, RelationshipTypes.BLOCKED);
    this.friendNicknames.delete(id);
    this.sinceCache.set(id, new Date());
    this._updateRelationshipCaches(id, RelationshipTypes.BLOCKED);
    return true;
  }

  _updateRelationshipCaches(id, type) {
    this._friendCache.delete(id);
    this._blockedCache.delete(id);
    this._incomingCache.delete(id);
    this._outgoingCache.delete(id);
    const user = this.client.users.cache.get(id);
    if (!user) return;
    if (type === RelationshipTypes.FRIEND) {
      this._friendCache.set(id, user);
    } else if (type === RelationshipTypes.BLOCKED) {
      this._blockedCache.set(id, user);
    } else if (type === RelationshipTypes.PENDING_INCOMING) {
      this._incomingCache.set(id, user);
    } else if (type === RelationshipTypes.PENDING_OUTGOING) {
      this._outgoingCache.set(id, user);
    }
  }
}

module.exports = RelationshipManager;
