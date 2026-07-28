'use strict'

const assert = require('node:assert/strict')

assert.equal(process.versions.electron, '43.1.1', 'desktop verification must use Electron 43.1.1')
assert.match(process.versions.node, /^24\./, 'Electron 43 must embed a Node 24 runtime')
process.exit(0)
