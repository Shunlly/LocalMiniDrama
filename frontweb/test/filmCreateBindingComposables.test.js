import test from 'node:test'
import assert from 'node:assert/strict'

import { effectScope, nextTick, ref } from 'vue'

import { useFilmCreateStoryboardBindings } from '../src/composables/filmCreate/useFilmCreateStoryboardBindings.js'
import { useFilmCreateStoryboardStateSync } from '../src/composables/filmCreate/useFilmCreateStoryboardStateSync.js'
import { useFilmCreateRefImageDrop } from '../src/composables/filmCreate/useFilmCreateRefImageDrop.js'
import { useFilmCreateAiConfigWorkspace } from '../src/composables/filmCreate/useFilmCreateAiConfigWorkspace.js'
import {
  createLibraryMembershipState,
  hasAssetInLibrary,
  loadLibraryMembership,
  markAssetInLibrary,
} from '../src/composables/filmCreate/libraryMembership.js'
import { getOperationLogs, resetOperationLogs } from '../src/utils/operationLog.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
const STORYBOARD_ID = 77
const DUP_STORYBOARD_ID = 202
const OTHER_STORYBOARD_ID = 303
const EXTRA_STORYBOARD_ID = 404
const CHAR_ID = 5
const OTHER_CHAR_ID = 6
const PROP_ID = 9
const SCENE_ID = 8
const VIDEO_REF_IMAGE_ID = 88

assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(DRAMA_ID, STORYBOARD_ID)
assert.notEqual(EPISODE_ID, STORYBOARD_ID)

const originalFetch = globalThis.fetch
const originalFileReader = globalThis.FileReader

function refOf(value) {
  return { value }
}

function assertDistinctIds(dramaId, episodeId) {
  assert.notEqual(dramaId, episodeId)
}

function assertChinese(text) {
  const value = String(text || '')
  assert.match(value, /[\u4e00-\u9fff]/, `失败路径必须是中文，实际为：${value}`)
}

function assertPipelineStopIsCancel() {
  for (const event of getOperationLogs()) {
    const action = String(event?.details?.action || event?.action || '')
    if (action.includes('pipeline_stop_complete')) {
      assert.equal(event.phase, 'cancel')
    }
  }
}

function rejectNetwork(label) {
  return async (...args) => {
    throw new Error(`${label} 不应发起真实网络请求：${JSON.stringify(args)}`)
  }
}

async function flushUi() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
}

async function waitFor(predicate, label) {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return
    await flushUi()
  }
  assert.fail(label)
}

test.beforeEach(() => {
  resetOperationLogs()
  globalThis.fetch = async (url) => {
    throw new Error(`不应请求 ${String(url)}`)
  }
  globalThis.FileReader = class StubFileReader {
    readAsDataURL(file) {
      this.onload?.({
        target: { result: `data:${file?.type || 'image/png'};base64,Zg==` },
      })
    }
  }
})

test.afterEach(() => {
  assertPipelineStopIsCancel()
  globalThis.fetch = originalFetch
  if (originalFileReader === undefined) delete globalThis.FileReader
  else globalThis.FileReader = originalFileReader
})

function createBindings() {
  const updates = []
  const settings = []
  let failUpdate = false
  const sbCharacterIds = refOf({})
  const sbPropIds = refOf({})
  const sbSceneId = refOf({ [STORYBOARD_ID]: SCENE_ID })
  const characters = refOf([
    { id: CHAR_ID, name: '李华' },
    { id: OTHER_CHAR_ID, name: '同事' },
  ])
  const props = refOf([{ id: PROP_ID, name: '钥匙' }])
  const scenes = refOf([{ id: SCENE_ID, name: '办公室' }])
  const storyboards = refOf([
    {
      id: STORYBOARD_ID,
      storyboard_number: 1,
      characters: [{ id: CHAR_ID }],
      scene_id: SCENE_ID,
      prop_ids: [PROP_ID],
      drama_id: DRAMA_ID,
      episode_id: EPISODE_ID,
    },
    {
      id: DUP_STORYBOARD_ID,
      storyboard_number: 1,
      characters: [CHAR_ID],
      scene_id: SCENE_ID,
      prop_ids: [PROP_ID],
      drama_id: DRAMA_ID,
      episode_id: EPISODE_ID,
    },
    {
      id: OTHER_STORYBOARD_ID,
      storyboard_number: 2,
      characters: [{ id: OTHER_CHAR_ID }],
      scene_id: 99,
      prop_ids: [1],
      drama_id: DRAMA_ID,
      episode_id: EPISODE_ID,
    },
    {
      id: EXTRA_STORYBOARD_ID,
      storyboard_number: 0,
      characters: [CHAR_ID],
      scene_id: SCENE_ID,
      prop_ids: [PROP_ID],
      drama_id: DRAMA_ID,
      episode_id: EPISODE_ID,
    },
  ])
  const api = useFilmCreateStoryboardBindings({
    storyboards,
    characters,
    props,
    scenes,
    storyboardsAPI: {
      async update(id, payload) {
        updates.push({ id, payload })
        if (failUpdate) throw new Error('保存角色失败：权限不足')
      },
    },
    sbCharacterIds,
    sbPropIds,
    sbSceneId,
    saveProjectSettings() {
      settings.push({ dramaId: DRAMA_ID, episodeId: EPISODE_ID })
    },
  })
  return {
    api,
    updates,
    settings,
    sbCharacterIds,
    sbPropIds,
    sbSceneId,
    setFailUpdate(next) {
      failUpdate = next
    },
  }
}

test('分镜绑定会把运镜标签和已选资源映射成中文，且不把 dramaId 当成 episodeId', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const ctx = createBindings()
  assert.equal(ctx.api.getMovementLabel('push'), '推镜')
  assert.equal(ctx.api.getMovementLabel('hitchcock_zoom'), '希区柯克')
  assert.equal(ctx.api.getMovementLabel(''), '')
  assert.equal(ctx.api.getMovementLabel('unknown-move'), 'unknown-move')

  const emptyA = ctx.api.getSbCharacterIds(STORYBOARD_ID)
  const emptyB = ctx.api.getSbPropIds(STORYBOARD_ID)
  assert.equal(emptyA, ctx.api.getSbCharacterIds(OTHER_STORYBOARD_ID))
  assert.equal(emptyB, ctx.api.getSbPropIds(DUP_STORYBOARD_ID))
  assert.deepEqual(emptyA, [])
  assert.deepEqual(emptyB, [])

  ctx.api.setSbCharacterIds(STORYBOARD_ID, [CHAR_ID])
  await Promise.resolve()
  assert.deepEqual(ctx.api.getSbCharacterIds(STORYBOARD_ID), [CHAR_ID])
  assert.deepEqual(ctx.api.getSbSelectedCharacters(STORYBOARD_ID).map((item) => item.name), ['李华'])
  assert.deepEqual(
    ctx.api.charactersAvailableToAddToSb(STORYBOARD_ID).map((item) => item.id),
    [OTHER_CHAR_ID],
  )
  ctx.api.onSbAddCharacterCommand(STORYBOARD_ID, String(OTHER_CHAR_ID))
  ctx.api.onSbAddCharacterCommand(STORYBOARD_ID, '不是数字')
  ctx.api.onSbAddCharacterCommand(STORYBOARD_ID, OTHER_CHAR_ID)
  await Promise.resolve()
  assert.deepEqual(ctx.api.getSbCharacterIds(STORYBOARD_ID), [CHAR_ID, OTHER_CHAR_ID])
  assert.equal(ctx.updates[0].id, STORYBOARD_ID)
  assert.notEqual(ctx.updates[0].id, DRAMA_ID)
  assert.notEqual(ctx.updates[0].id, EPISODE_ID)
  assert.deepEqual(ctx.updates[0].payload.character_ids, [CHAR_ID])
  assert.deepEqual(ctx.updates.at(-1).payload.character_ids, [CHAR_ID, OTHER_CHAR_ID])

  ctx.api.setSbPropIds(STORYBOARD_ID, [PROP_ID])
  await Promise.resolve()
  assert.deepEqual(ctx.api.getSbSelectedProps(STORYBOARD_ID).map((item) => item.name), ['钥匙'])
  assert.equal(ctx.api.getSbSelectedScene(STORYBOARD_ID).name, '办公室')
  ctx.api.onStoryboardSceneChange(STORYBOARD_ID)
  await Promise.resolve()
  assert.equal(ctx.updates.at(-1).payload.scene_id, SCENE_ID)
  assert.notEqual(SCENE_ID, DRAMA_ID)
  assert.notEqual(SCENE_ID, EPISODE_ID)
})

test('分镜绑定保存失败走中文警告，并按镜号去重受影响分镜', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const ctx = createBindings()
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  const originalDocument = globalThis.document
  const scrolled = []
  globalThis.document = {
    getElementById(id) {
      if (id !== `sb-${STORYBOARD_ID}`) return null
      return {
        scrollIntoView(opts) {
          scrolled.push({ id, opts })
        },
      }
    },
  }
  try {
    ctx.setFailUpdate(true)
    ctx.api.setSbCharacterIds(STORYBOARD_ID, [CHAR_ID])
    await flushUi()
    assert.equal(ctx.sbCharacterIds.value[STORYBOARD_ID][0], CHAR_ID)
    assert.equal(warnings.length, 1)
    assert.match(String(warnings[0][0]), /保存角色失败/)
    assertChinese(warnings[0][0])
    assert.equal(String(warnings[0][1].message), '保存角色失败：权限不足')
    assertChinese(warnings[0][1].message)

    const charAffected = ctx.api.getCharAffectedStoryboards(CHAR_ID)
    assert.deepEqual(charAffected.map((sb) => sb.id), [EXTRA_STORYBOARD_ID, DUP_STORYBOARD_ID])
    assert.equal(charAffected.some((sb) => sb.id === STORYBOARD_ID), false)
    assert.deepEqual(
      ctx.api.getSceneAffectedStoryboards(SCENE_ID).map((sb) => sb.id),
      [EXTRA_STORYBOARD_ID, DUP_STORYBOARD_ID],
    )
    assert.deepEqual(
      ctx.api.getPropAffectedStoryboards(PROP_ID).map((sb) => sb.id),
      [EXTRA_STORYBOARD_ID, DUP_STORYBOARD_ID],
    )
    assert.deepEqual(
      ctx.api.getCharAffectedStoryboards(OTHER_CHAR_ID).map((sb) => sb.id),
      [OTHER_STORYBOARD_ID],
    )
    assert.equal(ctx.api.dedupeStoryboardsForAssetLink(null).length, 0)

    ctx.api.onLastFrameLayoutLockChange()
    assert.equal(ctx.settings.length, 1)
    assert.equal(ctx.settings[0].dramaId, DRAMA_ID)
    assert.equal(ctx.settings[0].episodeId, EPISODE_ID)
    assert.notEqual(ctx.settings[0].dramaId, ctx.settings[0].episodeId)

    ctx.api.scrollToStoryboard(STORYBOARD_ID)
    ctx.api.scrollToStoryboard(DUP_STORYBOARD_ID)
    assert.equal(scrolled.length, 1)
    assert.deepEqual(scrolled[0].opts, { behavior: 'smooth', block: 'center' })
  } finally {
    console.warn = originalWarn
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})

function createStateMaps(seed = '旧值') {
  return {
    sbCharacterIds: refOf({ leftover: [seed] }),
    sbPropIds: refOf({ leftover: [seed] }),
    sbSceneId: refOf({ leftover: seed }),
    sbDialogue: refOf({ leftover: seed }),
    sbNarration: refOf({ leftover: seed }),
    sbShotType: refOf({ leftover: seed }),
    sbTitle: refOf({ leftover: seed }),
    sbLocation: refOf({ leftover: seed }),
    sbTime: refOf({ leftover: seed }),
    sbDuration: refOf({ leftover: seed }),
    sbAction: refOf({ leftover: seed }),
    sbResult: refOf({ leftover: seed }),
    sbAtmosphere: refOf({ leftover: seed }),
    sbAngle: refOf({ leftover: seed }),
    sbAngleH: refOf({ leftover: seed }),
    sbAngleV: refOf({ leftover: seed }),
    sbAngleS: refOf({ leftover: seed }),
    sbMovement: refOf({ leftover: seed }),
    sbLighting: refOf({ leftover: seed }),
    sbDof: refOf({ leftover: seed }),
    sbLayoutDescription: refOf({ leftover: seed }),
    sbCreationMode: refOf({ leftover: seed }),
    sbUniversalSegmentText: refOf({ leftover: seed }),
    sbVideoReferenceImageId: refOf({ leftover: seed }),
  }
}

test('分镜状态同步会把剧集字段映射到本地状态，且 dramaId 与 episodeId 不相等', () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const maps = createStateMaps()
  const { syncStoryboardStateFromEpisode } = useFilmCreateStoryboardStateSync(maps)
  syncStoryboardStateFromEpisode({
    id: EPISODE_ID,
    drama_id: DRAMA_ID,
    storyboards: [
      {
        id: STORYBOARD_ID,
        scene_id: SCENE_ID,
        dialogue: null,
        narration: '旁白',
        shot_type: 'close',
        title: '推门',
        location: '办公室',
        time: '日',
        duration: 0,
        action: '推门',
        result: '进入',
        atmosphere: '紧张',
        angle: 'eye',
        angle_h: 'front',
        movement: 'push',
        lighting_style: 'soft',
        depth_of_field: 'shallow',
        layout_description: '左角色',
        characters: [{ id: CHAR_ID }, String(OTHER_CHAR_ID), { id: '坏数据' }],
        prop_ids: [PROP_ID],
        creation_mode: 'universal',
        universal_segment_text: '片段描述',
        video_reference_image_id: VIDEO_REF_IMAGE_ID,
      },
      {
        id: OTHER_STORYBOARD_ID,
        characters: CHAR_ID,
        creation_mode: 'UNIVERSAL',
        video_reference_image_id: 0,
      },
    ],
  })

  assert.equal(maps.sbDialogue.value[STORYBOARD_ID], '')
  assert.equal(maps.sbNarration.value[STORYBOARD_ID], '旁白')
  assert.equal(maps.sbDuration.value[STORYBOARD_ID], 0)
  assert.equal(maps.sbDuration.value[OTHER_STORYBOARD_ID], 5)
  assert.deepEqual(maps.sbCharacterIds.value[STORYBOARD_ID], [CHAR_ID, OTHER_CHAR_ID])
  assert.deepEqual(maps.sbCharacterIds.value[OTHER_STORYBOARD_ID], [CHAR_ID])
  assert.equal(maps.sbCreationMode.value[STORYBOARD_ID], 'universal')
  assert.equal(maps.sbCreationMode.value[OTHER_STORYBOARD_ID], 'classic')
  assert.equal(maps.sbVideoReferenceImageId.value[STORYBOARD_ID], VIDEO_REF_IMAGE_ID)
  assert.equal(maps.sbVideoReferenceImageId.value[OTHER_STORYBOARD_ID], '')
  assert.equal(maps.sbSceneId.value[STORYBOARD_ID], SCENE_ID)
  assert.equal(maps.sbPropIds.value[STORYBOARD_ID][0], PROP_ID)
  assert.equal(maps.sbTitle.value[STORYBOARD_ID], '推门')
  assert.equal('leftover' in maps.sbTitle.value, false)
  assert.notEqual(EPISODE_ID, DRAMA_ID)
  assert.notEqual(maps.sbVideoReferenceImageId.value[STORYBOARD_ID], EPISODE_ID)
})

test('分镜状态同步在空剧集时整体替换旧状态，而不是合并残留', () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const maps = createStateMaps('残留')
  const { syncStoryboardStateFromEpisode } = useFilmCreateStoryboardStateSync(maps)
  syncStoryboardStateFromEpisode({
    id: EPISODE_ID,
    drama_id: DRAMA_ID,
    storyboards: [{ id: STORYBOARD_ID, title: '只留这一条' }],
  })
  assert.equal(maps.sbTitle.value[STORYBOARD_ID], '只留这一条')
  assert.equal(maps.sbCreationMode.value[STORYBOARD_ID], 'classic')
  syncStoryboardStateFromEpisode({ id: EPISODE_ID, drama_id: DRAMA_ID, storyboards: [] })
  assert.deepEqual(maps.sbTitle.value, {})
  assert.deepEqual(maps.sbCharacterIds.value, {})
  assert.deepEqual(maps.sbDuration.value, {})
  syncStoryboardStateFromEpisode(null)
  assert.deepEqual(maps.sbNarration.value, {})
  assert.deepEqual(maps.sbVideoReferenceImageId.value, {})
})

function createDropApi(overrides = {}) {
  const messages = []
  const resourceUploads = []
  const sbUploads = []
  const addCharRefImage = refOf(null)
  const addPropRefImage = refOf(null)
  const addSceneRefImage = refOf(null)
  const addPropAddRefImage = refOf(null)
  const extractingCharAppearance = refOf(false)
  const extractingPropDesc = refOf(false)
  const extractingSceneDesc = refOf(false)
  const editCharacterForm = refOf({ name: '李华', appearance: '' })
  const editPropForm = refOf({ name: '钥匙', description: '' })
  const editSceneForm = refOf({ name: '办公室', description: '' })
  const dragOverResourceKey = refOf(null)
  const dragOverSbId = refOf(null)
  const api = useFilmCreateRefImageDrop({
    ElMessage: {
      success(message) { messages.push({ type: 'success', message }) },
      error(message) { messages.push({ type: 'error', message }) },
    },
    uploadAPI: {
      extractDescriptionFromImage: overrides.extractDescriptionFromImage || rejectNetwork('uploadAPI.extractDescriptionFromImage'),
      list: rejectNetwork('uploadAPI.list'),
    },
    addCharRefImage,
    addPropRefImage,
    addSceneRefImage,
    addPropAddRefImage,
    extractingCharAppearance,
    extractingPropDesc,
    extractingSceneDesc,
    editCharacterForm,
    editPropForm,
    editSceneForm,
    dragOverResourceKey,
    dragOverSbId,
    doUploadResourceImage(type, id, file) {
      resourceUploads.push({ type, id, file, dramaId: DRAMA_ID, episodeId: EPISODE_ID })
    },
    doUploadSbImage(id, file) {
      sbUploads.push({ id, file, dramaId: DRAMA_ID, episodeId: EPISODE_ID })
    },
  })
  return {
    api,
    messages,
    resourceUploads,
    sbUploads,
    addCharRefImage,
    addPropRefImage,
    addSceneRefImage,
    addPropAddRefImage,
    extractingCharAppearance,
    extractingPropDesc,
    extractingSceneDesc,
    editCharacterForm,
    editPropForm,
    editSceneForm,
    dragOverResourceKey,
    dragOverSbId,
  }
}

function imageFile(name = 'ref.png') {
  return { type: 'image/png', name }
}

function dragEvent(files, extras = {}) {
  return {
    preventDefault() { this.prevented = true },
    stopPropagation() { this.stopped = true },
    dataTransfer: { files, dropEffect: '' },
    ...extras,
  }
}

test('参考图拖放会把本地预览写入对应表单，且不发起网络请求', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const ctx = createDropApi()
  const charInput = { files: [imageFile('char.png')], value: 'char.png' }
  await ctx.api.onRefImageFileChange('character', { target: charInput })
  assert.equal(ctx.addCharRefImage.value.filename, 'char.png')
  assert.match(ctx.addCharRefImage.value.dataUrl, /^data:image\/png;base64,/)
  assert.equal(charInput.value, '')

  await ctx.api.onRefImageDrop('prop', dragEvent([imageFile('prop.png')]))
  await ctx.api.onRefImageDrop('scene', dragEvent([{ type: 'text/plain', name: 'note.txt' }]))
  const addPropInput = { files: [imageFile('add-prop.png')], value: 'x' }
  await ctx.api.onRefImageFileChange2('addProp', { target: addPropInput })
  assert.equal(ctx.addPropAddRefImage.value.filename, 'add-prop.png')
  assert.equal(addPropInput.value, '')
  await ctx.api.onRefImageDrop2('addProp', dragEvent([imageFile('drop-prop.png')]))
  assert.equal(ctx.addPropRefImage.value.filename, 'prop.png')
  assert.equal(ctx.addSceneRefImage.value, null)
  assert.equal(ctx.addPropAddRefImage.value.filename, 'drop-prop.png')
  assert.equal(ctx.api.getFirstImageFile({ files: [{ type: 'text/plain' }, imageFile('second.png')] }).name, 'second.png')
  assert.equal(ctx.api.getFirstImageFile({ files: [] }), null)
})

test('参考图特征提取成功和失败都使用中文提示，拖放资源时带上不相等的项目/剧集 id', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  let extractImpl = async (type) => {
    throw new Error(`${type} 提取不应在此用例调用`)
  }
  const ctx = createDropApi({
    async extractDescriptionFromImage(type, dataUrl, name) {
      return extractImpl(type, dataUrl, name)
    },
  })

  await ctx.api.doExtractFromRef('character')
  assert.equal(ctx.extractingCharAppearance.value, false)
  assert.equal(ctx.messages.length, 0)

  ctx.addCharRefImage.value = { dataUrl: 'data:image/png;base64,QQ==', filename: 'char.png' }
  extractImpl = async (type, dataUrl, name) => {
    assert.equal(type, 'character')
    assert.equal(name, '李华')
    assert.match(dataUrl, /^data:image\/png/)
    return { description: '短发，白衬衫' }
  }
  await ctx.api.doExtractFromRef('character')
  assert.equal(ctx.editCharacterForm.value.appearance, '短发，白衬衫')
  assert.equal(ctx.messages.at(-1).type, 'success')
  assert.equal(ctx.messages.at(-1).message, '已从参考图提取外貌描述')
  assertChinese(ctx.messages.at(-1).message)
  assert.equal(ctx.extractingCharAppearance.value, false)

  ctx.addPropRefImage.value = { dataUrl: 'data:image/png;base64,Qg==', filename: 'prop.png' }
  extractImpl = async () => {
    throw new Error('提取失败：视觉模型未配置')
  }
  await ctx.api.doExtractFromRef('prop')
  assert.equal(ctx.messages.at(-1).type, 'error')
  assert.equal(ctx.messages.at(-1).message, '提取失败：视觉模型未配置')
  assertChinese(ctx.messages.at(-1).message)
  assert.equal(ctx.extractingPropDesc.value, false)

  ctx.addSceneRefImage.value = { dataUrl: 'data:image/png;base64,Qw==', filename: 'scene.png' }
  extractImpl = async () => {
    throw new Error('')
  }
  await ctx.api.doExtractFromRef('scene')
  assert.equal(ctx.messages.at(-1).message, '提取失败，请检查 AI 配置中是否有支持视觉的模型')
  assertChinese(ctx.messages.at(-1).message)
  assert.equal(ctx.extractingSceneDesc.value, false)

  const over = dragEvent([imageFile('res.png')])
  ctx.api.onResourceDragOver(over, 'character', CHAR_ID)
  assert.equal(over.prevented, true)
  assert.equal(ctx.dragOverResourceKey.value, `char-${CHAR_ID}`)
  ctx.api.onResourceDragLeave(
    { preventDefault() {}, relatedTarget: {}, currentTarget: { contains: () => true } },
    `char-${CHAR_ID}`,
  )
  assert.equal(ctx.dragOverResourceKey.value, `char-${CHAR_ID}`)
  ctx.api.onResourceDrop(dragEvent([imageFile('res.png')]), 'character', CHAR_ID)
  assert.equal(ctx.dragOverResourceKey.value, null)
  assert.equal(ctx.resourceUploads[0].id, CHAR_ID)
  assert.notEqual(ctx.resourceUploads[0].dramaId, ctx.resourceUploads[0].episodeId)

  ctx.api.onSbImageDragOver(dragEvent([imageFile('sb.png')]), STORYBOARD_ID)
  assert.equal(ctx.dragOverSbId.value, STORYBOARD_ID)
  ctx.api.onSbImageDrop(dragEvent([imageFile('sb.png')]), { id: STORYBOARD_ID })
  ctx.api.onSbImageDrop(dragEvent([imageFile('sb.png')]), { id: 0 })
  assert.equal(ctx.sbUploads.length, 1)
  assert.equal(ctx.sbUploads[0].id, STORYBOARD_ID)
  assert.notEqual(ctx.sbUploads[0].id, DRAMA_ID)
  assert.notEqual(ctx.sbUploads[0].id, EPISODE_ID)
})

function createAiWorkspace() {
  const messages = []
  const cacheInvalidations = []
  const videoRefresh = []
  const readinessRefresh = []
  const focuses = []
  const showAiConfigDialog = ref(false)
  const aiConfigContentRef = ref(null)
  const pipelinePanelRef = ref({
    focusSummary() {
      focuses.push({ dramaId: DRAMA_ID, episodeId: EPISODE_ID })
    },
  })
  const aiConfigInitialServiceType = ref('old')
  const aiConfigChanged = ref(true)
  const aiConfigOpenedFromPipelineAction = ref(true)
  const api = useFilmCreateAiConfigWorkspace({
    ElMessage: {
      info(message) { messages.push({ type: 'info', message }) },
      error(message) { messages.push({ type: 'error', message }) },
    },
    showAiConfigDialog,
    aiConfigContentRef,
    pipelinePanelRef,
    aiConfigInitialServiceType,
    aiConfigChanged,
    aiConfigOpenedFromPipelineAction,
    invalidateActiveVideoAiConfigCache() {
      cacheInvalidations.push({ dramaId: DRAMA_ID, episodeId: EPISODE_ID })
    },
    async refreshVideoGenerationCapability() {
      videoRefresh.push({ dramaId: DRAMA_ID, episodeId: EPISODE_ID })
    },
    async refreshProductionReadiness() {
      readinessRefresh.push({ dramaId: DRAMA_ID, episodeId: EPISODE_ID })
      throw new Error('就绪检查失败：网络中断')
    },
  })
  return {
    api,
    showAiConfigDialog,
    aiConfigContentRef,
    aiConfigInitialServiceType,
    aiConfigChanged,
    aiConfigOpenedFromPipelineAction,
    messages,
    cacheInvalidations,
    videoRefresh,
    readinessRefresh,
    focuses,
  }
}

test('AI 配置工作区会校验服务类型，未确认关闭时保持打开', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const scope = effectScope()
  try {
    const ctx = scope.run(() => createAiWorkspace())
    ctx.api.openAiConfig('video')
    await flushUi()
    assert.equal(ctx.showAiConfigDialog.value, true)
    assert.equal(ctx.aiConfigInitialServiceType.value, 'video')
    assert.equal(ctx.aiConfigOpenedFromPipelineAction.value, false)
    assert.equal(ctx.aiConfigChanged.value, false)

    ctx.api.openAiConfig('not-a-service')
    assert.equal(ctx.aiConfigInitialServiceType.value, '')
    ctx.api.openAiConfigFromPipeline('storyboard_image', { source: 'compact-action' })
    assert.equal(ctx.aiConfigInitialServiceType.value, 'storyboard_image')
    assert.equal(ctx.aiConfigOpenedFromPipelineAction.value, true)
    ctx.api.openAiConfigFromPipeline('tts', { source: 'toolbar' })
    assert.equal(ctx.aiConfigOpenedFromPipelineAction.value, false)

    let closed = 0
    ctx.aiConfigContentRef.value = {
      async requestClose() { return false },
    }
    await ctx.api.confirmAiConfigWorkspaceClose(() => { closed += 1 })
    await ctx.api.requestAiConfigWorkspaceClose()
    assert.equal(closed, 0)
    assert.equal(ctx.showAiConfigDialog.value, true)

    ctx.aiConfigContentRef.value = {
      async requestClose() { return true },
    }
    await ctx.api.confirmAiConfigWorkspaceClose(() => { closed += 1 })
    assert.equal(closed, 1)
  } finally {
    scope.stop()
  }
})

test('AI 配置关闭后会刷新能力，流水线入口会在中文提示后恢复焦点', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const scope = effectScope()
  try {
    const ctx = scope.run(() => createAiWorkspace())
    ctx.api.openAiConfigFromPipeline('video', { source: 'compact-action' })
    await flushUi()
    ctx.api.onAiConfigurationChanged()
    assert.equal(ctx.aiConfigChanged.value, true)
    ctx.aiConfigContentRef.value = { async requestClose() { return true } }
    await ctx.api.requestAiConfigWorkspaceClose()
    await waitFor(() => ctx.cacheInvalidations.length === 1 && ctx.focuses.length === 1, '关闭配置后应刷新并恢复流水线焦点')
    assert.equal(ctx.showAiConfigDialog.value, false)
    assert.equal(ctx.messages[0].type, 'info')
    assert.equal(ctx.messages[0].message, '配置已更新，正在重新检查')
    assertChinese(ctx.messages[0].message)
    assert.equal(ctx.videoRefresh.length, 1)
    assert.equal(ctx.readinessRefresh.length, 1)
    assert.notEqual(ctx.videoRefresh[0].dramaId, ctx.videoRefresh[0].episodeId)
    assert.equal(ctx.focuses[0].dramaId, DRAMA_ID)
    assert.equal(ctx.focuses[0].episodeId, EPISODE_ID)

    ctx.api.openAiConfig('image')
    await flushUi()
    await ctx.api.requestAiConfigWorkspaceClose()
    await waitFor(() => ctx.videoRefresh.length === 2, '未改配置关闭时仍应刷新能力')
    assert.equal(ctx.messages.length, 1)
    assert.equal(ctx.focuses.length, 1)
  } finally {
    scope.stop()
  }
})

test('素材库归属空资源不发请求，查询使用 dramaId 而不是 episodeId', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const membership = createLibraryMembershipState()
  membership.dramaSourceIds.value = new Set(['旧项目'])
  membership.materialSourceIds.value = new Set(['旧素材'])
  const listCalls = []
  await loadLibraryMembership({
    api: { list: rejectNetwork('library.list') },
    sourceType: 'character',
    assets: [],
    dramaId: DRAMA_ID,
    ...membership,
  })
  assert.equal(membership.dramaSourceIds.value.size, 0)
  assert.equal(membership.materialSourceIds.value.size, 0)

  await loadLibraryMembership({
    api: {
      async list(params) {
        listCalls.push(params)
        assert.equal('episode_id' in params, false)
        if (params.drama_id != null) {
          assert.equal(params.drama_id, DRAMA_ID)
          assert.notEqual(params.drama_id, EPISODE_ID)
          return { items: [{ source_id: String(CHAR_ID), episode_id: EPISODE_ID }] }
        }
        assert.equal(params.global, 1)
        return { items: [{ source_id: String(CHAR_ID) }, { source_id: String(PROP_ID) }] }
      },
    },
    sourceType: 'character',
    assets: [
      { id: CHAR_ID, name: '李华' },
      { id: String(CHAR_ID) },
      { id: PROP_ID },
      { id: '  ' },
      { id: null },
    ],
    dramaId: DRAMA_ID,
    ...membership,
  })
  assert.equal(listCalls.length, 2)
  assert.equal(listCalls[0].source_type, 'character')
  assert.equal(listCalls[0].page_size, 2)
  assert.equal(hasAssetInLibrary(membership.dramaSourceIds, { id: CHAR_ID }), true)
  assert.equal(hasAssetInLibrary(membership.dramaSourceIds, { id: PROP_ID }), false)
  assert.equal(hasAssetInLibrary(membership.materialSourceIds, { id: PROP_ID }), true)
  markAssetInLibrary(membership.dramaSourceIds, { id: PROP_ID })
  markAssetInLibrary(membership.dramaSourceIds, { id: null })
  assert.equal(hasAssetInLibrary(membership.dramaSourceIds, { id: PROP_ID }), true)
  assert.equal(hasAssetInLibrary(membership.dramaSourceIds, { id: null }), false)
})

test('素材库归属查询失败时清空集合，错误信息保持中文', async () => {
  assertDistinctIds(DRAMA_ID, EPISODE_ID)
  const membership = createLibraryMembershipState()
  membership.dramaSourceIds.value = new Set([String(CHAR_ID)])
  membership.materialSourceIds.value = new Set([String(PROP_ID)])
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    await loadLibraryMembership({
      api: {
        async list(params) {
          assert.notEqual(params.drama_id, EPISODE_ID)
          throw new Error('素材库查询失败：项目与剧集 ID 不能混用')
        },
      },
      sourceType: 'prop',
      assets: [{ id: PROP_ID, name: '钥匙' }],
      dramaId: DRAMA_ID,
      ...membership,
    })
    assert.equal(membership.dramaSourceIds.value.size, 0)
    assert.equal(membership.materialSourceIds.value.size, 0)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /素材库查询失败：项目与剧集 ID 不能混用/)
    assertChinese(warnings[0])
  } finally {
    console.warn = originalWarn
  }
})
