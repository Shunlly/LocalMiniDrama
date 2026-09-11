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
    query: { returnTo: '/?q=moon', episode: '7' },
  })
  assert.deepEqual(projectCardDestination({ id: '51', episodes: [{ id: 'bad' }] }, false, '/?q=moon'), {
    name: 'drama-detail',
    params: { id: 51 },
    query: { returnTo: '/?q=moon' },
    hash: '#episode-list',
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

test('newly created projects land on the episode list unless URL-import intent is active', async () => {
  const { newProjectDestination } = await import('../src/utils/sourceImportNavigation.js')

  assert.deepEqual(newProjectDestination({ id: '51' }, false, '/?q=moon'), {
    name: 'drama-detail',
    params: { id: 51 },
    query: { returnTo: '/?q=moon' },
    hash: '#episode-list',
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

test('卡片下一步文案与跳转一致：无有效剧集去创建，有剧集才继续制作', async () => {
  const { projectCardContinueLabel, projectCardOpenLabel, projectCardDestination } = await import('../src/utils/sourceImportNavigation.js')

  const blank = { id: 51, title: '空白本', episodes: [] }
  const invalid = { id: 51, title: '残本', episodes: [{ id: 'bad' }] }
  const ready = { id: 51, title: '雨巷', episodes: [{ id: 7 }] }

  assert.equal(projectCardContinueLabel(blank, false), '去创建剧集')
  assert.equal(projectCardContinueLabel(invalid, false), '去创建剧集')
  assert.equal(projectCardContinueLabel(ready, false), '继续制作')
  assert.equal(projectCardContinueLabel(ready, true), '导入网页 URL')
  assert.equal(projectCardOpenLabel(blank, false), '打开项目「空白本」，去创建剧集')
  assert.equal(projectCardOpenLabel(ready, false), '打开项目「雨巷」，继续制作')
  assert.equal(projectCardOpenLabel({ title: '' }, true), '打开项目「未命名项目」，导入网页 URL')
  assert.equal(projectCardDestination(blank, false, '/').hash, '#episode-list')
  assert.equal(projectCardDestination(invalid, false, '/').hash, '#episode-list')
  assert.equal(projectCardDestination(ready, false, '/').name, 'film')
})
