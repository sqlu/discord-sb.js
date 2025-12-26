> [!IMPORTANT]
> **This project is a fork of the [discord.js-selfbot-v13](https://github.com/aiko-chan-ai/discord.js-selfbot-v13) an archived project.**

# discord.js-selfbot-v13 (fork)

Small additions focused on profile data and account integrations.

## Nouveautés
- Les fetchs de users remontent désormais la bio/pronoms quand disponible (via `/users/{id}/profile`).
- `client.user.fetchConnections({ includeMetadata })` pour récupérer vos connexions (Spotify, Steam, etc.) avec métadonnées quand l’API les expose.

## Exemples rapides
```js
// Récupérer la bio d'un user
const user = await client.users.fetch('123456789012345678');
console.log(user.bio, user.pronouns);

// Lister vos connexions avec métadonnées
const connections = await client.user.fetchConnections();
console.log(connections);
```
