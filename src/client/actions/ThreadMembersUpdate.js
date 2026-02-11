'use strict';

const Action = require('./Action');
const { Events } = require('../../util/Constants');
const { hasListener } = require('../../util/ListenerUtil');

class ThreadMembersUpdateAction extends Action {
  handle(data) {
    const client = this.client;
    const thread = client.channels.cache.get(data.id);
    if (thread) {
      const hasThreadMembersListener = hasListener(client, Events.THREAD_MEMBERS_UPDATE);
      const old = hasThreadMembersListener ? thread.members.cache.clone() : null;
      thread.memberCount = data.member_count;

      for (const rawMember of data.added_members ?? []) {
        thread.members._add(rawMember);
      }

      for (const memberId of data.removed_member_ids ?? []) {
        thread.members.cache.delete(memberId);
      }

      /**
       * Emitted whenever members are added or removed from a thread. Requires `GUILD_MEMBERS` privileged intent
       * @event Client#threadMembersUpdate
       * @param {Collection<Snowflake, ThreadMember>} oldMembers The members before the update
       * @param {Collection<Snowflake, ThreadMember>} newMembers The members after the update
       */
      if (hasThreadMembersListener) {
        client.emit(Events.THREAD_MEMBERS_UPDATE, old, thread.members.cache);
      }
    }
    return {};
  }
}

module.exports = ThreadMembersUpdateAction;
