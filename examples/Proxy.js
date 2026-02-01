'use strict';

const Discord = require('../src/index');

const client = new Discord.Client({
  http: {
    // API Proxy
    // Accepts: string | URL | { uri: string; headers?: Record<string, string> }
    agent: 'http://user:pass@proxy.local:8080',
    // or new URL('http://proxy.local:8080')
    // or { uri: 'http://proxy.local:8080' }
  },
});

client.on('ready', async () => {
  console.log('Ready!', client.user.tag);
});

client.login('token');
