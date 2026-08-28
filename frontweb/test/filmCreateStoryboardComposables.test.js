import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { ElMessage, ElMessageBox } from 'element-plus'
import { useFilmCreateStoryboardAccessors } from '../src/composables/filmCreate/useFilmCreateStoryboardAccessors.js'
import { useFilmCreateStoryboardCrud } from '../src/composables/filmCreate/useFilmCreateStoryboardCrud.js'
import { useFilmCreateStoryboardPrompts } from '../src/composables/filmCreate/useFilmCreateStoryboardPrompts.js'
import { useFilmCreateStoryboardExport } from '../src/composables/filmCreate/useFilmCreateStoryboardExport.js'
import { useFilmCreateStoryboardReferences } from '../src/composables/filmCreate/useFilmCreateStoryboardReferences.js'
import { useFilmCreateTailFrameLink } from '../src/composables/filmCreate/useFilmCreateTailFrameLink.js'
import { useFilmCreateStoryboardTts } from '../src/composables/filmCreate/useFilmCreateStoryboardTts.js'
import { useFilmCreateStoryboardUpload } from '../src/composables/filmCreate/useFilmCreateStoryboardUpload.js'

const DRAMA_ID = 7
const EPISODE_ID = 21
const STORYBOARD_ID = 101
const NEXT_STORYBOARD_ID = 202
const BOUND_FIRST_ID = 501
const TYPED_FIRST_ID = 603

function rejectNetwork(label) {
  return async () => {
    throw new Error(`${label} 不应发起真实网络请求`)
  }
}

describe('filmCreateStoryboardComposables', () => {
  let restoreMessages = () => {}

  function captureMessages() {
    const sink = { warning: [], error: [], success: [] }
    const original = {
      warning: ElMessage.warning,
      error: ElMessage.error,
      success: ElMessage.success,
      confirm: ElMessageBox.confirm,
    }
    ElMessage.warning = (message) => { sink.warning.push(message) }
    ElMessage.error = (message) => { sink.error.push(message) }
    ElMessage.success = (message) => { sink.success.push(message) }
    ElMessageBox.confirm = async () => {}
    restoreMessages = () => {
      ElMessage.warning = original.warning
      ElMessage.error = original.error
      ElMessage.success = original.success
      ElMessageBox.confirm = original.confirm
      restoreMessages = () => {}
    }
    return sink
  }

  test.afterEach(() => restoreMessages())

  test('accessors prefer first_frame_image_id and keep drama/episode ids apart', () => {
    assert.notEqual(DRAMA_ID, EPISODE_ID)
    const store = {
      dramaId: DRAMA_ID,
      currentEpisode: { id: EPISODE_ID },
      storyboards: [
        { id: DRAMA_ID, first_frame_image_id: 700, episode_id: 99 },
        { id: EPISODE_ID, first_frame_image_id: 2100, episode_id: EPISODE_ID },
        { id: STORYBOARD_ID, first_frame_image_id: BOUND_FIRST_ID, episode_id: EPISODE_ID },
      ],
    }
    const sbImages = {
      value: {
        [DRAMA_ID]: [{ id: 700, status: 'completed', frame_type: 'storyboard_first', image_url: '/static/drama-leak.png' }],
        [EPISODE_ID]: [{ id: 2100, status: 'completed', frame_type: 'storyboard_first', image_url: '/static/episode-leak.png' }],
        [STORYBOARD_ID]: [
          { id: BOUND_FIRST_ID, status: 'completed', frame_type: 'storyboard_last', image_url: '/static/bound-first.png' },
          { id: TYPED_FIRST_ID, status: 'completed', frame_type: 'storyboard_first', image_url: '/static/typed-first.png' },
        ],
      },
    }
    const accessors = useFilmCreateStoryboardAccessors({
      store,
      sbImages,
      sbVideos: { value: {} },
      sbVideoErrors: { value: {} },
      storyboardUseFirstLastFrame: { value: true },
      isSbUniversalMode: () => false,
      storyboardsAPI: { update: rejectNetwork('storyboardsAPI.update') },
      imagesAPI: { delete: rejectNetwork('imagesAPI.delete') },
      ElMessage: { success() {}, error() {} },
      ElMessageBox: { confirm: async () => {} },
      refreshStoryboardMediaForCurrentContext: async () => {},
      assetImageUrl: (img) => img?.image_url || '',
      assetVideoUrl: () => '',
      recordHasPlayableVideoUrl: () => false,
      toAbsoluteImageUrl: (url) => url || '',
      userFacingVideoGenerationError: (msg) => msg,
      sbVideoReferenceImageId: { value: {} },
    })
    accessors.sbSelectedImgId.value = {
      ...accessors.sbSelectedImgId.value,
      [STORYBOARD_ID]: TYPED_FIRST_ID,
      [DRAMA_ID]: 700,
      [EPISODE_ID]: 2100,
    }

    const first = accessors.getSbFirstImage(STORYBOARD_ID)
    assert.equal(first.id, BOUND_FIRST_ID)
    assert.equal(first.image_url, '/static/bound-first.png')
    assert.equal(accessors.getSbImage(STORYBOARD_ID).id, BOUND_FIRST_ID)
    assert.deepEqual(accessors.getSbAllImages(STORYBOARD_ID).map((img) => img.id), [BOUND_FIRST_ID, TYPED_FIRST_ID])
    assert.equal(accessors.getSbFirstImage(DRAMA_ID).id, 700)
    assert.equal(accessors.getSbFirstImage(EPISODE_ID).id, 2100)
  })

  test('首尾帧按字符串/数字图片 id 取值，不会命中其它图片', () => {
    const storyboardId = '77'
    const boundId = '31'
    const otherId = 32
    assert.notEqual(Number(boundId), otherId)
    const store = {
      storyboards: [
        { id: 77, first_frame_image_id: 31, last_frame_image_id: '31', episode_id: 22 },
      ],
    }
    const sbImages = {
      value: {
        77: [
          { id: 31, status: 'completed', frame_type: 'storyboard_first', image_url: '/static/bound.png' },
          { id: otherId, status: 'completed', frame_type: 'storyboard_first', image_url: '/static/other.png' },
        ],
      },
    }
    const accessors = useFilmCreateStoryboardAccessors({
      store,
      sbImages,
      sbVideos: { value: {} },
      sbVideoErrors: { value: {} },
      storyboardUseFirstLastFrame: { value: true },
      isSbUniversalMode: () => false,
      storyboardsAPI: {},
      imagesAPI: {},
      ElMessage: { success() {}, error() {} },
      ElMessageBox: { confirm: async () => {} },
      refreshStoryboardMediaForCurrentContext: async () => {},
      assetImageUrl: (img) => img?.image_url || '',
      assetVideoUrl: () => '',
      recordHasPlayableVideoUrl: () => false,
      toAbsoluteImageUrl: (url) => url || '',
      userFacingVideoGenerationError: (msg) => msg,
      sbVideoReferenceImageId: { value: {} },
    })
    accessors.sbSelectedImgId.value = { [storyboardId]: otherId }
    const first = accessors.getSbFirstImage(storyboardId)
    assert.equal(first.image_url, '/static/bound.png')
    assert.equal(first.id, 31)
  })

  test('storyboard create and delete failures use Chinese errors without throwing English', async () => {
    const messages = captureMessages()
    const creates = []
    const deletes = []
    const loads = []
    const missingEpisode = useFilmCreateStoryboardCrud({
      currentEpisodeId: { value: null },
      dramaId: { value: DRAMA_ID },
      store: { storyboards: [] },
      storyboardsAPI: { create: async (payload) => { creates.push(payload) } },
      loadDrama: async () => { loads.push('missing') },
    })
    await assert.doesNotReject(() => missingEpisode.onAddSingleStoryboard())
    assert.equal(messages.warning.at(-1), '请先选择集')
    assert.equal(creates.length, 0)

    const crud = useFilmCreateStoryboardCrud({
      currentEpisodeId: { value: EPISODE_ID },
      dramaId: { value: DRAMA_ID },
      store: { storyboards: [{ id: STORYBOARD_ID, episode_id: EPISODE_ID, storyboard_number: 4 }] },
      storyboardsAPI: {
        create: async (payload) => {
          creates.push(payload)
          throw new Error()
        },
        delete: async (id) => {
          deletes.push(id)
          throw new Error()
        },
      },
      loadDrama: async () => { loads.push('loaded') },
    })
    await assert.doesNotReject(() => crud.onAddSingleStoryboard())
    assert.equal(creates[0].episode_id, EPISODE_ID)
    assert.notEqual(creates[0].episode_id, DRAMA_ID)
    assert.equal(creates[0].storyboard_number, 5)
    assert.equal(messages.error.at(-1), '添加失败')
    assert.equal(loads.length, 0)

    await assert.doesNotReject(() => crud.onDeleteSingleStoryboard(STORYBOARD_ID))
    assert.deepEqual(deletes, [STORYBOARD_ID])
    assert.equal(messages.error.at(-1), '删除失败')
    assert.equal(loads.length, 0)
    assert.equal(messages.error.every((text) => !/[A-Za-z]/.test(text)), true)
  })

  test('layout regenerate warns in Chinese when AI returns no description', async () => {
    const messages = captureMessages()
    const regeneratingLayoutSbIds = new Set()
    const sbLayoutDescription = { value: { [STORYBOARD_ID]: '旧布局' } }
    let refreshed = false
    const { onRegenerateLayoutDescription } = useFilmCreateStoryboardPrompts({
      storyboardsAPI: {
        regenerateLayoutDescription: async (id) => {
          assert.equal(id, STORYBOARD_ID)
          return { layout_description: '', data: {} }
        },
      },
      refreshStoryboardsOnly: async () => { refreshed = true },
      sbLayoutDescription,
      regeneratingLayoutSbIds,
    })
    await onRegenerateLayoutDescription({ id: STORYBOARD_ID })
    assert.equal(messages.warning.at(-1), 'AI 未返回有效的布局描述')
    assert.equal(sbLayoutDescription.value[STORYBOARD_ID], '旧布局')
    assert.equal(refreshed, false)
    assert.equal(regeneratingLayoutSbIds.has(STORYBOARD_ID), false)
  })

  test('storyboard export stays disabled or fails with Chinese copy', async () => {
    const messages = captureMessages()
    let framePromptCalls = 0
    const empty = useFilmCreateStoryboardExport({
      store: { currentEpisode: { episode_number: 2 }, drama: { title: '月相' } },
      currentEpisodeId: { value: EPISODE_ID },
      storyboards: { value: [] },
      storyboardsAPI: {
        getFramePrompts: async () => {
          framePromptCalls += 1
          return {}
        },
      },
      storyboardUseFirstLastFrame: { value: false },
      exportingStoryboardSheet: { value: false },
      getSbFirstImage: () => null,
      getSbLastImage: () => null,
      buildFirstFrameImagePrompt: () => '',
      buildLastFrameImagePrompt: () => '',
      getSbSelectedScene: () => null,
      getSbSelectedCharacters: () => [],
      getSbSelectedProps: () => [],
      getMovementLabel: () => '',
      sbTitle: { value: {} },
      sbLocation: { value: {} },
      sbTime: { value: {} },
      sbDuration: { value: {} },
      sbDialogue: { value: {} },
      sbNarration: { value: {} },
      sbAction: { value: {} },
      sbResult: { value: {} },
      sbAtmosphere: { value: {} },
      sbShotType: { value: {} },
      sbMovement: { value: {} },
      sbLayoutDescription: { value: {} },
      sbUniversalSegmentText: { value: {} },
    })
    await empty.onExportStoryboardSheet()
    empty.onExportNarrationSrt()
    assert.equal(messages.warning[0], '暂无分镜')
    assert.equal(messages.warning[1], '暂无分镜')
    assert.equal(framePromptCalls, 0)

    const silent = useFilmCreateStoryboardExport({
      store: { currentEpisode: { episode_number: 2 }, drama: { title: '月相' } },
      currentEpisodeId: { value: EPISODE_ID },
      storyboards: { value: [{ id: STORYBOARD_ID, duration: 5, narration: '   ' }] },
      storyboardsAPI: { getFramePrompts: rejectNetwork('getFramePrompts') },
      storyboardUseFirstLastFrame: { value: false },
      exportingStoryboardSheet: { value: false },
      getSbFirstImage: () => null,
      getSbLastImage: () => null,
      buildFirstFrameImagePrompt: () => '',
      buildLastFrameImagePrompt: () => '',
      getSbSelectedScene: () => null,
      getSbSelectedCharacters: () => [],
      getSbSelectedProps: () => [],
      getMovementLabel: () => '',
      sbTitle: { value: {} },
      sbLocation: { value: {} },
      sbTime: { value: {} },
      sbDuration: { value: { [STORYBOARD_ID]: 5 } },
      sbDialogue: { value: {} },
      sbNarration: { value: { [STORYBOARD_ID]: '   ' } },
      sbAction: { value: {} },
      sbResult: { value: {} },
      sbAtmosphere: { value: {} },
      sbShotType: { value: {} },
      sbMovement: { value: {} },
      sbLayoutDescription: { value: {} },
      sbUniversalSegmentText: { value: {} },
    })
    silent.onExportNarrationSrt()
    assert.equal(messages.warning.at(-1), '当前分镜没有可导出的解说文案')
  })

  test('video reference firstFrameUrl prefers grid over classic first frame', async () => {
    const grid = { id: 77, image_url: 'https://cdn.example/grid.png' }
    const { buildStoryboardVideoReferencePayload } = useFilmCreateStoryboardReferences({
      store: {
        currentEpisode: { id: EPISODE_ID, storyboards: [{ id: STORYBOARD_ID }] },
        drama: { episodes: [{ id: EPISODE_ID, storyboards: [{ id: STORYBOARD_ID }] }] },
      },
      storyboards: { value: [{ id: STORYBOARD_ID, episode_id: EPISODE_ID }] },
      storyboardsAPI: { update: rejectNetwork('storyboardsAPI.update') },
      sbSceneId: { value: {} },
      sbCharacterIds: { value: {} },
      sbPropIds: { value: {} },
      videoParamsTarget: { value: null },
      toAbsoluteImageUrl: (url) => url || '',
      assetImageUrl: (item) => item?.image_url || '',
      scenes: { value: [] },
      characters: { value: [] },
      props: { value: [] },
      savingSbReferenceImages: new Set(),
      globalMediaPickerMode: { value: 'reference' },
      globalMediaPickerTarget: { value: null },
      showGlobalMediaPicker: { value: false },
      getMainImageUrlForVideo: async () => 'https://cdn.example/main.png',
      sbVideoFirstLastUrls: () => ({
        first: 'https://cdn.example/first.png',
        last: 'https://cdn.example/last.png',
      }),
    })
    const sb = { id: STORYBOARD_ID, episode_id: EPISODE_ID }
    const gridPayload = await buildStoryboardVideoReferencePayload(sb, { selectedGrid: grid })
    const firstPayload = await buildStoryboardVideoReferencePayload(sb, { selectedGrid: null })
    assert.equal(gridPayload.firstFrameUrl, 'https://cdn.example/grid.png')
    assert.equal(gridPayload.lastFrameUrl, undefined)
    assert.equal(firstPayload.firstFrameUrl, 'https://cdn.example/first.png')
    assert.equal(firstPayload.lastFrameUrl, 'https://cdn.example/last.png')
  })

  test('tail-frame reuse refreshes first_frame_image_id for the current shot', async () => {
    const messages = captureMessages()
    const uploaded = {
      id: 888,
      image_url: '/static/from-prev-tail.png',
      local_path: 'from-prev-tail.png',
      frame_type: 'storyboard_first',
    }
    const currentSb = {
      id: NEXT_STORYBOARD_ID,
      storyboard_number: 2,
      first_frame_image_id: 111,
      episode_id: EPISODE_ID,
    }
    const prevSb = {
      id: STORYBOARD_ID,
      storyboard_number: 1,
      last_frame_image_id: 802,
      episode_id: EPISODE_ID,
    }
    const sbSelectedImgId = { value: { [NEXT_STORYBOARD_ID]: 111 } }
    const uploadPayloads = []
    const refreshedMedia = []
    let refreshedMeta = false
    const usingPrevTailAsFirstIds = new Set()
    const { onUsePrevTailAsFirst } = useFilmCreateTailFrameLink({
      dramaId: { value: DRAMA_ID },
      storyboardsAPI: { linkTailFrame: rejectNetwork('linkTailFrame') },
      imagesAPI: {
        upload: async (payload) => {
          uploadPayloads.push(payload)
          return uploaded
        },
      },
      getNextStoryboard: () => null,
      getPrevStoryboard: (id) => (id === NEXT_STORYBOARD_ID ? prevSb : null),
      getSbVideo: () => null,
      getSbLastImage: (id) => (id === STORYBOARD_ID
        ? { id: 802, image_url: '/static/prev-last.png', local_path: 'prev-last.png', frame_type: 'storyboard_last' }
        : null),
      linkingTailFrameIds: new Set(),
      usingPrevTailAsFirstIds,
      refreshStoryboardMediaForCurrentContext: async (id) => { refreshedMedia.push(id) },
      refreshStoryboardsOnly: async () => {
        refreshedMeta = true
        currentSb.first_frame_image_id = uploaded.id
      },
      onSelectSbFrameImage: (sb, img, slot) => {
        assert.equal(sb.id, NEXT_STORYBOARD_ID)
        assert.equal(img.id, uploaded.id)
        assert.equal(slot, 'first')
        sb.first_frame_image_id = img.id
      },
      sbSelectedImgId,
    })
    await onUsePrevTailAsFirst(currentSb)
    assert.equal(uploadPayloads[0].drama_id, DRAMA_ID)
    assert.equal(uploadPayloads[0].storyboard_id, NEXT_STORYBOARD_ID)
    assert.notEqual(uploadPayloads[0].drama_id, uploadPayloads[0].storyboard_id)
    assert.equal(uploadPayloads[0].frame_type, 'storyboard_first')
    assert.equal(refreshedMeta, true)
    assert.equal(currentSb.first_frame_image_id, uploaded.id)
    assert.equal(sbSelectedImgId.value[NEXT_STORYBOARD_ID], undefined)
    assert.deepEqual(refreshedMedia, [NEXT_STORYBOARD_ID])
    assert.match(messages.success.at(-1), /尾帧设为本分镜首帧/)
    assert.equal(usingPrevTailAsFirstIds.size, 0)
  })

  test('TTS stays idle when disabled or already in flight', async () => {
    const messages = captureMessages()
    const originalFetch = globalThis.fetch
    globalThis.fetch = rejectNetwork('fetch')
    const executeCalls = []
    const ttsSbIds = new Set([STORYBOARD_ID])
    const ttsSbNarrationIds = new Set()
    try {
      const { onTtsSbDialogue } = useFilmCreateStoryboardTts({
        ttsSbIds,
        ttsSbNarrationIds,
        sbDialogueAudioPaths: { value: {} },
        sbNarrationAudioPaths: { value: {} },
        sbNarration: { value: {} },
        ttsGenerationDisabledReason: () => '请先配置语音合成',
        projectLifecycle: {
          execute: async (operation) => {
            executeCalls.push('execute')
            return operation()
          },
        },
      })
      const sb = { id: STORYBOARD_ID, dialogue: '今晚月色真美' }
      await onTtsSbDialogue(sb)
      assert.equal(executeCalls.length, 0)
      assert.equal(messages.warning.length, 0)

      ttsSbIds.delete(STORYBOARD_ID)
      await onTtsSbDialogue(sb)
      assert.equal(executeCalls.length, 0)
      assert.equal(messages.warning.at(-1), '请先配置语音合成')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('storyboard upload rejects illegal file types in Chinese', async () => {
    const messages = captureMessages()
    const uploadedRecords = []
    const uploadingSbImageId = { value: null }
    const { doUploadSbImage } = useFilmCreateStoryboardUpload({
      dramaId: { value: DRAMA_ID },
      store: { storyboards: [{ id: STORYBOARD_ID, episode_id: EPISODE_ID }] },
      uploadAPI: {
        async uploadImage(file) {
          if (!String(file?.type || '').startsWith('image/')) {
            throw new Error('只支持图片格式 (jpg, png, gif, webp)')
          }
          return { url: '/static/ok.png', local_path: 'ok.png' }
        },
      },
      imagesAPI: {
        async upload(payload) {
          uploadedRecords.push(payload)
          return { id: 1 }
        },
      },
      storyboardUseFirstLastFrame: { value: false },
      sbImageUploadForId: { value: null },
      sbImageUploadSlotById: { value: {} },
      uploadingSbImageId,
      sbSelectedImgId: { value: {} },
      frameTypeForSlot: (slot) => (slot === 'last' ? 'storyboard_last' : 'storyboard_first'),
      onSelectSbFrameImage: () => {},
      refreshStoryboardMediaForCurrentContext: rejectNetwork('refreshStoryboardMedia'),
      restoreSelectionsFromBackend: () => {},
    })
    await doUploadSbImage(STORYBOARD_ID, { name: 'notes.txt', type: 'text/plain' })
    assert.match(messages.error.at(-1), /只支持图片格式/)
    assert.equal(uploadedRecords.length, 0)
    assert.equal(uploadingSbImageId.value, null)
  })
})
