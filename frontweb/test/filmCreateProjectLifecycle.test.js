import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  createProjectInstanceLifecycle,
  isProjectInstanceDisposedError,
} from '../src/utils/projectInstanceLifecycle.js'
import { useFilmCreateProjectLoad } from '../src/composables/filmCreate/useFilmCreateProjectLoad.js'
import { useCharacters } from '../src/composables/filmCreate/useCharacters.js'
import { useProps } from '../src/composables/filmCreate/useProps.js'
import { useScenes } from '../src/composables/filmCreate/useScenes.js'
import { remainingImportedFunctionSource } from './helpers/remainingSourceBetween.js'

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

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
  assert.equal(typeof createProjectInstanceLifecycle, 'function')
  assert.equal(typeof useFilmCreateProjectLoad, 'function')
  const loadSource = remainingImportedFunctionSource(useFilmCreateProjectLoad)
  assert.match(loadSource, /const coreDramaAPI = projectLifecycle\.guardApi\(\{/)
  assert.match(filmCreateSource, /createProjectInstanceLifecycle/)
  assert.match(filmCreateSource, /const projectLifecycle = createProjectInstanceLifecycle\(\)/)
  assert.match(filmCreateSource, /const ElMessage = projectLifecycle\.guardNotifier\(RawElMessage\)/)
  assert.match(
    filmCreateSource,
    /onBeforeUnmount\(\(\) => \{[\s\S]*invalidateProjectLoads\(\)[\s\S]*projectLifecycle\.dispose\(\)/,
  )
  assert.doesNotMatch(filmCreateSource, /watch\(\(\) => route\.params\.id,/)
})

test('FilmCreate resource composables receive the same project-owned dependencies', () => {
  const source = remainingImportedFunctionSource(useCharacters, useProps, useScenes)
  assert.match(source, /ElMessage = RawElMessage/)
  assert.match(source, /characterAPI = rawCharacterAPI/)
  assert.match(source, /propAPI = rawPropAPI/)
  assert.match(source, /sceneAPI = rawSceneAPI/)
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
})
