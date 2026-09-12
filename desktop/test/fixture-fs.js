'use strict';

const fs = require('node:fs');

const FIXTURE_CLEANUP_OPTIONS = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 250,
});

function removeFixtureTree(target) {
  fs.rmSync(target, FIXTURE_CLEANUP_OPTIONS);
}

module.exports = { removeFixtureTree };
