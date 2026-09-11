import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildDramaCanvasGraph } from '../src/utils/dramaCanvasAdapter.js'
import { resolveCanvasAudioJobs, runAudioStep } from '../src/composables/useCanvasWorkflowRunner.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('canvas audio jobs keep dialogue and narration as separate TTS kinds', () => {
  const both = resolveCanvasAudioJobs({
    dialogue: ' 你好 ',
    narration: '夜色降临',
  })
  assert.deepEqual(both.map((job) => [job.ttsKind, job.text, job.skipReason]), [
    ['dialogue', '你好', '无对白'],
    ['narration', '夜色降临', '无解说旁白'],
  ])

  const narrationOnly = resolveCanvasAudioJobs({ narration: '开场解说' }, 'narration')
  assert.equal(narrationOnly.length, 1)
  assert.equal(narrationOnly[0].ttsKind, 'narration')
  assert.equal(resolveCanvasAudioJobs({ dialogue: '' }, 'dialogue')[0].text, '')
})

test('audio step posts narration separately and does not skip a narration-only storyboard', async () => {
  const posted = []
  const result = await runAudioStep(
    { id: 11, narration: '开场解说' },
    {
      postRequest: async (url, body) => {
        posted.push({ url, body })
      },
    },
  )
  assert.equal(result.skipped, false)
  assert.deepEqual(result.kinds, ['narration'])
  assert.equal(posted[0].url, '/audio/extract')
  assert.equal(posted[0].body.tts_kind, 'narration')
  assert.equal(posted[0].body.text, '开场解说')
  assert.equal(posted[0].body.storyboard_id, 11)

  const both = await runAudioStep(
    { id: 12, dialogue: '你好', narration: '夜色降临' },
    {
      postRequest: async (url, body) => posted.push(body),
    },
  )
  assert.deepEqual(both.kinds, ['dialogue', 'narration'])
})

test('drama canvas graph renders a narration audio node without replacing dialogue audio', () => {
  const graph = buildDramaCanvasGraph({
    episodes: [{
      id: 1,
      storyboards: [{
        id: 9,
        storyboard_number: 1,
        audio_local_path: 'audio/dialogue.mp3',
        narration_audio_local_path: 'audio/narration.mp3',
      }],
    }],
  })
  const ids = graph.nodes.map((node) => node.id)
  assert.equal(ids.includes('sbaud:9:dialogue'), true)
  assert.equal(ids.includes('sbaud:9:narration'), true)
  const narration = graph.nodes.find((node) => node.id === 'sbaud:9:narration')
  assert.equal(narration.data.audioType, 'narration')
  assert.match(String(narration.data.url || ''), /narration/)
})

test('storyboard panel generates all tracks while media panel regenerates the selected track', () => {
  const storyboard = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
  const media = read('../src/components/dramaCanvas/CanvasMediaPanel.vue')
  assert.match(storyboard, /runAudioStep\(sb, \{ signal: generationRun\.signal, kind: 'all' \}\)/)
  assert.match(media, /kind: props\.audioType === 'narration' \? 'narration' : 'dialogue'/)
})

test('canvas storyboard form edits and saves narration with dialogue', () => {
  const form = read('../src/components/dramaCanvas/CanvasStoryboardPanelForm.vue')
  const panel = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
  assert.match(form, /v-model="form.narration"/)
  assert.match(form, /storyboardControlLabel\('解说旁白'\)/)
  assert.match(panel, /narration: '',/)
  assert.match(panel, /form.narration = sb\?\.narration/)
  assert.match(panel, /narration: draft.narration.trim\(\) \|\| null/)
})

test('canvas storyboard panel reuses list-mode reorder helpers for up, down and insert-before', () => {
  const panel = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
  const actions = read('../src/components/dramaCanvas/CanvasStoryboardPanelActions.vue')
  assert.match(panel, /runStoryboardReorder/)
  assert.match(panel, /storyboardsAPI.insertBefore/)
  assert.match(panel, /moveStoryboardUp/)
  assert.match(actions, />上移</)
  assert.match(actions, />下移</)
  assert.match(actions, />前插</)
})
