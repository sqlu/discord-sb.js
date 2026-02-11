'use strict';

const handlers = require('./handlers');

const table = Object.assign(Object.create(null), handlers);

module.exports = Object.freeze(table);
