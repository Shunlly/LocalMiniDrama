import test from 'node:test'
import assert from 'node:assert/strict'

test('source-import intent routes an existing project to its URL import area', async () => {
  const { projectCardDestination } = await import('../src/utils/sourceImportNavigation.js')

  assert.deepEqual(projectCardDestination({ id: 42 }, true, '/?intent=source-import'), {
    name: 'drama-detail',
    params: { id: 42 },
    query: {
      intake: 'source-url',
      returnTo: '/?intent=source-import',
    },
    hash: '#source-intake-workflow',
  })
})

test('newly created projects reuse the same destination behavior for normal and URL-import intent', async () => {
  const { projectCardDestination } = await import('../src/utils/sourceImportNavigation.js')

  assert.deepEqual(projectCardDestination({ id: '51' }, false, '/?q=moon'), {
    name: 'film',
    params: { id: 51 },
    query: { returnTo: '/?q=moon' },
  })
  assert.deepEqual(projectCardDestination({ id: '52' }, true, '/?intent=source-import'), {
    name: 'drama-detail',
    params: { id: 52 },
    query: {
      intake: 'source-url',
      returnTo: '/?intent=source-import',
    },
    hash: '#source-intake-workflow',
  })
})
