import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEpisodeDraftPayload,
  createScriptDraftController,
  scriptDraftFingerprint,
} from '../src/utils/scriptDraft.js'

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
