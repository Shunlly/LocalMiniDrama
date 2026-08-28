import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const filmCreateSource = readFileSync(
  new URL('../src/views/FilmCreate.vue', import.meta.url),
  'utf8',
)
const scriptPersistenceSource = readFileSync(
  new URL('../src/composables/filmCreate/useFilmCreateScriptPersistence.js', import.meta.url),
  'utf8',
)
const filmCreateWithScriptSource = scriptPersistenceSource + '\n' + filmCreateSource
const storyGenerationSource = readFileSync(
  new URL('../src/composables/useStoryGeneration.js', import.meta.url),
  'utf8',
)

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`)
  return source.slice(start, end)
}

test('story generation draft is restored from dedicated metadata rather than project description', () => {
  const loader = sourceBetween(filmCreateSource, 'async function loadDrama({', 'async function retryFilmProjectLoad')

  assert.match(loader, /storyInput\.value\s*=\s*\(d\.metadata\?\.story_generation_draft\s*\|\|\s*''\)/)
  assert.doesNotMatch(loader, /storyInput\.value\s*=\s*\(d\.description\s*\|\|\s*''\)/)
})

test('saving a script never submits a generation request and keeps its draft out of project description', () => {
  const saveScript = sourceBetween(filmCreateWithScriptSource, 'async function saveScriptToBackend(content)', 'async function saveProjectSettings')

  assert.doesNotMatch(saveScript, /generationAPI\.generateStory/)
  assert.doesNotMatch(saveScript, /description:\s*storyInput\.value/)
  assert.doesNotMatch(saveScript, /summary:\s*storyInput\.value\.trim\(\)/)
  assert.match(saveScript, /story_generation_draft:\s*storyInput\.value\?\.trim\(\)/)
})

test('manual single-episode saves preserve the exact script body instead of stripping an episode heading', () => {
  const saveScript = sourceBetween(filmCreateWithScriptSource, 'async function saveScriptToBackend(content)', 'async function saveProjectSettings')

  assert.match(saveScript, /script_content:\s*trimmed/)
  assert.match(saveScript, /script_content:\s*isCurrent\s*\?\s*trimmed\s*:/)
})

test('only the explicit generate-story command can invoke story generation', () => {
  const explicitCommand = sourceBetween(filmCreateWithScriptSource, 'async function onGenerateStory()', 'function openSelectScriptDialog')

  assert.match(explicitCommand, /runGenerateStoryFromPremise\(/)
  assert.equal((filmCreateWithScriptSource.match(/runGenerateStoryFromPremise\(/g) || []).length, 1)
  assert.match(storyGenerationSource, /story_generation_draft:\s*text/)
  assert.doesNotMatch(storyGenerationSource, /summary:\s*text/)
})

test('failed automatic script saves offer save, leave, and cancel choices before navigation', () => {
  const navigation = sourceBetween(filmCreateSource, 'async function flushDraftBeforeNavigation()', 'async function confirmPipelineNavigation')

  assert.match(navigation, /confirmButtonText:\s*'保存并离开'/)
  assert.match(navigation, /cancelButtonText:\s*'仍然离开'/)
  assert.match(navigation, /distinguishCancelAndClose:\s*true/)
  assert.match(navigation, /await flushScriptDraft\(\)/)
})
