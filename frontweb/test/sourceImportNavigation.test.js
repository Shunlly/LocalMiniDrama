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

test('existing project cards open the film workspace unless URL-import intent is active', async () => {
  const { projectCardDestination } = await import('../src/utils/sourceImportNavigation.js')

  assert.deepEqual(projectCardDestination({ id: '51', episodes: [{ id: 7 }] }, false, '/?q=moon'), {
    name: 'film',
    params: { id: 51 },
    query: { returnTo: '/?q=moon' },
  })
  assert.deepEqual(projectCardDestination({ id: '51' }, false, '/?q=moon'), {
    name: 'drama-detail',
    params: { id: 51 },
    query: { returnTo: '/?q=moon' },
    hash: '#episode-list',
  })
  assert.deepEqual(projectCardDestination({ id: '51', episodes: [] }, false, '/?q=moon'), {
    name: 'drama-detail',
    params: { id: 51 },
    query: { returnTo: '/?q=moon' },
    hash: '#episode-list',
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

test('newly created projects land on source intake instead of an empty film workspace', async () => {
  const { newProjectDestination } = await import('../src/utils/sourceImportNavigation.js')

  assert.deepEqual(newProjectDestination({ id: '51' }, false, '/?q=moon'), {
    name: 'drama-detail',
    params: { id: 51 },
    query: { returnTo: '/?q=moon' },
    hash: '#source-intake-workflow',
  })
  assert.deepEqual(newProjectDestination({ id: '52' }, true, '/?intent=source-import'), {
    name: 'drama-detail',
    params: { id: 52 },
    query: {
      intake: 'source-url',
      returnTo: '/?intent=source-import',
    },
    hash: '#source-intake-workflow',
  })
})
