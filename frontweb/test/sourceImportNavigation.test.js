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
