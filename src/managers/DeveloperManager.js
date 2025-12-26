'use strict';

const { Collection } = require('@discordjs/collection');
const BaseManager = require('./BaseManager');
const Application = require('../structures/interfaces/Application');
const DataResolver = require('../util/DataResolver');

/**
 * Manages API methods for developer applications and provides utilities you might need.
 * @extends {BaseManager}
 */
class DeveloperManager extends BaseManager {
  /**
   * Fetches all applications owned by the current user
   * @param {boolean} [withTeamApplications=true] Whether to include team applications
   * @returns {Promise<Collection<Snowflake, Application>>}
   * @example
   * // Fetch all developer applications
   * client.developers.get()
   *   .then(applications => console.log(`Found ${applications.size} applications`))
   *   .catch(console.error);
   */
  async get(withTeamApplications = true) {
    const data = await this.client.api.applications.get({
      query: {
        with_team_applications: withTeamApplications,
      },
    });

    const applications = new Collection();
    for (const app of data) {
      applications.set(app.id, new Application(this.client, app));
    }

    return applications;
  }

  /**
   * Alias for get() method
   * @param {boolean} [withTeamApplications=true] Whether to include team applications
   * @returns {Promise<Collection<Snowflake, Application>>}
   */
  list(withTeamApplications = true) {
    return this.get(withTeamApplications);
  }

  /**
   * Fetches a specific application by ID
   * @param {Snowflake} applicationId The ID of the application to fetch
   * @returns {Promise<Application>}
   * @example
   * // Fetch a specific application
   * client.developers.fetch('1234567890123456789')
   *   .then(app => console.log(`Application: ${app.name}`))
   *   .catch(console.error);
   */
  async fetch(applicationId) {
    const data = await this.client.api.applications(applicationId).get();
    return new Application(this.client, data);
  }

  /**
   * Edits an application
   * @param {Snowflake} applicationId The ID of the application to edit
   * @param {ApplicationEditData} data The data to edit the application with
   * @returns {Promise<Application>}
   * @example
   * // Edit an application
   * client.developers.edit('1234567890123456789', {
   *   name: 'My New Bot Name',
   *   description: 'A cool bot description',
   *   tags: ['utility', 'moderation']
   * })
   *   .then(app => console.log(`Updated: ${app.name}`))
   *   .catch(console.error);
   */
  async edit(applicationId, data) {
    const _data = {};

    if (data.name) {
      _data.name = data.name;
    }
    if (data.description !== undefined) {
      _data.description = data.description;
    }
    if (data.icon !== undefined) {
      _data.icon = await DataResolver.resolveImage(data.icon);
    }
    if (data.tags) {
      _data.tags = data.tags;
    }
    if (data.interactionsEndpointUrl !== undefined) {
      _data.interactions_endpoint_url = data.interactionsEndpointUrl;
    }
    if (data.roleConnectionsVerificationUrl !== undefined) {
      _data.role_connections_verification_url = data.roleConnectionsVerificationUrl;
    }
    if (data.termsOfServiceUrl !== undefined) {
      _data.terms_of_service_url = data.termsOfServiceUrl;
    }
    if (data.privacyPolicyUrl !== undefined) {
      _data.privacy_policy_url = data.privacyPolicyUrl;
    }

    const result = await this.client.api.applications(applicationId).patch({ data: _data });
    return new Application(this.client, result);
  }

  /**
   * Sets the avatar of an application
   * @param {Snowflake} applicationId The ID of the application
   * @param {?(BufferResolvable|Base64Resolvable)} avatar The new avatar
   * @returns {Promise<Application>}
   * @example
   * // Set application avatar
   * client.developers.setAvatar('1234567890123456789', './avatar.png')
   *   .then(app => console.log(`Updated avatar for ${app.name}`))
   *   .catch(console.error);
   */
  setAvatar(applicationId, avatar) {
    return this.edit(applicationId, { icon: avatar });
  }

  /**
   * Sets the name of an application
   * @param {Snowflake} applicationId The ID of the application
   * @param {string} name The new name
   * @returns {Promise<Application>}
   * @example
   * // Set application name
   * client.developers.setName('1234567890123456789', 'My Cool Bot')
   *   .then(app => console.log(`Renamed to ${app.name}`))
   *   .catch(console.error);
   */
  setName(applicationId, name) {
    return this.edit(applicationId, { name });
  }

  /**
   * Sets the description of an application
   * @param {Snowflake} applicationId The ID of the application
   * @param {string} description The new description
   * @returns {Promise<Application>}
   * @example
   * // Set application description
   * client.developers.setDescription('1234567890123456789', 'A helpful utility bot')
   *   .then(app => console.log(`Updated description for ${app.name}`))
   *   .catch(console.error);
   */
  setDescription(applicationId, description) {
    return this.edit(applicationId, { description });
  }

  /**
   * Sets the tags of an application (max 5 tags)
   * @param {Snowflake} applicationId The ID of the application
   * @param {string[]} tags Array of tags (max 5)
   * @returns {Promise<Application>}
   * @example
   * // Set application tags
   * client.developers.setTags('1234567890123456789', ['utility', 'moderation', 'fun'])
   *   .then(app => console.log(`Updated tags for ${app.name}`))
   *   .catch(console.error);
   */
  setTags(applicationId, tags) {
    if (tags.length > 5) {
      throw new Error('Maximum of 5 tags allowed');
    }
    return this.edit(applicationId, { tags });
  }

  /**
   * Adds a tag to an application
   * @param {Snowflake} applicationId The ID of the application
   * @param {string} tag The tag to add
   * @returns {Promise<Application>}
   * @example
   * // Add a tag to application
   * client.developers.addTag('1234567890123456789', 'music')
   *   .then(app => console.log(`Added tag to ${app.name}`))
   *   .catch(console.error);
   */
  async addTag(applicationId, tag) {
    const app = await this.fetch(applicationId);
    const currentTags = app.tags || [];

    if (currentTags.includes(tag)) {
      throw new Error('Tag already exists');
    }

    if (currentTags.length >= 5) {
      throw new Error('Maximum of 5 tags allowed');
    }

    const newTags = [...currentTags, tag];
    return this.edit(applicationId, { tags: newTags });
  }

  /**
   * Removes a tag from an application
   * @param {Snowflake} applicationId The ID of the application
   * @param {string} tag The tag to remove
   * @returns {Promise<Application>}
   * @example
   * // Remove a tag from application
   * client.developers.delTag('1234567890123456789', 'music')
   *   .then(app => console.log(`Removed tag from ${app.name}`))
   *   .catch(console.error);
   */
  async delTag(applicationId, tag) {
    const app = await this.fetch(applicationId);
    const currentTags = app.tags || [];

    if (!currentTags.includes(tag)) {
      throw new Error('Tag does not exist');
    }

    const newTags = currentTags.filter(t => t !== tag);
    return this.edit(applicationId, { tags: newTags });
  }

  /**
   * Enables intents for a bot application
   * @param {Snowflake} applicationId The ID of the application
   * @returns {Promise<Application>}
   * @example
   * // Enable intents for bot
   * client.developers.enableIntents('1234567890123456789')
   *   .then(app => console.log(`Enabled intents for ${app.name}`))
   *   .catch(console.error);
   */
  async enableIntents(applicationId) {
    const data = await this.client.api.applications(applicationId).patch({
      data: {
        bot_public: true,
        bot_require_code_grant: false,
        flags: 25731072, // Flags with intents enabled
      },
    });
    return new Application(this.client, data);
  }

  /**
   * Disables intents for a bot application
   * @param {Snowflake} applicationId The ID of the application
   * @returns {Promise<Application>}
   * @example
   * // Disable intents for bot
   * client.developers.disableIntents('1234567890123456789')
   *   .then(app => console.log(`Disabled intents for ${app.name}`))
   *   .catch(console.error);
   */
  async disableIntents(applicationId) {
    const data = await this.client.api.applications(applicationId).patch({
      data: {
        bot_public: true,
        bot_require_code_grant: false,
        flags: 25165824, // Flags with intents disabled
      },
    });
    return new Application(this.client, data);
  }
}

module.exports = DeveloperManager;
