import test from 'node:test'
import assert from 'node:assert/strict'
import * as scriptDraft from '../src/utils/scriptDraft.js'

const {
  buildEpisodeDraftPayload,
  createEpisodeSwitchController,
  createScriptDraftController,
  scriptDraftFingerprint,
} = scriptDraft

test('draft payload updates only the selected episode and preserves all siblings', () => {
  const episodes = [
    { id: 11, episode_number: 1, title: 'One', script_content: 'A', duration: 2 },
    { id: 12, episode_number: 2, title: 'Two', script_content: 'B', duration: 3 },
  ]
  const payload = buildEpisodeDraftPayload(episodes, {
    dramaId: 5,
    episodeId: 12,
    episodeNumber: 2,
    title: 'Two edited',
    content: 'B edited',
  })

  assert.equal(payload.length, 2)
  assert.deepEqual(payload[0], {
    episode_number: 1,
    title: 'One',
    script_content: 'A',
    description: null,
    duration: 2,
  })
  assert.equal(payload[1].title, 'Two edited')
  assert.equal(payload[1].script_content, 'B edited')
})

test('draft controller serializes saves and persists the newest edit after an in-flight save', async () => {
  const resolvers = []
  const saved = []
  const controller = createScriptDraftController({
    delay: 1000,
    setTimer: () => 1,
    clearTimer: () => {},
    saveSnapshot: async (snapshot) => {
      saved.push(snapshot.content)
      await new Promise((resolve) => resolvers.push(resolve))
    },
  })
  const base = { dramaId: 1, episodeId: 2, episodeNumber: 1, title: 'Episode' }
  controller.markSaved({ ...base, content: 'base' })
  controller.queue({ ...base, content: 'first' })
  const flushing = controller.flush()
  await new Promise((resolve) => setImmediate(resolve))
  controller.queue({ ...base, content: 'latest' })
  resolvers.shift()()
  await new Promise((resolve) => setImmediate(resolve))
  resolvers.shift()()
  await flushing

  assert.deepEqual(saved, ['first', 'latest'])
  assert.equal(controller.hasPendingChanges(), false)
  assert.equal(controller.getState(), 'saved')
  assert.notEqual(scriptDraftFingerprint({ ...base, content: 'first' }), scriptDraftFingerprint({ ...base, content: 'latest' }))
})

test('failed saves remain pending for a later flush', async () => {
  let attempts = 0
  const snapshot = { dramaId: 1, episodeId: 2, episodeNumber: 1, title: 'Episode', content: 'draft' }
  const controller = createScriptDraftController({
    setTimer: () => 1,
    clearTimer: () => {},
    saveSnapshot: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('offline')
    },
  })
  controller.queue(snapshot)
  await assert.rejects(controller.flush(), /offline/)
  assert.equal(controller.hasPendingChanges(), true)
  assert.equal(controller.getState(), 'error')
  await controller.flush()
  assert.equal(attempts, 2)
  assert.equal(controller.hasPendingChanges(), false)
})

test('episode switch waits for the current draft before committing the next episode', async () => {
  assert.equal(typeof createEpisodeSwitchController, 'function', 'missing draft-safe episode switch controller')
  let releaseDraft
  const draftGate = new Promise((resolve) => { releaseDraft = resolve })
  const events = []
  const busyStates = []
  const episodes = [
    { id: 11, title: 'One' },
    { id: 12, title: 'Two' },
  ]
  const controller = createEpisodeSwitchController({
    flushDraft: async () => {
      events.push('flush:start')
      await draftGate
      events.push('flush:end')
    },
    resolveEpisode: (id) => episodes.find((episode) => episode.id === Number(id)) || null,
    commitEpisode: (episode) => events.push(`commit:${episode?.id ?? 'none'}`),
    refreshEpisode: async (id) => events.push(`refresh:${id}`),
    onBusyChange: (busy) => busyStates.push(busy),
  })

  const switching = controller.select(12)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['flush:start'], 'the visible episode must remain committed while its draft is saving')
  assert.deepEqual(busyStates, [true])

  releaseDraft()
  assert.deepEqual(await switching, { changed: true, episode: episodes[1] })
  assert.deepEqual(events, ['flush:start', 'flush:end', 'commit:12', 'refresh:12'])
  assert.deepEqual(busyStates, [true, false])
})

test('episode switch failure keeps the committed episode and clears its busy state', async () => {
  const commits = []
  const busyStates = []
  const controller = createEpisodeSwitchController({
    flushDraft: async () => { throw new Error('save failed') },
    resolveEpisode: () => ({ id: 12 }),
    commitEpisode: (episode) => commits.push(episode),
    onBusyChange: (busy) => busyStates.push(busy),
  })

  await assert.rejects(controller.select(12), /save failed/)
  assert.deepEqual(commits, [])
  assert.deepEqual(busyStates, [true, false])
})

test('episode switch serializes requests without dropping a later route change', async () => {
  const events = []
  let releaseFirstRefresh
  const firstRefresh = new Promise((resolve) => { releaseFirstRefresh = resolve })
  const episodes = [{ id: 12 }, { id: 13 }]
  const controller = createEpisodeSwitchController({
    flushDraft: async () => events.push('flush'),
    resolveEpisode: (id) => episodes.find((episode) => episode.id === Number(id)) || null,
    commitEpisode: (episode) => events.push(`commit:${episode.id}`),
    refreshEpisode: async (id) => {
      events.push(`refresh:${id}`)
      if (id === 12) await firstRefresh
    },
    onBusyChange: (busy) => events.push(`busy:${busy}`),
  })

  const first = controller.select(12)
  await new Promise((resolve) => setImmediate(resolve))
  const second = controller.select(13)
  releaseFirstRefresh()
  await Promise.all([first, second])

  assert.deepEqual(events, [
    'busy:true',
    'flush',
    'commit:12',
    'refresh:12',
    'flush',
    'commit:13',
    'refresh:13',
    'busy:false',
  ])
})


test('草稿只按剧集 id 更新，不会把 episode_number 当成同一主键', () => {
  const episodes = [
    { id: 2, episode_number: 1, title: 'First', script_content: 'A', duration: 2 },
    { id: 5, episode_number: 2, title: 'Second', script_content: 'B', duration: 3 },
  ]
  const payload = buildEpisodeDraftPayload(episodes, {
    dramaId: 9,
    episodeId: 2,
    episodeNumber: 2,
    title: 'First edited',
    content: 'A edited',
  })
  assert.equal(payload.length, 2)
  assert.equal(payload[0].title, 'First edited')
  assert.equal(payload[0].script_content, 'A edited')
  assert.equal(payload[1].title, 'Second')
  assert.equal(payload[1].script_content, 'B')
})

test('字符串剧集 id 与数字 id 视为同一集，空列表不会误造新剧集', () => {
  const episodes = [
    { id: '12', episode_number: '1', title: 'One', script_content: 'A', duration: 1 },
  ]
  const updated = buildEpisodeDraftPayload(episodes, {
    episodeId: 12,
    episodeNumber: 1,
    title: 'One edited',
    content: 'A edited',
  })
  assert.equal(updated.length, 1)
  assert.equal(updated[0].title, 'One edited')

  const empty = buildEpisodeDraftPayload([], {
    episodeId: 12,
    episodeNumber: 1,
    title: 'Orphan',
    content: 'lost',
  })
  assert.deepEqual(empty, [])

  const byNumberOnly = buildEpisodeDraftPayload([], {
    episodeNumber: 3,
    title: 'New',
    content: 'N',
  })
  assert.equal(byNumberOnly.length, 1)
  assert.equal(byNumberOnly[0].episode_number, 3)
  assert.equal(byNumberOnly[0].title, 'New')
})
