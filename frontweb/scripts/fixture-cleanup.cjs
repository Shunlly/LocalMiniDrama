'use strict'

const fs = require('node:fs')
const fsPromises = require('node:fs/promises')

const FIXTURE_CLEANUP_RETRY_OPTIONS = Object.freeze({
  recursive: true,
  maxRetries: 3,
  retryDelay: 250,
})

function cleanupOptions(options = {}) {
  return {
    ...FIXTURE_CLEANUP_RETRY_OPTIONS,
    force: options.force === true,
  }
}

function removeFixtureTreeSync(target, options) {
  return fs.rmSync(target, cleanupOptions(options))
}

function removeFixtureTree(target, options) {
  return fsPromises.rm(target, cleanupOptions(options))
}

module.exports = { removeFixtureTree, removeFixtureTreeSync }
