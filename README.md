<div align="center">
  <br />
  <p>
    <a href="https://discord.js.org"><img src="https://discord.js.org/static/logo.svg" width="546" alt="discord.js" /></a>
  </p>
</div>

# discord-sb.js (maintained fork)

**Welcome to `discord-sb.js`, built on `discord.js@13.17` with select backports from `discord.js@14.21.0`.**

- A maintained Node.js fork that lets user accounts talk to the Discord API v9.

> [!IMPORTANT]  
> This codebase is derived from the archived project [discord.js-selfbot-v13](https://github.com/aiko-chan-ai/discord.js-selfbot-v13).

<div align="center">
  <p>
    <a href="https://www.npmjs.com/package/discord-sb.js"><img src="https://img.shields.io/npm/v/discord-sb.js.svg" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/discord-sb.js"><img src="https://img.shields.io/npm/dt/discord-sb.js.svg" alt="npm downloads" /></a>
    <a href="https://github.com/sqlu/discord-sb.js/actions"><img src="https://github.com/sqlu/discord-sb.js/actions/workflows/lint.yml/badge.svg" alt="Tests status" /></a>
  </p>
</div>

> [!WARNING]  
> Use at your own risk. Accounts can be disabled when running user-account automation.

> [!CAUTION]  
> Operating selfbots violates the [Discord Terms of Service](https://discord.com/terms) and can lead to account termination.

## About

- Server controls, profile styling, widgets, quests, and search utilities extend the v13 surface while keeping API parity where possible.
- Includes RemoteAuth helpers plus selected v14 backports that make sense for user accounts.

<details>
<summary><strong>New Features</strong></summary>

### User Fetch & Profile Depth
- Mutual insights via `client.users.fetch(id)`: `user.mutualGuilds`, `user.mutualGuildsCount`, `user.mutualFriendsCount`, `user.mutualGroups`, `user.mutualGroupsCount`.
- Identity fields: `user.legacyUsername` alongside the new handle.
- Connected accounts: `user.connectedAccounts` filtered to supported providers (Spotify, GitHub, Steam, etc.).
- Profile extras on fetch: `user.bio`, `user.pronouns`, `user.banner`, `user.accentColor`, `user.premiumType`, `user.premiumSince`, `user.premiumGuildSince`.

### Guild Management
- `guild.mute(options?)` - Mute a guild completely (suppress all notifications)
- `guild.unmute()` - Unmute a guild (restore all notifications)
- `guild.markRead(readStates?)` - Mark all channels in a guild as read

### Developer Applications
- `client.developers.get(withTeamApplications?)` - Fetch all developer applications owned by the user
- `client.developers.list(withTeamApplications?)` - Alias for get() method
- `client.developers.fetch(applicationId)` - Fetch a specific application by ID
- `client.developers.edit(applicationId, data)` - Edit an application with custom data
- `client.developers.setAvatar(applicationId, avatar)` - Set application avatar/icon
- `client.developers.setName(applicationId, name)` - Set application name
- `client.developers.setDescription(applicationId, description)` - Set application description
- `client.developers.setTags(applicationId, tags)` - Set application tags (max 5)
- `client.developers.addTag(applicationId, tag)` - Add a single tag to application
- `client.developers.delTag(applicationId, tag)` - Remove a tag from application
- `client.developers.enableIntents(applicationId)` - Enable bot intents for application
- `client.developers.disableIntents(applicationId)` - Disable bot intents for application

**Application Object Methods (Direct Usage):**
- `application.edit(data)` - Edit the application
- `application.setAvatar(avatar)` - Set application avatar/icon
- `application.setName(name)` - Set application name
- `application.setDescription(description)` - Set application description
- `application.setTags(tags)` - Set application tags (max 5)
- `application.addTag(tag)` - Add a single tag
- `application.delTag(tag)` - Remove a tag
- `application.enableIntents()` - Enable bot intents
- `application.disableIntents()` - Disable bot intents

### RPC Enhancements
- `rpc.setDetailsURL(url)` - Set a URL for RPC details (now fully functional)
- `rpc.setStateURL(url)` - Set a URL for RPC state (now fully functional)
- `rpc.details_url` - Property to access the details URL
- `rpc.state_url` - Property to access the state URL

### User Profile Customization
- `client.user.setNameStyle(fontName, effectName, color1, color2?)` - Set display name style with font, effect and colors
- `client.user.setClan(GuildID)` - Change your server clan tag
- `client.user.deleteClan()` - Remove server clan tag

### Profile Widgets
- `client.user.addWidget(type, gameId, comment?, tags?)` - Add a game widget to profile
- `client.user.delWidget(type, gameId?)` - Remove a widget or specific game
- `client.user.widgetsList()` - Get list of all widgets

### Quest System
- `client.quests.get()` - Fetch all available quests
- `client.quests.orbs()` - Get virtual currency balance
- `client.quests.acceptQuest(questId, options?)` - Accept a quest
- `client.quests.doingQuest(quest)` - Auto-complete a quest
- `client.quests.autoCompleteAll()` - Auto-complete all valid quests
- `client.quests.getCompleted()` - Get completed quests
- `client.quests.getClaimable()` - Get claimable quests
- `client.quests.filterQuestsValid()` - Filter valid quests

### Message Search
- `channel.search(options?)` - Search for messages in a channel with advanced filters
  - `authorId` - Search by specific author
  - `mentions` - Search for messages mentioning a user
  - `has` - Search for messages containing: `image`, `video`, `link`, `embed`, `sound`, `poll`, `sticker`, `snapshot`
  - `pinned` - Search only pinned messages
  - `sortBy` - Sort by `timestamp` or `relevance`
  - `sortOrder` - Sort order `desc` or `asc`
  - `offset` - Pagination offset
  - `limit` - Limit number of results
  - `maxTime` - Search for messages before a specific date/time

- `guild.search(options?)` - Search for messages across the entire guild with advanced filters
  - `channelId` - Search in a specific channel within the guild
  - All other options same as `channel.search()`

</details>

## Installation

> [!NOTE]  
> Requires Node.js 20.18.0 or later.

```sh-session
npm install discord-sb.js@latest
```

## Example

```js
const { Client } = require('discord-sb.js');
const client = new Client();

client.on('ready', async () => {
  console.log(`${client.user.username} is ready!`);
});

client.login('your_token');
```

**Run in the Discord client console (Ctrl + Shift + I):**

```js
window.webpackChunkdiscord_app.push([
  [Symbol()],
  {},
  req => {
    if (!req.c) return;
    for (const mod of Object.values(req.c)) {
      try {
        if (!mod.exports || mod.exports === window) continue;
        if (mod.exports?.getToken) return copy(mod.exports.getToken());
        for (const ex in mod.exports) {
          if (
            mod.exports?.[ex]?.getToken &&
            mod.exports[ex][Symbol.toStringTag] !== 'IntlMessagesProxy'
          ) {
            return copy(mod.exports[ex].getToken());
          }
        }
      } catch {}
    }
  },
]);

window.webpackChunkdiscord_app.pop();
console.log('%cDone!', 'font-size: 50px');
console.log(`%cToken copied to clipboard.`, 'font-size: 16px');
```

## Docs & Examples

- **Documentation:** https://discordjs-self-v13.netlify.app/  
- **Example snippets:** https://github.com/sqlu/discord-sb.js/tree/main/examples

## Contributing

- Check existing issues/requests and the docs before filing a new one.  
- PRs welcome; see the [discord.js contributing guide](https://github.com/discordjs/discord.js/blob/main/.github/CONTRIBUTING.md).

## Need help?

- GitHub Discussions: https://github.com/sqlu/discord-sb.js/discussions

## Credits

- [Discord.js](https://github.com/discordjs/discord.js)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=sqlu/discord-sb.js&type=Date)](https://star-history.com/#sqlu/discord-sb.js&Date)
