'use strict';

const Discord = require('../src/index');

const client = new Discord.Client();

client.on('ready', async () => {
  console.log('Ready!', client.user.tag);
  await client.installUserApps('936929561302675456', ['applications.commands']); // Midjourney
  // await client.unInstallUserApp('936929561302675456'); // Uninstall when you need to revoke
});

client.login('token');
