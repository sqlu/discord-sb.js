[!IMPORTANT]
**This project is a fork of the [discord.js-selfbot-v13](https://github.com/aiko-chan-ai/discord.js-selfbot-v13) archived project.**

# discord.js-selfbot-v13 (fork)

Small additions focused on profile data and account integrations.

## What's New
- User fetches now include bio and pronouns when available (via `/users/{id}/profile`).
- `client.user.fetchConnections({ includeMetadata })` returns your connections (Spotify, Steam, etc.) with metadata when the API exposes it.

## Quick Examples
```js
// Fetch a user's bio and pronouns
const user = await client.users.fetch('123456789012345678');
console.log(user.bio, user.pronouns);

// List your connections with metadata
const connections = await client.user.fetchConnections();
console.log(connections);
```
