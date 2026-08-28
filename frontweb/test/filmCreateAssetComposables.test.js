import test from 'node:test'
import assert from 'node:assert/strict'

import { createPinia, setActivePinia } from 'pinia'
import { ElMessageBox } from 'element-plus'

import { useCharacters } from '../src/composables/filmCreate/useCharacters.js'
import { useProps } from '../src/composables/filmCreate/useProps.js'
import { useScenes } from '../src/composables/filmCreate/useScenes.js'

const PROJECT_ID = 7
const EPISODE_ID = 101
const OTHER_PROJECT_ID = 9
const OTHER_EPISODE_ID = 202

assert.notEqual(PROJECT_ID, EPISODE_ID)
assert.notEqual(OTHER_PROJECT_ID, OTHER_EPISODE_ID)

const originalConfirm = ElMessageBox.confirm

function unusedConfirm() {
  return Promise.reject(new Error('测试未配置删除确认'))
}

ElMessageBox.confirm = unusedConfirm

test.afterEach(() => {
  ElMessageBox.confirm = unusedConfirm
})

test.after(() => {
  ElMessageBox.confirm = originalConfirm
})

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function tracked(calls, prefix, overrides = {}) {
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      const impl = target[prop]
      return async (...args) => {
        calls.push({ name: `${prefix}.${String(prop)}`, args })
        if (typeof impl === 'function') return impl(...args)
        return {}
      }
    },
  })
}

function createMessages() {
  const messages = []
  return {
    messages,
    ElMessage: {
      success: (text) => messages.push({ type: 'success', text }),
      warning: (text) => messages.push({ type: 'warning', text }),
      error: (text) => messages.push({ type: 'error', text }),
      info: (text) => messages.push({ type: 'info', text }),
    },
  }
}

function createBase(options = {}) {
  setActivePinia(createPinia())
  const projectId = options.projectId === undefined ? PROJECT_ID : options.projectId
  const episodeId = options.episodeId === undefined ? EPISODE_ID : options.episodeId
  const storeProjectId = options.storeProjectId === undefined ? projectId : options.storeProjectId
  const { messages, ElMessage } = createMessages()
  const apiCalls = []
  const loadDramaCalls = []
  const pollTaskCalls = []
  const store = {
    dramaId: storeProjectId,
    scriptContent: options.scriptContent ?? '李华走进办公室，拿起桌上的钥匙。',
    drama: {
      id: storeProjectId,
      title: '短剧A',
      characters: [],
      props: [],
      scenes: [],
      episodes: episodeId == null ? [] : [{ id: episodeId, episode_number: 2, title: '第二集' }],
    },
    currentEpisode: episodeId == null
      ? null
      : { id: episodeId, episode_number: 2, characters: [], props: [], scenes: [] },
    characters: [],
    props: [],
    scenes: [],
  }
  return {
    store,
    dramaId: { value: projectId },
    currentEpisodeId: { value: episodeId },
    messages,
    apiCalls,
    loadDramaCalls,
    pollTaskCalls,
    common: {
      store,
      getSelectedStyle: () => 'cinematic',
      loadDrama: async (...args) => { loadDramaCalls.push(args) },
      pollTask: async (...args) => {
        pollTaskCalls.push(args)
        return options.pollResult ?? { status: 'completed' }
      },
      pollUntilResourceHasImage: async () => {},
      hasAssetImage: () => true,
      ElMessage,
    },
  }
}

function createCharacters(options = {}) {
  const base = createBase(options)
  const apis = options.apis || {}
  const chars = useCharacters({
    ...base.common,
    dramaId: base.dramaId,
    currentEpisodeId: base.currentEpisodeId,
    characterAPI: tracked(base.apiCalls, 'character', apis.characterAPI),
    characterLibraryAPI: tracked(base.apiCalls, 'characterLibrary', apis.characterLibraryAPI),
    dramaAPI: tracked(base.apiCalls, 'drama', apis.dramaAPI),
    generationAPI: tracked(base.apiCalls, 'generation', apis.generationAPI),
    uploadAPI: tracked(base.apiCalls, 'upload', apis.uploadAPI),
  })
  return { ...base, chars }
}

function createProps(options = {}) {
  const base = createBase(options)
  const apis = options.apis || {}
  const props = useProps({
    ...base.common,
    dramaId: base.dramaId,
    currentEpisodeId: base.currentEpisodeId,
    propAPI: tracked(base.apiCalls, 'prop', apis.propAPI),
    propLibraryAPI: tracked(base.apiCalls, 'propLibrary', apis.propLibraryAPI),
    uploadAPI: tracked(base.apiCalls, 'upload', apis.uploadAPI),
  })
  return { ...base, props }
}

function createScenes(options = {}) {
  const base = createBase(options)
  const apis = options.apis || {}
  const scenes = useScenes({
    ...base.common,
    dramaId: base.dramaId,
    currentEpisodeId: base.currentEpisodeId,
    scriptLanguage: options.scriptLanguage || { value: 'zh' },
    dramaAPI: tracked(base.apiCalls, 'drama', apis.dramaAPI),
    sceneAPI: tracked(base.apiCalls, 'scene', apis.sceneAPI),
    sceneLibraryAPI: tracked(base.apiCalls, 'sceneLibrary', apis.sceneLibraryAPI),
    uploadAPI: tracked(base.apiCalls, 'upload', apis.uploadAPI),
  })
  return { ...base, scenes }
}

function namedCalls(apiCalls, name) {
  return apiCalls.filter((call) => call.name === name)
}

function assertNoCalls(apiCalls) {
  assert.deepEqual(apiCalls, [])
}

function assertChineseError(messages, pattern) {
  const error = [...messages].reverse().find((item) => item.type === 'error')
  assert.ok(error, '应弹出中文错误提示')
  assert.match(String(error.text), /[\u4e00-\u9fff]/)
  if (pattern) assert.match(String(error.text), pattern)
}

function assertNoSwitchedIds(...payloads) {
  const text = JSON.stringify(payloads)
  assert.doesNotMatch(text, new RegExp(`\\b${OTHER_PROJECT_ID}\\b`))
  assert.doesNotMatch(text, new RegExp(`\\b${OTHER_EPISODE_ID}\\b`))
}

function stubConfirm(impl) {
  ElMessageBox.confirm = impl
}

test('filmCreateAssetComposables characters skip requests without dramaId or episode', async () => {
  const missingDrama = createCharacters({
    storeProjectId: null,
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
  })
  await missingDrama.chars.onGenerateCharacters()
  missingDrama.chars.openAddCharacter()
  missingDrama.chars.editCharacterForm.value.name = '李华'
  await missingDrama.chars.submitEditCharacter()
  await missingDrama.chars.onAddCharFromLibrary({ name: '王芳' })
  assertNoCalls(missingDrama.apiCalls)
  assert.equal(missingDrama.messages.length, 0)

  const missingEpisode = createCharacters({ episodeId: null })
  await missingEpisode.chars.onGenerateCharacters()
  await missingEpisode.chars.onAddCharFromLibrary({ name: '王芳' })
  assertNoCalls(missingEpisode.apiCalls)
  assert.equal(missingEpisode.messages[0].type, 'warning')
  assert.equal(missingEpisode.messages[0].text, '请先选择集次')
  assert.equal(missingEpisode.messages[1].type, 'warning')
  assert.equal(missingEpisode.messages[1].text, '请先选择本集')

  const missingDramaRef = createCharacters({
    storeProjectId: PROJECT_ID,
    projectId: null,
    episodeId: EPISODE_ID,
  })
  await missingDramaRef.chars.loadDramaAllCharList()
  assertNoCalls(missingDramaRef.apiCalls)
  assert.deepEqual(missingDramaRef.chars.dramaAllCharList.value, [])
})

test('filmCreateAssetComposables characters show Chinese ElMessage on generate and extract failure', async () => {
  const generateFail = createCharacters({
    apis: {
      generationAPI: {
        generateCharacters: async () => { throw new Error() },
      },
    },
  })
  await generateFail.chars.onGenerateCharacters()
  assert.equal(namedCalls(generateFail.apiCalls, 'generation.generateCharacters').length, 1)
  assertChineseError(generateFail.messages, /生成失败/)

  const extractFail = createCharacters({
    apis: {
      characterAPI: {
        extractFromImage: async () => { throw new Error('角色图不可用') },
      },
    },
  })
  extractFail.chars.editCharacter({
    id: 55,
    name: '李华',
    appearance: '短发',
    polished_prompt: '已有提示词',
  })
  await extractFail.chars.doExtractCharFromImage()
  assert.equal(namedCalls(extractFail.apiCalls, 'character.extractFromImage')[0].args[0], 55)
  assertChineseError(extractFail.messages, /角色图不可用/)
})

test('filmCreateAssetComposables characters keep dramaId and episodeId distinct across writes', async () => {
  const gate = deferred()
  const harness = createCharacters({
    apis: {
      generationAPI: {
        generateCharacters: async () => {
          await gate.promise
          return { task_id: 'char-task' }
        },
      },
    },
  })

  const pending = harness.chars.onGenerateCharacters()
  harness.store.dramaId = OTHER_PROJECT_ID
  harness.dramaId.value = OTHER_PROJECT_ID
  harness.currentEpisodeId.value = OTHER_EPISODE_ID
  harness.store.currentEpisode = { id: OTHER_EPISODE_ID, episode_number: 3 }
  gate.resolve()
  await pending

  const generate = namedCalls(harness.apiCalls, 'generation.generateCharacters')[0]
  assert.equal(namedCalls(harness.apiCalls, 'generation.generateCharacters').length, 1)
  assert.equal(generate.args[0], PROJECT_ID)
  assert.equal(generate.args[1].episode_id, EPISODE_ID)
  assert.notEqual(generate.args[0], generate.args[1].episode_id)
  assert.equal(harness.pollTaskCalls[0][0], 'char-task')
  assert.equal(harness.pollTaskCalls[0][2].dramaId, PROJECT_ID)
  assert.equal(harness.pollTaskCalls[0][2].episodeId, EPISODE_ID)
  assert.equal(harness.pollTaskCalls[0][2].resourceId, EPISODE_ID)
  assertNoSwitchedIds(harness.apiCalls, harness.pollTaskCalls.map((call) => [call[0], call[2]]))

  const addHarness = createCharacters()
  addHarness.chars.openAddCharacter()
  addHarness.chars.editCharacterForm.value.name = '李华'
  await addHarness.chars.submitEditCharacter()
  const saved = namedCalls(addHarness.apiCalls, 'drama.saveCharacters')[0]
  assert.equal(saved.args[0], PROJECT_ID)
  assert.equal(saved.args[1].episode_id, EPISODE_ID)
  assert.notEqual(saved.args[0], saved.args[1].episode_id)
  assert.equal(saved.args[1].characters[0].name, '李华')
})

test('filmCreateAssetComposables characters delete confirm failure stays Chinese and cancel skips API', async () => {
  const confirms = []
  const failHarness = createCharacters({
    apis: {
      characterAPI: {
        delete: async () => { throw new Error() },
      },
    },
  })
  stubConfirm(async (message, title, options) => {
    confirms.push({ message, title, options })
  })
  await failHarness.chars.onDeleteCharacter({ id: 55, name: '李华' })
  assert.equal(confirms.length, 1)
  assert.match(confirms[0].message, /李华/)
  assert.equal(confirms[0].options.confirmButtonText, '删除')
  assert.equal(namedCalls(failHarness.apiCalls, 'character.delete')[0].args[0], 55)
  assertChineseError(failHarness.messages, /删除失败/)

  const cancelHarness = createCharacters()
  stubConfirm(async () => { throw 'cancel' })
  await cancelHarness.chars.onDeleteCharacter({ id: 55, name: '李华' })
  assertNoCalls(cancelHarness.apiCalls)
  assert.equal(cancelHarness.messages.length, 0)
})

test('filmCreateAssetComposables props skip requests without dramaId or episode', async () => {
  const missingEpisode = createProps({ episodeId: null })
  await missingEpisode.props.onExtractProps()
  await missingEpisode.props.onAddPropFromLibrary({ name: '钥匙' })
  assertNoCalls(missingEpisode.apiCalls)
  assert.equal(missingEpisode.messages[0].type, 'warning')
  assert.equal(missingEpisode.messages[0].text, '请先完成剧本并保存')
  assert.equal(missingEpisode.messages[1].type, 'warning')
  assert.equal(missingEpisode.messages[1].text, '请先选择本集')

  const missingDrama = createProps({
    storeProjectId: null,
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
  })
  missingDrama.props.addPropForm.value.name = '钥匙'
  await missingDrama.props.submitAddProp()
  await missingDrama.props.onAddPropFromLibrary({ name: '钥匙' })
  assertNoCalls(missingDrama.apiCalls)
  assert.equal(missingDrama.messages[0].type, 'warning')
  assert.equal(missingDrama.messages[0].text, '请先选择本集')

  const missingDramaRef = createProps({
    storeProjectId: PROJECT_ID,
    projectId: null,
    episodeId: EPISODE_ID,
  })
  await missingDramaRef.props.loadDramaAllPropList()
  assertNoCalls(missingDramaRef.apiCalls)
  assert.deepEqual(missingDramaRef.props.dramaAllPropList.value, [])
})

test('filmCreateAssetComposables props show Chinese ElMessage on extract failure', async () => {
  const extractFail = createProps({
    apis: {
      propAPI: {
        extractFromScript: async () => { throw new Error() },
      },
    },
  })
  await extractFail.props.onExtractProps()
  assert.equal(namedCalls(extractFail.apiCalls, 'prop.extractFromScript')[0].args[0], EPISODE_ID)
  assertChineseError(extractFail.messages, /提取失败/)

  const imageFail = createProps({
    apis: {
      propAPI: {
        extractFromImage: async () => { throw new Error('道具图不可用') },
      },
    },
  })
  imageFail.props.editProp({
    id: 21,
    name: '钥匙',
    prompt: '已有提示词',
  })
  await imageFail.props.doExtractPropFromImage()
  assert.equal(namedCalls(imageFail.apiCalls, 'prop.extractFromImage')[0].args[0], 21)
  assertChineseError(imageFail.messages, /道具图不可用/)
})

test('filmCreateAssetComposables props keep dramaId and episodeId distinct across writes', async () => {
  const gate = deferred()
  const harness = createProps({
    apis: {
      propAPI: {
        extractFromScript: async () => {
          await gate.promise
          return { task_id: 'prop-task' }
        },
      },
    },
  })
  const pending = harness.props.onExtractProps()
  harness.store.dramaId = OTHER_PROJECT_ID
  harness.dramaId.value = OTHER_PROJECT_ID
  harness.currentEpisodeId.value = OTHER_EPISODE_ID
  harness.store.currentEpisode = { id: OTHER_EPISODE_ID, episode_number: 3 }
  gate.resolve()
  await pending

  const extracted = namedCalls(harness.apiCalls, 'prop.extractFromScript')[0]
  assert.equal(namedCalls(harness.apiCalls, 'prop.extractFromScript').length, 1)
  assert.equal(extracted.args[0], EPISODE_ID)
  assert.notEqual(extracted.args[0], PROJECT_ID)
  assert.equal(harness.pollTaskCalls[0][2].dramaId, PROJECT_ID)
  assert.equal(harness.pollTaskCalls[0][2].episodeId, EPISODE_ID)
  assertNoSwitchedIds(harness.apiCalls, harness.pollTaskCalls.map((call) => [call[0], call[2]]))

  const addHarness = createProps()
  addHarness.props.addPropForm.value.name = '钥匙'
  await addHarness.props.submitAddProp()
  const created = namedCalls(addHarness.apiCalls, 'prop.create')[0]
  assert.equal(created.args[0].drama_id, PROJECT_ID)
  assert.equal(created.args[0].episode_id, EPISODE_ID)
  assert.notEqual(created.args[0].drama_id, created.args[0].episode_id)
  assert.equal(created.args[0].name, '钥匙')
})

test('filmCreateAssetComposables props delete confirm failure stays Chinese and cancel skips API', async () => {
  const confirms = []
  const failHarness = createProps({
    apis: {
      propAPI: {
        delete: async () => { throw new Error() },
      },
    },
  })
  stubConfirm(async (message, title, options) => {
    confirms.push({ message, title, options })
  })
  await failHarness.props.onDeleteProp({ id: 21, name: '钥匙' })
  assert.equal(confirms.length, 1)
  assert.match(confirms[0].message, /钥匙/)
  assert.equal(namedCalls(failHarness.apiCalls, 'prop.delete')[0].args[0], 21)
  assertChineseError(failHarness.messages, /删除失败/)

  const cancelHarness = createProps()
  stubConfirm(async () => { throw 'cancel' })
  await cancelHarness.props.onDeleteProp({ id: 21, name: '钥匙' })
  assertNoCalls(cancelHarness.apiCalls)
  assert.equal(cancelHarness.messages.length, 0)
})

test('filmCreateAssetComposables scenes skip requests without dramaId or episode', async () => {
  const missingEpisode = createScenes({ episodeId: null })
  await missingEpisode.scenes.onExtractScenes()
  await missingEpisode.scenes.onAddSceneFromLibrary({ location: '办公室' })
  assertNoCalls(missingEpisode.apiCalls)
  assert.equal(missingEpisode.messages[0].type, 'warning')
  assert.equal(missingEpisode.messages[0].text, '请先选择本集')

  const missingDrama = createScenes({
    storeProjectId: null,
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
  })
  missingDrama.scenes.openAddScene()
  missingDrama.scenes.editSceneForm.value.location = '办公室'
  await missingDrama.scenes.submitEditScene()
  await missingDrama.scenes.onAddSceneFromLibrary({ location: '办公室' })
  assertNoCalls(missingDrama.apiCalls)
  assert.equal(missingDrama.messages[0].type, 'warning')
  assert.equal(missingDrama.messages[0].text, '请先选择本集')

  const missingDramaRef = createScenes({
    storeProjectId: PROJECT_ID,
    projectId: null,
    episodeId: EPISODE_ID,
  })
  await missingDramaRef.scenes.loadDramaAllSceneList()
  assertNoCalls(missingDramaRef.apiCalls)
  assert.deepEqual(missingDramaRef.scenes.dramaAllSceneList.value, [])
})

test('filmCreateAssetComposables scenes show Chinese ElMessage on extract failure', async () => {
  const extractFail = createScenes({
    apis: {
      dramaAPI: {
        extractBackgrounds: async () => { throw new Error() },
      },
    },
  })
  await extractFail.scenes.onExtractScenes()
  assert.equal(namedCalls(extractFail.apiCalls, 'drama.extractBackgrounds')[0].args[0], EPISODE_ID)
  assertChineseError(extractFail.messages, /提取失败/)

  const imageFail = createScenes({
    apis: {
      sceneAPI: {
        extractFromImage: async () => { throw new Error('场景图不可用') },
      },
    },
  })
  imageFail.scenes.editScene({
    id: 11,
    location: '办公室',
    polished_prompt: '已有提示词',
  })
  await imageFail.scenes.doExtractSceneFromImage()
  assert.equal(namedCalls(imageFail.apiCalls, 'scene.extractFromImage')[0].args[0], 11)
  assertChineseError(imageFail.messages, /场景图不可用/)
})

test('filmCreateAssetComposables scenes keep dramaId and episodeId distinct across writes', async () => {
  const gate = deferred()
  const harness = createScenes({
    apis: {
      dramaAPI: {
        extractBackgrounds: async () => {
          await gate.promise
          return { task_id: 'scene-task' }
        },
      },
    },
  })
  const pending = harness.scenes.onExtractScenes()
  harness.store.dramaId = OTHER_PROJECT_ID
  harness.dramaId.value = OTHER_PROJECT_ID
  harness.currentEpisodeId.value = OTHER_EPISODE_ID
  harness.store.currentEpisode = { id: OTHER_EPISODE_ID, episode_number: 3 }
  gate.resolve()
  await pending

  const extracted = namedCalls(harness.apiCalls, 'drama.extractBackgrounds')[0]
  assert.equal(namedCalls(harness.apiCalls, 'drama.extractBackgrounds').length, 1)
  assert.equal(extracted.args[0], EPISODE_ID)
  assert.notEqual(extracted.args[0], PROJECT_ID)
  assert.equal(harness.pollTaskCalls[0][2].dramaId, PROJECT_ID)
  assert.equal(harness.pollTaskCalls[0][2].episodeId, EPISODE_ID)
  assertNoSwitchedIds(harness.apiCalls, harness.pollTaskCalls.map((call) => [call[0], call[2]]))

  const addHarness = createScenes()
  addHarness.scenes.openAddScene()
  addHarness.scenes.editSceneForm.value.location = '办公室'
  await addHarness.scenes.submitEditScene()
  const created = namedCalls(addHarness.apiCalls, 'scene.create')[0]
  assert.equal(created.args[0].drama_id, PROJECT_ID)
  assert.equal(created.args[0].episode_id, EPISODE_ID)
  assert.notEqual(created.args[0].drama_id, created.args[0].episode_id)
  assert.equal(created.args[0].location, '办公室')
})

test('filmCreateAssetComposables scenes delete confirm failure stays Chinese and cancel skips API', async () => {
  const confirms = []
  const failHarness = createScenes({
    apis: {
      sceneAPI: {
        delete: async () => { throw new Error() },
      },
    },
  })
  stubConfirm(async (message, title, options) => {
    confirms.push({ message, title, options })
  })
  await failHarness.scenes.onDeleteScene({ id: 11, location: '办公室' })
  assert.equal(confirms.length, 1)
  assert.match(confirms[0].message, /办公室/)
  assert.equal(namedCalls(failHarness.apiCalls, 'scene.delete')[0].args[0], 11)
  assertChineseError(failHarness.messages, /删除失败/)

  const cancelHarness = createScenes()
  stubConfirm(async () => { throw 'cancel' })
  await cancelHarness.scenes.onDeleteScene({ id: 11, location: '办公室' })
  assertNoCalls(cancelHarness.apiCalls)
  assert.equal(cancelHarness.messages.length, 0)
})