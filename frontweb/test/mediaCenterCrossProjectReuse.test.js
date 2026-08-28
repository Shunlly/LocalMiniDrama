import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'
import { ElMessage } from 'element-plus'
import { shouldShowRequestErrorToast } from '../src/utils/request.js'
import { buildStoryboardVideoRequest } from '../src/utils/storyboardVideoRequest.js'
import { useFilmCreateWorkspaceNav } from '../src/composables/filmCreate/useFilmCreateWorkspaceNav.js'
import { useFilmCreatePipelineStages } from '../src/composables/filmCreate/useFilmCreatePipelineStages.js'
import { useFilmCreateBatchGeneration } from '../src/composables/filmCreate/useFilmCreateBatchGeneration.js'
import { useFilmCreateStoryboardVideoGeneration } from '../src/composables/filmCreate/useFilmCreateStoryboardVideoGeneration.js'
import { useFilmCreateStoryboardReferences } from '../src/composables/filmCreate/useFilmCreateStoryboardReferences.js'
import { remainingImportedFunctionSource } from './helpers/remainingSourceBetween.js'

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const storyboardPanelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url), 'utf8')
const storyboardDialogsSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardDialogs.vue', import.meta.url), 'utf8')
const mediaLibrarySource = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')
const pickerSource = readFileSync(new URL('../src/components/GlobalMediaPickerDialog.vue', import.meta.url), 'utf8')
const deliveryPanelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url), 'utf8')
const dramaCanvasSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')
const assetsApiSource = readFileSync(new URL('../src/api/assets.js', import.meta.url), 'utf8')

function assertValidVueSfc(name, source) {
  const { errors } = parse(source, { filename: name })
  assert.deepEqual(errors, [], `${name} must remain a valid Vue SFC`)
}

function refOf(value) {
  return { value }
}

test('media center SFCs stay parseable after cross-project reuse wiring', () => {
  assertValidVueSfc('MediaLibrary.vue', mediaLibrarySource)
  assertValidVueSfc('GlobalMediaPickerDialog.vue', pickerSource)
  assertValidVueSfc('FilmCreate.vue', filmCreateSource)
})

test('assets API normalizes list items before the views consume them', () => {
  assert.match(assetsApiSource, /import \{ normalizeMediaItem \} from '@\/utils\/mediaLibrary'/)
  assert.match(assetsApiSource, /items: items\.map\(\(item\) => normalizeMediaItem\(item\)\)/)
})

test('persistent media loaders suppress duplicate global errors while ordinary request failures still toast', () => {
  assert.match(mediaLibrarySource, /mediaLibraryAPI\.list\(params, \{ suppressErrorToast: true, signal: controller\.signal \}\)/)
  assert.match(pickerSource, /assetsAPI\.list\(params, \{[\s\S]*signal: controller\.signal,[\s\S]*suppressErrorToast: true,/)
  assert.equal(shouldShowRequestErrorToast({ config: {} }), true)
  assert.equal(shouldShowRequestErrorToast({ config: { suppressErrorToast: true } }), false)
  assert.equal(shouldShowRequestErrorToast({ code: 'ERR_CANCELED', config: {} }), false)
})

test('media library cards surface source project context for cross-project reuse', () => {
  assert.match(mediaLibrarySource, /class="media-origin">\{\{ mediaOriginLabel\(item\) \}\}/)
  assert.match(mediaLibrarySource, /describeMediaDeleteImpact\(item\)/)
  assert.match(mediaLibrarySource, /describeMediaBatchDeleteImpact\(count\)/)
})

test('global media picker shows mount context, media compatibility state, retry UI, and keyboard actions', () => {
  assert.match(pickerSource, /role="status" aria-live="polite"/)
  assert.match(pickerSource, /createLatestMediaRequestGuard/)
  assert.match(pickerSource, /function confirmSelection\(\) \{\s*if \(confirmDisabled\.value\) return/)
  assert.match(pickerSource, /mediaOriginLabel\(item\)/)
})

test('FilmCreate wires the picker into storyboard free references with duplicate, promote, and remove flows', async () => {
  const pushes = []
  const showGlobalMediaPicker = refOf(true)
  const { openMediaLibraryFromPicker } = useFilmCreateWorkspaceNav({
    router: { push(target) { pushes.push(target) } },
    route: { fullPath: '/film/11?episode=22' },
    dramaId: refOf(11),
    selectedEpisodeId: refOf(22),
    projectListReturnTo: refOf(''),
    showGlobalMediaPicker,
  })
  openMediaLibraryFromPicker()
  assert.equal(showGlobalMediaPicker.value, false)
  assert.deepEqual(pushes, [{ name: 'media-library', query: { returnTo: '/film/11?episode=22' } }])

  const warnings = []
  const originalWarning = ElMessage.warning
  ElMessage.warning = (message) => { warnings.push(message) }
  try {
    const storyboard = {
      id: 101,
      reference_images: [{ image_url: 'https://cdn.test/a.png', name: '已有参考' }],
    }
    const pickerMode = refOf('reference')
    const refs = useFilmCreateStoryboardReferences({
      store: { storyboards: [storyboard] },
      storyboards: refOf([storyboard]),
      storyboardsAPI: { async update() { throw new Error('重复参考不应保存') } },
      sbSceneId: refOf({}),
      sbCharacterIds: refOf({}),
      sbPropIds: refOf({}),
      showGlobalMediaPicker: refOf(true),
      globalMediaPickerTarget: refOf(storyboard),
      globalMediaPickerMode: pickerMode,
      toAbsoluteImageUrl: (url) => url,
      assetImageUrl: (item) => item?.image_url || item?.url || '',
    })
    await refs.onGlobalMediaAssetSelected({
      id: 9,
      url: 'https://cdn.test/a.png',
      name: '海报',
    })
    assert.equal(warnings.at(-1), '该图片已经挂到当前分镜的自由参考图中')

    pickerMode.value = 'reference-primary'
    await refs.onGlobalMediaAssetSelected({
      id: 9,
      url: 'https://cdn.test/a.png',
      name: '海报',
    })
    assert.equal(warnings.at(-1), '该图片已经是当前分镜的视频主参考')
    assert.match(refs.getSbPrimaryReferenceAbsoluteUrl(storyboard), /cdn\.test\/a\.png/)
  } finally {
    ElMessage.warning = originalWarning
  }

  assert.match(filmCreateSource, /<GlobalMediaPickerDialog[\s\S]*@select="onGlobalMediaAssetSelected"[\s\S]*@open-library="openMediaLibraryFromPicker"/)
  assert.match(storyboardPanelSource, /:aria-label="`分镜 \$\{sb\.storyboard_number\} 视频预览`"/)
  assert.match(deliveryPanelSource, /aria-label="本集合成视频预览"/)
  assert.match(storyboardDialogsSource, /openGlobalMediaPicker\(videoParamsTarget, 'reference-primary'\)/)
  assert.match(storyboardDialogsSource, /onPromoteSbFreeReferenceImage\(videoParamsTarget, item\)/)
})

test('all storyboard video submission paths reuse the shared video request builder', () => {
  const source = remainingImportedFunctionSource(
    useFilmCreatePipelineStages,
    useFilmCreateBatchGeneration,
    useFilmCreateStoryboardVideoGeneration,
  )
  assert.equal((source.match(/videosAPI\.create\(buildStoryboardVideoRequest\(/g) || []).length, 4)
  const body = buildStoryboardVideoRequest({
    dramaId: 11,
    storyboard: { id: 22 },
    referenceImageUrls: ['https://cdn.test/a.png'],
  })
  assert.equal(body.drama_id, 11)
  assert.equal(body.storyboard_id, 22)
  assert.deepEqual(body.reference_image_urls, ['https://cdn.test/a.png'])
})

test('free canvas picker only confirms current-project or global assets and closes after a successful pick', () => {
  assert.match(dramaCanvasSource, /reusePolicy: 'current-or-global'/)
  assert.match(dramaCanvasSource, /@select="onFreeCanvasMediaPicked"/)
  assert.match(pickerSource, /当前画布只能确认全局素材或当前项目素材/)
  assert.doesNotMatch(filmCreateSource, /reusePolicy: 'current-or-global'/)
})

test('delete impact copy names the asset and warns about cross-project reuse', async () => {
  const {
    describeMediaBatchDeleteImpact,
    describeMediaDeleteImpact,
    getMediaOriginLabel,
  } = await import('../src/utils/mediaLibrary.js')
  assert.equal(getMediaOriginLabel({ source_drama_title: '夜雨' }), '夜雨')
  assert.equal(getMediaOriginLabel({ drama_id: 9 }), '项目素材（ID 9）')
  assert.equal(getMediaOriginLabel({}), '全局上传，可跨项目复用')
  assert.match(describeMediaDeleteImpact({ name: '海报.png', source_drama_title: '夜雨' }), /「海报\.png」来自夜雨/)
  assert.match(describeMediaDeleteImpact({}), /未命名素材/)
  assert.match(describeMediaBatchDeleteImpact(3), /将删除选中的 3 个素材/)
})
