'use strict';

const Base = require('./Base');
const VoiceState = require('./VoiceState');
const TextBasedChannel = require('./interfaces/TextBasedChannel');
const { Error } = require('../errors');
const { RelationshipTypes } = require('../util/Constants');
const SnowflakeUtil = require('../util/SnowflakeUtil');
const UserFlags = require('../util/UserFlags');
const Util = require('../util/Util');

const nousdeux = 24 * 60 * 60 * 1000;
const ondoitfaireunebalade = 30 * nousdeux;
const laluneestbelle = Object.freeze({
  0: 'None',
  1: 'Nitro Classic',
  2: 'Nitro',
  3: 'Nitro Basic',
});
const tumeplais = Object.freeze([
  Object.freeze({ months: 1, badgeName: 'Bronze', assetId: 'premium_tenure_1_month' }),
  Object.freeze({ months: 3, badgeName: 'Silver', assetId: 'premium_tenure_3_month' }),
  Object.freeze({ months: 6, badgeName: 'Gold', assetId: 'premium_tenure_6_month' }),
  Object.freeze({ months: 12, badgeName: 'Platinum', assetId: 'premium_tenure_12_month' }),
  Object.freeze({ months: 24, badgeName: 'Diamond', assetId: 'premium_tenure_24_month' }),
  Object.freeze({ months: 36, badgeName: 'Emerald', assetId: 'premium_tenure_36_month' }),
  Object.freeze({ months: 60, badgeName: 'Ruby', assetId: 'premium_tenure_60_month' }),
  Object.freeze({ months: 72, badgeName: 'Opal / Fire', assetId: 'premium_tenure_72_month' }),
]);

/**
 * @typedef {'None'|'Nitro Classic'|'Nitro'|'Nitro Basic'} NitroTypeName
 */

/**
 * @typedef {Object} PremiumBadge
 * @property {'premium'} id Premium badge id from the profile endpoint
 * @property {?string} asset Premium badge asset hash
 * @property {?string} description Premium badge description from the profile endpoint
 */

/**
 * @typedef {Object} NitroTenureMilestone
 * @property {number} months Milestone month threshold
 * @property {string} badgeName Human-readable badge tier name
 * @property {string} assetId Asset reference id for the milestone
 */

/**
 * @typedef {Object} NitroTenureInfo
 * @property {?number} nitroType Raw premium type id
 * @property {NitroTypeName} nitroName Nitro plan label
 * @property {boolean} isEvolving Whether tenure progression is active
 * @property {?number} currentTenureMonths Current elapsed tenure in 30-day months
 * @property {?number} currentBadgeMilestone Current reached milestone in months
 * @property {?NitroTenureMilestone} currentBadge Current reached milestone details
 * @property {?number} nextBadgeMilestone Next milestone in months
 * @property {?NitroTenureMilestone} nextBadge Next milestone details
 * @property {?number} daysUntilNextBadge Days until next milestone
 */

function revienssteplait(user, now = Date.now()) {
  const rawPremiumType = user.premiumType;
  const premiumType = rawPremiumType ?? 0;
  const nitroName = laluneestbelle[premiumType] ?? 'None';
  const hasValidPremiumSince = Number.isFinite(user.premiumSinceTimestamp);
  const isEvolving = premiumType === 2 && hasValidPremiumSince;

  const base = {
    nitroType: rawPremiumType ?? null,
    nitroName,
    isEvolving,
    currentTenureMonths: null,
    currentBadgeMilestone: null,
    currentBadge: null,
    nextBadgeMilestone: null,
    nextBadge: null,
    daysUntilNextBadge: null,
  };

  if (!isEvolving) return base;

  const elapsedMs = now - user.premiumSinceTimestamp;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return base;

  const currentTenureMonths = Math.floor(elapsedMs / ondoitfaireunebalade);
  const currentBadge = [...tumeplais].reverse().find(milestone => milestone.months <= currentTenureMonths) ?? null;
  const nextBadge = tumeplais.find(milestone => milestone.months > currentTenureMonths) ?? null;

  let daysUntilNextBadge = null;
  if (nextBadge) {
    const remainingMs = Math.max(0, nextBadge.months * ondoitfaireunebalade - elapsedMs);
    daysUntilNextBadge = Math.ceil(remainingMs / nousdeux);
  }

  base.currentTenureMonths = currentTenureMonths;
  base.currentBadgeMilestone = currentBadge?.months ?? null;
  base.currentBadge = currentBadge;
  base.nextBadgeMilestone = nextBadge?.months ?? null;
  base.nextBadge = nextBadge;
  base.daysUntilNextBadge = daysUntilNextBadge;

  return base;
}

/**
 * Represents a user on Discord.
 * @implements {TextBasedChannel}
 * @extends {Base}
 */
class User extends Base {
  constructor(client, data) {
    super(client);

    /**
     * The user's id
     * @type {Snowflake}
     */
    this.id = data.id;

    this.bot = null;

    this.system = null;

    this.flags = null;

    this.premiumSinceTimestamp = null;

    this.premiumGuildSinceTimestamp = null;

    this.premiumType = null;

    this.premiumBadge = null;

    this.legacyUsername = null;

    this.connectedAccounts = null;

    this.mutualGroups = null;

    this.mutualGroupsCount = null;

    this.mutualFriendsCount = null;

    this.mutualGuilds = null;

    this.mutualGuildsCount = null;

    this._patch(data);
  }

  _patch(data) {
    if ('username' in data) {
      /**
       * The username of the user
       * @type {?string}
       */
      this.username = data.username;
    } else {
      this.username ??= null;
    }

    if ('global_name' in data) {
      /**
       * The global name of this user
       * @type {?string}
       */
      this.globalName = data.global_name;
    } else {
      this.globalName ??= null;
    }

    if ('bot' in data) {
      /**
       * Whether or not the user is a bot
       * @type {?boolean}
       */
      this.bot = Boolean(data.bot);
    } else if (!this.partial && typeof this.bot !== 'boolean') {
      this.bot = false;
    }

    if ('discriminator' in data) {
      /**
       * The discriminator of this user
       * <info>`'0'`, or a 4-digit stringified number if they're using the legacy username system</info>
       * @type {?string}
       * @deprecated The discriminator is no longer used by Discord. Use `username` or `displayName` instead.
       */
      this.discriminator = data.discriminator;
    } else {
      this.discriminator ??= null;
    }

    if ('avatar' in data) {
      /**
       * The user avatar's hash
       * @type {?string}
       */
      this.avatar = data.avatar;
    } else {
      this.avatar ??= null;
    }

    if ('banner' in data) {
      /**
       * The user banner's hash
       * <info>The user must be force fetched for this property to be present or be updated</info>
       * @type {?string}
       */
      this.banner = data.banner;
    } else if (this.banner !== null) {
      this.banner ??= undefined;
    }

    if ('banner_color' in data) {
      /**
       * The user banner's hex
       * <info>The user must be force fetched for this property to be present or be updated</info>
       * @type {?string}
       */
      this.bannerColor = data.banner_color;
    } else if (this.bannerColor !== null) {
      this.bannerColor ??= undefined;
    }

    if ('accent_color' in data) {
      /**
       * The base 10 accent color of the user's banner
       * <info>The user must be force fetched for this property to be present or be updated</info>
       * @type {?number}
       */
      this.accentColor = data.accent_color;
    } else if (this.accentColor !== null) {
      this.accentColor ??= undefined;
    }

    if ('bio' in data) {
      /**
       * The user's bio
       * <info>The user must be force fetched for this property to be present or be updated</info>
       * @type {?string}
       */
      this.bio = data.bio;
    }

    if ('pronouns' in data) {
      /**
       * The user's pronouns
       * <info>The user must be force fetched for this property to be present or be updated</info>
       * @type {?string}
       */
      this.pronouns = data.pronouns;
    }

    const premiumSince = 'premium_since' in data ? data.premium_since : data.premiumSince;
    if (typeof premiumSince !== 'undefined') {
      /**
       * Timestamp the user started boosting Nitro
       * @type {?number}
       */
      this.premiumSinceTimestamp = premiumSince ? new Date(premiumSince).getTime() : null;
    } else {
      this.premiumSinceTimestamp ??= null;
    }

    const premiumGuildSince = 'premium_guild_since' in data ? data.premium_guild_since : data.premiumGuildSince;
    if (typeof premiumGuildSince !== 'undefined') {
      /**
       * Timestamp the user started boosting the mutual guild (if provided)
       * @type {?number}
       */
      this.premiumGuildSinceTimestamp = premiumGuildSince ? new Date(premiumGuildSince).getTime() : null;
    } else {
      this.premiumGuildSinceTimestamp ??= null;
    }

    if ('premium_type' in data) {
      /**
       * Premium type level for this user
       * @type {?number}
       */
      this.premiumType = data.premium_type ?? null;
    } else if ('premiumType' in data) {
      this.premiumType = data.premiumType ?? null;
    } else {
      this.premiumType ??= null;
    }

    if ('premium_badge' in data) {
      /**
       * Premium badge metadata from profile badges
       * @type {?PremiumBadge}
       */
      this.premiumBadge = data.premium_badge ?? null;
    } else if ('premiumBadge' in data) {
      this.premiumBadge = data.premiumBadge ?? null;
    } else {
      this.premiumBadge ??= null;
    }

    if ('legacy_username' in data) {
      /**
       * Legacy username (pre-unique username migration)
       * @type {?string}
       */
      this.legacyUsername = data.legacy_username ?? null;
    } else if ('legacyUsername' in data) {
      this.legacyUsername = data.legacyUsername ?? null;
    } else {
      this.legacyUsername ??= null;
    }

    /**
     * @typedef {Object} ConnectedAccount
     * @property {string} id The id of the connected account
     * @property {string} name The name of the connected account
     * @property {string} type The type of the connected account (ex: spotify, twitter, ...)
     * @property {?boolean} [verified] Whether the connection is verified
     * @property {?number} [visibility] Visibility of the connection
     */

    if ('connected_accounts' in data) {
      /**
       * Connected accounts for this user
       * @type {?ConnectedAccount[]}
       */
      this.connectedAccounts = data.connected_accounts ?? null;
    } else if ('connectedAccounts' in data) {
      this.connectedAccounts = data.connectedAccounts ?? null;
    } else {
      this.connectedAccounts ??= null;
    }

    /**
     * @typedef {Object} MutualGuild
     * @property {Snowflake} id The id of the mutual guild
     * @property {?string} nick The nickname of the user in the mutual guild
     */

    if ('mutualGuilds' in data) {
      /**
       * The guilds that this user shares with the client user
       * @type {?MutualGuild[]}
       */
      this.mutualGuilds = data.mutualGuilds ?? null;
    } else {
      this.mutualGuilds ??= null;
    }

    if ('mutualGuildsCount' in data) {
      /**
       * The number of guilds that this user shares with the client user
       * @type {?number}
       */
      this.mutualGuildsCount = data.mutualGuildsCount;
    } else if (this.mutualGuildsCount == null && Array.isArray(this.mutualGuilds)) {
      this.mutualGuildsCount = this.mutualGuilds.length;
    } else {
      this.mutualGuildsCount ??= null;
    }

    if ('mutualGroups' in data) {
      /**
       * The group DMs this user shares with the client user
       * @type {?GroupDMChannel[]}
       */
      this.mutualGroups = data.mutualGroups ?? null;
    } else {
      this.mutualGroups ??= null;
    }

    if ('mutualGroupsCount' in data) {
      /**
       * The number of group DMs this user shares with the client user
       * @type {?number}
       */
      this.mutualGroupsCount = data.mutualGroupsCount;
    } else {
      this.mutualGroupsCount ??= null;
    }

    if ('mutualFriendsCount' in data) {
      /**
       * The number of friends that this user shares with the client user
       * @type {?number}
       */
      this.mutualFriendsCount = data.mutualFriendsCount;
    } else {
      this.mutualFriendsCount ??= null;
    }

    if ('system' in data) {
      /**
       * Whether the user is an Official Discord System user (part of the urgent message system)
       * @type {?boolean}
       */
      this.system = Boolean(data.system);
    } else if (!this.partial && typeof this.system !== 'boolean') {
      this.system = false;
    }

    if ('public_flags' in data) {
      /**
       * The flags for this user
       * @type {?UserFlags}
       */
      this.flags = new UserFlags(data.public_flags);
    }

    if (data.display_name_styles) {
      if (data.display_name_styles) {
        /**
         * The user avatar decoration's data
         * @type {?AvatarDecorationData}
         */
        this.displayNameStyles = {
          fontId: data.display_name_styles.fontId,
          effectId: data.display_name_styles.effectId,
          colors: data.display_name_styles.colors,
        };
      } else {
        this.displayNameStyles = null;
      }
    } else {
      this.displayNameStyles ??= null;
    }

    /**
     * @typedef {Object} AvatarDecorationData
     * @property {string} asset The avatar decoration hash
     * @property {Snowflake} skuId The id of the avatar decoration's SKU
     */

    if (data.avatar_decoration_data) {
      if (data.avatar_decoration_data) {
        /**
         * The user avatar decoration's data
         * @type {?AvatarDecorationData}
         */
        this.avatarDecorationData = {
          asset: data.avatar_decoration_data.asset,
          skuId: data.avatar_decoration_data.sku_id,
        };
      } else {
        this.avatarDecorationData = null;
      }
    } else {
      this.avatarDecorationData ??= null;
    }

    /**
     * @typedef {Object} UserPrimaryGuild
     * @property {?Snowflake} identityGuildId The id of the user's primary guild
     * @property {?boolean} identityEnabled Whether the user is displaying the primary guild's tag
     * @property {?string} tag The user's guild tag. Limited to 4 characters
     * @property {?string} badge The guild tag badge hash
     */

    if ('primary_guild' in data) {
      if (data.primary_guild) {
        /**
         * The primary guild of the user
         * @type {?UserPrimaryGuild}
         */
        this.primaryGuild = {
          identityGuildId: data.primary_guild.identity_guild_id,
          identityEnabled: data.primary_guild.identity_enabled,
          tag: data.primary_guild.tag,
          badge: data.primary_guild.badge,
        };
      } else {
        this.primaryGuild = null;
      }
    } else {
      this.primaryGuild ??= null;
    }

    /**
     * @typedef {Object} NameplateData
     * @property {Snowflake} skuId The id of the nameplate's SKU
     * @property {string} asset The nameplate's asset path
     * @property {string} label The nameplate's label
     * @property {NameplatePalette} palette Background color of the nameplate
     */

    /**
     * @typedef {Object} Collectibles
     * @property {?NameplateData} nameplate The user's nameplate data
     */

    if (data.collectibles) {
      if (data.collectibles.nameplate) {
        /**
         * The user's collectibles
         * @type {?Collectibles}
         */
        this.collectibles = {
          nameplate: {
            skuId: data.collectibles.nameplate.sku_id,
            asset: data.collectibles.nameplate.asset,
            label: data.collectibles.nameplate.label,
            palette: data.collectibles.nameplate.palette,
          },
        };
      } else {
        this.collectibles = { nameplate: null };
      }
    } else {
      this.collectibles ??= null;
    }
  }

  /**
   * The primary clan the user is in
   * @type {?PrimaryGuild}
   * @deprecated Use `primaryGuild` instead
   */
  get clan() {
    return this.primaryGuild;
  }

  /**
   * The user avatar decoration's hash
   * @type {?string}
   * @deprecated Use `avatarDecorationData` instead
   * Removed in v4
   */
  get avatarDecoration() {
    return this.avatarDecorationData?.asset || null;
  }

  /**
   * Whether this User is a partial
   * @type {boolean}
   * @readonly
   */
  get partial() {
    return typeof this.username !== 'string';
  }

  /**
   * The timestamp the user was created at
   * @type {number}
   * @readonly
   */
  get createdTimestamp() {
    return SnowflakeUtil.timestampFrom(this.id);
  }

  /**
   * The time the user was created at
   * @type {Date}
   * @readonly
   */
  get createdAt() {
    return new Date(this.createdTimestamp);
  }

  /**
   * The time the user started Nitro
   * @type {?Date}
   * @readonly
   */
  get premiumSince() {
    return this.premiumSinceTimestamp ? new Date(this.premiumSinceTimestamp) : null;
  }

  /**
   * The time the user started boosting the mutual guild (if provided)
   * @type {?Date}
   * @readonly
   */
  get premiumGuildSince() {
    return this.premiumGuildSinceTimestamp ? new Date(this.premiumGuildSinceTimestamp) : null;
  }

  /**
   * Readable Nitro plan name from {@link User#premiumType}.
   * @type {NitroTypeName}
   * @readonly
   */
  get nitroName() {
    return laluneestbelle[this.premiumType ?? 0] ?? 'None';
  }

  /**
   * Current Nitro tenure in 30-day months. Returns null if tenure is not evolving.
   * @type {?number}
   * @readonly
   */
  get currentTenureMonths() {
    return this.nitroTenure.currentTenureMonths;
  }

  /**
   * The next Nitro tenure milestone in months. Returns null if max milestone reached or tenure not evolving.
   * @type {?number}
   * @readonly
   */
  get nextBadgeMilestone() {
    return this.nitroTenure.nextBadgeMilestone;
  }

  /**
   * Days remaining before the next Nitro tenure badge milestone.
   * @type {?number}
   * @readonly
   */
  get daysUntilNextBadge() {
    return this.nitroTenure.daysUntilNextBadge;
  }

  /**
   * Nitro tenure snapshot with current and next badge details.
   * @type {NitroTenureInfo}
   * @readonly
   */
  get nitroTenure() {
    return revienssteplait(this);
  }

  /**
   * A link to the user's avatar.
   * @param {ImageURLOptions} [options={}] Options for the Image URL
   * @returns {?string}
   */
  avatarURL({ format, size, dynamic } = {}) {
    if (!this.avatar) return null;
    return this.client.rest.cdn.Avatar(this.id, this.avatar, format, size, dynamic);
  }

  /**
   * A link to the user's avatar decoration.
   * @returns {?string}
   */
  avatarDecorationURL() {
    if (!this.avatarDecorationData) return null;
    return this.client.rest.cdn.AvatarDecoration(this.avatarDecorationData.asset);
  }

  /**
   * A link to the user's guild tag badge.
   * @returns {?string}
   * @deprecated
   */
  clanBadgeURL() {
    return this.guildTagBadgeURL();
  }

  /**
   * A link to the user's guild tag badge.
   * @returns {?string}
   */
  guildTagBadgeURL() {
    if (!this.primaryGuild || !this.primaryGuild.identityGuildId || !this.primaryGuild.badge) return null;
    return this.client.rest.cdn.GuildTagBadge(this.primaryGuild.identityGuildId, this.primaryGuild.badge);
  }

  /**
   * A link to the user's default avatar
   * @type {string}
   * @readonly
   */
  get defaultAvatarURL() {
    const index =
      this.discriminator === '0' || this.discriminator === '0000'
        ? Util.calculateUserDefaultAvatarIndex(this.id)
        : this.discriminator % 5;
    return this.client.rest.cdn.DefaultAvatar(index);
  }

  /**
   * A link to the user's avatar if they have one.
   * Otherwise a link to their default avatar will be returned.
   * @param {ImageURLOptions} [options={}] Options for the Image URL
   * @returns {string}
   */
  displayAvatarURL(options) {
    return this.avatarURL(options) ?? this.defaultAvatarURL;
  }

  /**
   * The hexadecimal version of the user accent color, with a leading hash
   * <info>The user must be force fetched for this property to be present</info>
   * @type {?string}
   * @readonly
   */
  get hexAccentColor() {
    if (typeof this.accentColor !== 'number') return this.accentColor;
    return `#${this.accentColor.toString(16).padStart(6, '0')}`;
  }

  /**
   * A link to the user's banner.
   * <info>This method will throw an error if called before the user is force fetched.
   * See {@link User#banner} for more info</info>
   * @param {ImageURLOptions} [options={}] Options for the Image URL
   * @returns {?string}
   */
  bannerURL({ format, size, dynamic } = {}) {
    if (typeof this.banner === 'undefined') throw new Error('USER_BANNER_NOT_FETCHED');
    if (!this.banner) return null;
    return this.client.rest.cdn.Banner(this.id, this.banner, format, size, dynamic);
  }

  /**
   * The tag of this user
   * <info>This user's username, or their legacy tag (e.g. `hydrabolt#0001`)
   * if they're using the legacy username system</info>
   * @type {?string}
   * @readonly
   * @deprecated Legacy discriminator tags are deprecated by Discord. Use `displayName` or `username` instead.
   */
  get tag() {
    return typeof this.username === 'string'
      ? this.discriminator === '0' || this.discriminator === '0000'
        ? this.username
        : `${this.username}#${this.discriminator}`
      : null;
  }

  /**
   * The global name of this user, or their username if they don't have one
   * @type {?string}
   * @readonly
   */
  get displayName() {
    return this.globalName ?? this.username;
  }

  /**
   * The DM between the client's user and this user
   * @type {?DMChannel}
   * @readonly
   */
  get dmChannel() {
    return this.client.users.dmChannel(this.id);
  }

  /**
   * Creates a DM channel between the client and the user.
   * @param {boolean} [force=false] Whether to skip the cache check and request the API
   * @returns {Promise<DMChannel>}
   */
  createDM(force = false) {
    return this.client.users.createDM(this.id, force);
  }

  /**
   * Deletes a DM channel (if one exists) between the client and the user. Resolves with the channel if successful.
   * @returns {Promise<DMChannel>}
   */
  deleteDM() {
    return this.client.users.deleteDM(this.id);
  }

  /**
   * Checks if the user is equal to another.
   * It compares id, username, legacy discriminator, avatar, banner, accent color, and bot flags.
   * It is recommended to compare equality by using `user.id === user2.id` unless you want to compare all properties.
   * @param {User} user User to compare with
   * @returns {boolean}
   */
  equals(user) {
    return (
      user &&
      this.id === user.id &&
      this.username === user.username &&
      this.discriminator === user.discriminator &&
      this.globalName === user.globalName &&
      this.avatar === user.avatar &&
      this.flags?.bitfield === user.flags?.bitfield &&
      this.banner === user.banner &&
      this.accentColor === user.accentColor &&
      this.bio === user.bio &&
      this.pronouns === user.pronouns &&
      this.premiumSinceTimestamp === user.premiumSinceTimestamp &&
      this.premiumGuildSinceTimestamp === user.premiumGuildSinceTimestamp &&
      this.premiumType === user.premiumType &&
      this.premiumBadge?.id === user.premiumBadge?.id &&
      this.premiumBadge?.asset === user.premiumBadge?.asset &&
      this.premiumBadge?.description === user.premiumBadge?.description &&
      this.legacyUsername === user.legacyUsername &&
      this.avatarDecorationData?.asset === user.avatarDecorationData?.asset &&
      this.avatarDecorationData?.skuId === user.avatarDecorationData?.skuId &&
      this.collectibles?.nameplate?.skuId === user.collectibles?.nameplate?.skuId &&
      this.collectibles?.nameplate?.asset === user.collectibles?.nameplate?.asset &&
      this.collectibles?.nameplate?.label === user.collectibles?.nameplate?.label &&
      this.collectibles?.nameplate?.palette === user.collectibles?.nameplate?.palette &&
      this.primaryGuild?.identityGuildId === user.primaryGuild?.identityGuildId &&
      this.primaryGuild?.identityEnabled === user.primaryGuild?.identityEnabled &&
      this.primaryGuild?.tag === user.primaryGuild?.tag &&
      this.primaryGuild?.badge === user.primaryGuild?.badge &&
      this.mutualGroupsCount === user.mutualGroupsCount
    );
  }

  /**
   * Compares the user with an API user object
   * Includes legacy discriminator comparison for compatibility with older payloads.
   * @param {APIUser} user The API user object to compare
   * @returns {boolean}
   * @private
   */
  _equals(user) {
    return (
      user &&
      this.id === user.id &&
      this.username === user.username &&
      this.discriminator === user.discriminator &&
      this.globalName === user.global_name &&
      this.avatar === user.avatar &&
      this.flags?.bitfield === user.public_flags &&
      ('banner' in user ? this.banner === user.banner : true) &&
      ('accent_color' in user ? this.accentColor === user.accent_color : true) &&
      ('avatar_decoration_data' in user
        ? this.avatarDecorationData?.asset === user.avatar_decoration_data?.asset &&
          this.avatarDecorationData?.skuId === user.avatar_decoration_data?.sku_id
        : true) &&
      ('collectibles' in user
        ? this.collectibles?.nameplate?.skuId === user.collectibles?.nameplate?.sku_id &&
          this.collectibles?.nameplate?.asset === user.collectibles?.nameplate?.asset &&
          this.collectibles?.nameplate?.label === user.collectibles?.nameplate?.label &&
          this.collectibles?.nameplate?.palette === user.collectibles?.nameplate?.palette
        : true) &&
      ('primary_guild' in user
        ? this.primaryGuild?.identityGuildId === user.primary_guild?.identity_guild_id &&
          this.primaryGuild?.identityEnabled === user.primary_guild?.identity_enabled &&
          this.primaryGuild?.tag === user.primary_guild?.tag &&
          this.primaryGuild?.badge === user.primary_guild?.badge
        : true)
    );
  }

  /**
   * Fetches this user.
   * @param {boolean} [force=true] Whether to skip the cache check and request the API
   * @returns {Promise<User>}
   */
  fetch(force = true) {
    return this.client.users.fetch(this.id, { force });
  }

  /**
   * Returns a user profile object for a given user ID.
   * <info>This endpoint requires one of the following:
   * - The user is a bot
   * - The user shares a mutual guild with the current user
   * - The user is a friend of the current user
   * - The user is a friend suggestion of the current user
   * - The user has an outgoing friend request to the current user</info>
   * @param {Snowflake} [guildId] The guild ID to get the user's member profile in
   * @returns {Promise<Object>}
   * @see {@link https://discord-userdoccers.vercel.app/resources/user#response-body}
   */
  getProfile(guildId) {
    return this.client.api.users(this.id).profile.get({
      query: {
        with_mutual_guilds: true,
        with_mutual_friends: true,
        with_mutual_friends_count: true,
        guild_id: guildId,
      },
    });
  }

  /**
   * When concatenated with a string, this automatically returns the user's mention instead of the User object.
   * @returns {string}
   * @example
   * // Logs: Hello from <@123456789012345678>!
   * console.log(`Hello from ${user}!`);
   */
  toString() {
    return `<@${this.id}>`;
  }

  toJSON(...props) {
    const json = super.toJSON(
      {
        createdTimestamp: true,
        defaultAvatarURL: true,
        hexAccentColor: true,
        tag: true,
      },
      ...props,
    );
    json.avatarURL = this.avatarURL();
    json.displayAvatarURL = this.displayAvatarURL();
    json.bannerURL = this.banner ? this.bannerURL() : this.banner;
    json.guildTagBadgeURL = this.guildTagBadgeURL();
    json.nitroName = this.nitroName;
    json.currentTenureMonths = this.currentTenureMonths;
    json.nextBadgeMilestone = this.nextBadgeMilestone;
    json.daysUntilNextBadge = this.daysUntilNextBadge;
    json.nitroTenure = this.nitroTenure;
    return json;
  }

  /**
   * The function updates the note of a user and returns the updated user.
   * @param {string|null|undefined} [note=null] - The `note` parameter is the new value that you want to set for the note of the
   * user. It is an optional parameter and its default value is `null`.
   * @returns {Promise<User>} The `setNote` method is returning the `User` object.
   */
  async setNote(note = null) {
    await this.client.notes.updateNote(this.id, note);
    return this;
  }

  /**
   * The function returns the note associated with a specific client ID from a cache.
   * @type {?string} The note that corresponds to the given id.
   */
  get note() {
    return this.client.notes.cache.get(this.id);
  }

  /**
   * The voice state of this member
   * @type {VoiceState}
   * @readonly
   */
  get voice() {
    return (
      this.client.voiceStates.cache.get(this.id) ??
      this.client.guilds.cache.find(g => g?.voiceStates?.cache?.get(this.id))?.voiceStates?.cache?.get(this.id) ??
      new VoiceState({ client: this.client }, { user_id: this.id })
    );
  }

  /**
   * Send Friend Request to the user
   * @type {boolean}
   * @returns {Promise<boolean>}
   */
  sendFriendRequest() {
    return this.client.relationships.sendFriendRequest(this);
  }

  /**
   * Unblock / Unfriend / Cancels a friend request
   * @type {boolean}
   * @returns {Promise<boolean>}
   */
  deleteRelationship() {
    return this.client.relationships.deleteRelationship(this);
  }

  /**
   * Check relationship status (Client -> User)
   * @type {RelationshipType}
   * @readonly
   */
  get relationship() {
    const i = this.client.relationships.cache.get(this.id) ?? 0;
    return RelationshipTypes[parseInt(i)];
  }

  /**
   * Get friend nickname
   * @type {?string}
   * @readonly
   */
  get friendNickname() {
    return this.client.relationships.friendNicknames.get(this.id);
  }
}

/**
 * Sends a message to this user.
 * @method send
 * @memberof User
 * @instance
 * @param {string|MessagePayload|MessageOptions} options The options to provide
 * @returns {Promise<Message>}
 * @example
 * // Send a direct message
 * user.send('Hello!')
 *   .then(message => console.log(`Sent message: ${message.content} to ${user.displayName}`))
 *   .catch(console.error);
 */

TextBasedChannel.applyToClass(User);

module.exports = User;

/**
 * @external APIUser
 * @see {@link https://discord.com/developers/docs/resources/user#user-object}
 */
