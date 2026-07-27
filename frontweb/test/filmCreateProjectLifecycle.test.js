import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  createProjectInstanceLifecycle,
  isProjectInstanceDisposedError,
} from '../src/utils/projectInstanceLifecycle.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const filmCreateSource = read('../src/views/FilmCreate.vue')
const characterSource = read('../src/composables/filmCreate/useCharacters.js')
const propSource = read('../src/composables/filmCreate/useProps.js')
const sceneSource = read('../src/composables/filmCreate/useScenes.js')

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('disposing project A prevents its delayed load from replacing project B or notifying', async () => {
  const request = deferred()
  const sharedStore = { drama: { id: 202 } }
  const notifications = []
  const lifecycle = createProjectInstanceLifecycle()
  const api = lifecycle.guardApi({ get: () => request.promise })
  const message = lifecycle.guardNotifier({
    success(value) {
      notifications.push(value)
      return { close() {} }
    },
  })

  const projectALoad = (async () => {
    try {
      const drama = await api.get(101)
      sharedStore.drama = drama
      message.success('project-a-loaded')
    } catch (error) {
      if (!isProjectInstanceDisposedError(error)) throw error
    }
  })()

  lifecycle.dispose()
  sharedStore.drama = { id: 202 }
  request.resolve({ id: 101 })
  await projectALoad

  assert.deepEqual(sharedStore.drama, { id: 202 })
  assert.deepEqual(notifications, [])
})
test('FilmCreate owns API, message, and load invalidation for its keyed project instance', () => {
  assert.match(filmCreateSource, /createProjectInstanceLifecycle/)
  assert.match(filmCreateSource, /const projectLifecycle = createProjectInstanceLifecycle\(\)/)
  assert.match(filmCreateSource, /const ElMessage = projectLifecycle\.guardNotifier\(RawElMessage\)/)

  for (const apiName of [
    'dramaAPI', 'timelinesAPI', 'generationAPI', 'characterAPI', 'propAPI', 'sceneAPI',
    'taskAPI', 'imagesAPI', 'videosAPI', 'storyboardsAPI', 'uploadAPI',
    'characterLibraryAPI', 'sceneLibraryAPI', 'propLibraryAPI',
  ]) {
    assert.match(
      filmCreateSource,
      new RegExp(`const ${apiName} = projectLifecycle\\.guardApi\\(raw[A-Z][A-Za-z]+API\\)`),
      `${apiName} must be owned by the project lifecycle`,
    )
  }

  assert.match(filmCreateSource, /const coreDramaAPI = projectLifecycle\.guardApi\(\{/)
  assert.match(
    filmCreateSource,
    /onBeforeUnmount\(\(\) => \{[\s\S]*projectLoadRequestId \+= 1[\s\S]*projectDependencyRequestId \+= 1[\s\S]*projectLifecycle\.dispose\(\)/,
  )
  assert.doesNotMatch(filmCreateSource, /watch\(\(\) => route\.params\.id,/)
})

test('FilmCreate resource composables receive the same project-owned dependencies', () => {
  assert.match(
    filmCreateSource,
    /useCharacters\(\{[\s\S]*ElMessage[\s\S]*characterAPI[\s\S]*characterLibraryAPI[\s\S]*generationAPI[\s\S]*uploadAPI[\s\S]*\}\)/,
  )
  assert.match(
    filmCreateSource,
    /usePropsComposable\(\{[\s\S]*ElMessage[\s\S]*propAPI[\s\S]*propLibraryAPI[\s\S]*uploadAPI[\s\S]*\}\)/,
  )
  assert.match(
    filmCreateSource,
    /useScenes\(\{[\s\S]*ElMessage[\s\S]*sceneAPI[\s\S]*sceneLibraryAPI[\s\S]*uploadAPI[\s\S]*\}\)/,
  )

  for (const source of [characterSource, propSource, sceneSource]) {
    assert.match(source, /ElMessage\s*=\s*RawElMessage/)
    assert.match(source, /API\s*=\s*raw[A-Z][A-Za-z]+API/)
  }
})
