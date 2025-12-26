'use strict';

const { setTimeout } = require('node:timers');
const { Collection } = require('@discordjs/collection');
const BaseManager = require('./BaseManager');

/**
 * Represents a single quest
 */
class Quest {
  constructor(data) {
    this.id = data.id;
    this.config = data.config;
    this.userStatus = data.user_status;
  }

  /**
   * Check if quest is expired
   * @param {Date} [date=new Date()] Date to check against
   * @returns {boolean}
   */
  isExpired(date = new Date()) {
    if (!this.config.expires_at) return false;
    return new Date(this.config.expires_at) < date;
  }

  /**
   * Check if quest is completed
   * @returns {boolean}
   */
  isCompleted() {
    return this.userStatus?.completed_at != null;
  }

  /**
   * Check if quest rewards have been claimed
   * @returns {boolean}
   */
  hasClaimedRewards() {
    return this.userStatus?.claimed_at != null;
  }

  /**
   * Check if user is enrolled in quest
   * @returns {boolean}
   */
  isEnrolledQuest() {
    return this.userStatus?.enrolled_at != null;
  }

  /**
   * Update user status for this quest
   * @param {Object} status New status data
   */
  updateUserStatus(status) {
    this.userStatus = { ...this.userStatus, ...status };
  }
}

/**
 * Manages API methods for Discord quests
 * @extends {BaseManager}
 */
class QuestManager extends BaseManager {
  constructor(client) {
    super(client);

    /**
     * Collection of cached quests
     * @type {Collection<string, Quest>}
     */
    this.cache = new Collection();
  }

  /**
   * Get all available quests for the user
   * @returns {Promise<Object>} Quest data
   */
  async get() {
    const data = await this.client.api.quests('@me').get();

    // Cache quests
    if (data.quests) {
      this.cache.clear();
      data.quests.forEach(questData => {
        const quest = new Quest(questData);
        this.cache.set(quest.id, quest);
      });
    }

    return data;
  }

  /**
   * Refresh the quest cache from the API
   * @returns {Promise<Object>} Latest quest data
   */
  async refreshCache() {
    return this.get();
  }

  /**
   * Get user's orb balance (virtual currency)
   * @returns {Promise<Object>} Balance data
   */
  async orbs() {
    const data = await this.client.api.users['@me']['virtual-currency'].balance.get();
    return data;
  }

  /**
   * Get quest by ID from cache
   * @param {string} id Quest ID
   * @returns {Quest|undefined}
   */
  getQuest(id) {
    return this.cache.get(id);
  }

  /**
   * Get all cached quests as array
   * @returns {Quest[]}
   */
  list() {
    return Array.from(this.cache.values());
  }

  /**
   * Get expired quests
   * @param {Date} [date=new Date()] Date to check against
   * @returns {Quest[]}
   */
  getExpired(date = new Date()) {
    return this.list().filter(quest => quest.isExpired(date));
  }

  /**
   * Get completed quests
   * @returns {Quest[]}
   */
  getCompleted() {
    return this.list().filter(quest => quest.isCompleted());
  }

  /**
   * Get claimable quests (completed but not claimed)
   * @returns {Quest[]}
   */
  getClaimable() {
    return this.list().filter(quest => quest.isCompleted() && !quest.hasClaimedRewards());
  }

  /**
   * Get valid quests (not completed, not expired, not blacklisted)
   * @returns {Quest[]}
   */
  filterQuestsValid() {
    return this.list().filter(
      quest => quest.id !== '1412491570820812933' && !quest.isCompleted() && !quest.isExpired(),
    );
  }

  /**
   * Check if quest exists in cache
   * @param {string} id Quest ID
   * @returns {boolean}
   */
  hasQuest(id) {
    return this.cache.has(id);
  }

  /**
   * Get application data for given IDs
   * @param {string[]} ids Application IDs
   * @returns {Promise<Object[]>}
   */
  async getApplicationData(ids) {
    const query = new URLSearchParams();
    ids.forEach(id => query.append('application_ids', id));

    return this.client.api.applications.public.get({ query: query.toString() });
  }

  /**
   * Enroll in a specific quest
   * @param {string} questId The quest ID to enroll in
   * @param {Object} [options] Enrollment options
   * @param {number} [options.location=11] Location parameter
   * @param {boolean} [options.isTargeted=false] Whether the quest is targeted
   * @param {*} [options.metadataRaw=null] Raw metadata
   * @returns {Promise<Quest|undefined>} Updated quest or undefined
   */
  async acceptQuest(questId, options = {}) {
    const { location = 11, isTargeted = false, metadataRaw = null } = options;

    const data = await this.client.api.quests(questId).enroll.post({
      data: {
        location,
        is_targeted: isTargeted,
        metadata_raw: metadataRaw,
      },
    });

    const quest = this.getQuest(questId);
    if (quest) {
      quest.updateUserStatus(data);
    }

    await this.refreshCache();
    return this.getQuest(questId);
  }

  /**
   * Update progress for a video quest
   * @param {string} questId The quest ID
   * @param {number} timestamp Current progress timestamp
   * @param {boolean} [refresh=true] Whether to refresh the quest cache after the update
   * @returns {Promise<Object>} Progress update result
   */
  async videoProgress(questId, timestamp, refresh = true) {
    const data = await this.client.api.quests(questId)['video-progress'].post({
      data: { timestamp },
    });
    if (refresh) await this.refreshCache();
    return data;
  }

  /**
   * Send heartbeat for desktop quests
   * @param {string} questId The quest ID
   * @param {string} applicationId Application ID
   * @param {boolean} [terminal=false] Whether this is a terminal heartbeat
   * @param {boolean} [refresh=true] Whether to refresh the quest cache after the update
   * @returns {Promise<Object>} Heartbeat result
   */
  async heartbeat(questId, applicationId, terminal = false, refresh = true) {
    const data = await this.client.api.quests(questId).heartbeat.post({
      data: {
        application_id: applicationId,
        terminal,
      },
    });
    if (refresh) await this.refreshCache();
    return data;
  }

  /**
   * Helper function for timeout
   * @param {number} ms Milliseconds to wait
   * @returns {Promise<void>}
   * @private
   */
  async timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Complete a quest automatically
   * @param {Quest} quest Quest to complete
   * @returns {Promise<void>}
   */
  async doingQuest(quest) {
    const questName = quest.config.messages?.quest_name || 'Unknown Quest';

    if (!quest.isEnrolledQuest()) await this.acceptQuest(quest.id);

    const taskConfig = quest.config.task_config;

    const taskName = [
      'WATCH_VIDEO',
      'PLAY_ON_DESKTOP',
      'STREAM_ON_DESKTOP',
      'PLAY_ACTIVITY',
      'WATCH_VIDEO_ON_MOBILE',
    ].find(x => taskConfig.tasks?.[x] != null);

    if (!taskName) {
      console.log(`Unknown task type for quest "${questName}"`);
      return;
    }

    const secondsNeeded = taskConfig.tasks[taskName].target;

    if (taskName === 'WATCH_VIDEO' || taskName === 'WATCH_VIDEO_ON_MOBILE') {
      let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;
      const maxFuture = 10;
      const speed = 7;
      const interval = 1;
      const enrolledAt = new Date(quest.userStatus?.enrolled_at).getTime();
      let completed = false;

      while (!completed && secondsDone < secondsNeeded) {
        const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
        const diff = maxAllowed - secondsDone;
        const timestamp = secondsDone + speed;

        if (diff >= speed) {
          const res = await this.videoProgress(quest.id, Math.min(secondsNeeded, timestamp + Math.random()), false);
          completed = res.completed_at != null;
          secondsDone = Math.min(secondsNeeded, timestamp);
        }

        if (timestamp >= secondsNeeded) {
          break;
        }

        await this.timeout(interval * 1000);
      }

      if (!completed) {
        await this.videoProgress(quest.id, secondsNeeded, false);
      }
    } else if (taskName === 'PLAY_ON_DESKTOP') {
      const interval = 60;

      while (!quest.isCompleted()) {
        const res = await this.heartbeat(quest.id, quest.config.application.id, false, false);
        quest.updateUserStatus(res);

        await this.timeout(interval * 1000);
      }

      const res = await this.heartbeat(quest.id, quest.config.application.id, true, false);
      quest.updateUserStatus(res);
    }

    await this.refreshCache();
  }

  /**
   * Auto-complete all valid quests
   * @returns {Promise<void>}
   */
  async autoCompleteAll() {
    await this.get(); // Refresh quest data
    const validQuests = this.filterQuestsValid();

    for (const quest of validQuests) {
      try {
        await this.doingQuest(quest);
      } catch (error) {
        console.error(`Failed to complete quest ${quest.id}:`, error);
      }
    }
  }

  /**
   * Get cache size
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Clear quest cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Make QuestManager iterable
   * @returns {IterableIterator<Quest>}
   */
  [Symbol.iterator]() {
    return this.cache.values();
  }
}

module.exports = QuestManager;
