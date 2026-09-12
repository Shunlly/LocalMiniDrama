'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  createRuntimeInstanceId,
} = require('../src/utils/runtimeInstanceId');

test('runtime instance id is stable for one checkout and changes with path or revision', () => {
  const checkout = path.resolve('C:/synthetic/localminidrama');
  const first = createRuntimeInstanceId({ rootDirectory: checkout, revision: 'abc123' });

  assert.match(first, /^lmd-[a-f0-9]{24}$/);
  assert.equal(
    createRuntimeInstanceId({ rootDirectory: checkout, revision: 'abc123' }),
    first
  );
  assert.notEqual(
    createRuntimeInstanceId({ rootDirectory: path.join(checkout, 'copy'), revision: 'abc123' }),
    first
  );
  assert.notEqual(
    createRuntimeInstanceId({ rootDirectory: checkout, revision: 'def456' }),
    first
  );
});
