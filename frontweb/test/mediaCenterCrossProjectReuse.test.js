import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'
import { shouldShowRequestErrorToast } from '../src/utils/request.js'

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const pipelineStagesSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreatePipelineStages.js', import.meta.url), 'utf8')
const batchGenerationSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateBatchGeneration.js', import.meta.url), 'utf8')
const storyboardVideoGenerationSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardVideoGeneration.js', import.meta.url), 'utf8')
const storyboardReferencesSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardReferences.js', import.meta.url), 'utf8')
const storyboardPanelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url), 'utf8')
const storyboardDialogsSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardDialogs.vue', import.meta.url), 'utf8')
const mediaLibrarySource = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')
const pickerSource = readFileSync(new URL('../src/components/GlobalMediaPickerDialog.vue', import.meta.url), 'utf8')
const assetsApiSource = readFileSync(new URL('../src/api/assets.js', import.meta.url), 'utf8')
const requestSource = readFileSync(new URL('../src/utils/request.js', import.meta.url), 'utf8')
const deliveryPanelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url), 'utf8')
const dramaCanvasSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')

function assertValidVueSfc(name, source) {
  const { errors } = parse(source, { filename: name })
  assert.deepEqual(errors, [], `${name} must remain a valid Vue SFC`)
}

test('media center SFCs stay parseable after cross-project reuse wiring', () => {
  assertValidVueSfc('MediaLibrary.vue', mediaLibrarySource)
  assertValidVueSfc('GlobalMediaPickerDialog.vue', pickerSource)
  assertValidVueSfc('FilmCreate.vue', filmCreateSource)
})

test('assets API normalizes list items before the views consume them', () => {
  assert.match(assetsApiSource, /import \{ normalizeMediaItem \} from '@\/utils\/mediaLibrary'/)
  assert.match(assetsApiSource, /items: items\.map\(\(item\) => normalizeMediaItem\(item\)\)/)
  assert.match(assetsApiSource, /async list\(params = \{\}, requestOptions = \{\}\)/)
  assert.match(assetsApiSource, /request\.get\('\/assets', \{ \.\.\.requestOptions, params \}\)/)
})

test('persistent media loaders suppress duplicate global errors while ordinary request failures still toast', () => {
  assert.match(mediaLibrarySource, /mediaLibraryAPI\.list\(params, \{ suppressErrorToast: true, signal: controller\.signal \}\)/)
  assert.match(pickerSource, /assetsAPI\.list\(params, \{[\s\S]*signal: controller\.signal,[\s\S]*suppressErrorToast: true,/)
  assert.match(requestSource, /if \(shouldShowRequestErrorToast\(error\)\) ElMessage\.error\(msg\)/)
  assert.equal(shouldShowRequestErrorToast({ config: {} }), true)
  assert.equal(shouldShowRequestErrorToast({ config: { suppressErrorToast: true } }), false)
  assert.equal(shouldShowRequestErrorToast({ code: 'ERR_CANCELED', config: {} }), false)
})

test('media library cards surface source project context for cross-project reuse', () => {
  assert.match(mediaLibrarySource, /mediaLibraryAPI\.list\(params, \{ suppressErrorToast: true, signal: controller\.signal \}\)/)
  assert.match(mediaLibrarySource, /class="media-origin">\{\{ mediaOriginLabel\(item\) \}\}/)
  assert.match(mediaLibrarySource, /describeMediaDeleteImpact\(item\)/)
  assert.match(mediaLibrarySource, /describeMediaBatchDeleteImpact\(count\)/)
  assert.match(mediaLibrarySource, /isMediaInUseError\(err\)/)
})

test('global media picker shows mount context, media compatibility state, retry UI, and keyboard actions', () => {
  assert.match(pickerSource, /role="status" aria-live="polite"/)
  assert.match(pickerSource, /<el-tooltip[\s\S]*:content="item\.name \|\| '未命名素材'"[\s\S]*:show-after="250"/)
  assert.match(pickerSource, /:visible="focusedItemId === item\.id \|\| hoveredItemId === item\.id"/)
  assert.match(pickerSource, /@focus="focusedItemId = item\.id"[\s\S]*@mouseenter="hoveredItemId = item\.id"/)
  assert.match(pickerSource, /:global\(\.media-name-tooltip\)[\s\S]*overflow-wrap: anywhere/)
  assert.match(pickerSource, /:aria-label="cardLabel\(item\)"/)
  assert.match(pickerSource, /:aria-describedby="`media-card-name-\$\{item\.id\}`"/)
  assert.match(pickerSource, /context\.projectTitle/)
  assert.match(pickerSource, /context\.episodeLabel/)
  assert.match(pickerSource, /context\.storyboardLabel/)
  assert.match(pickerSource, /class="picker-error" role="alert"/)
  assert.match(pickerSource, /aria-label="素材类型"/)
  assert.match(pickerSource, /:class="\{\s*'picker-card--selected': selectedId === item\.id,\s*'picker-card--incompatible': !isCompatible\(item\),/s)
  assert.match(pickerSource, /:disabled="confirmDisabled"/)
  assert.match(pickerSource, /const confirmDisabled = computed\(\(\) => \(\s*loading\.value\s*\|\|\s*Boolean\(loadError\.value\)\s*\|\|\s*!selectedItem\.value\s*\|\|\s*!isCompatible\(selectedItem\.value\)\s*\)\)/s)
  assert.match(pickerSource, /<div v-if="!loading && !loadError && !items.length" class="picker-empty">/)
  assert.match(pickerSource, /前往素材中心上传/)
  assert.match(pickerSource, /function clearFilters\(\)/)
  assert.match(pickerSource, /emit\('open-library'\)/)
  assert.match(pickerSource, /createLatestMediaRequestGuard/)
  assert.match(pickerSource, /function abortActiveLoad\(\)[\s\S]*activeLoadController\?\.abort\(\)/)
  assert.match(pickerSource, /function handleClosed\(\)[\s\S]*resetPickerState\(\)/)
  assert.match(pickerSource, /function confirmSelection\(\) \{\s*if \(confirmDisabled\.value\) return/)
  assert.match(pickerSource, /@keydown\.enter\.prevent="onCardEnter\(item\)"/)
  assert.match(pickerSource, /@keydown\.space\.prevent="selectItem\(item\)"/)
  assert.match(pickerSource, /Number\(selectedId\.value\) === Number\(item\.id\)[\s\S]*confirmSelection\(\)[\s\S]*selectItem\(item\)/)
  assert.match(pickerSource, /mediaOriginLabel\(item\)/)
  assert.match(pickerSource, /mediaPickerIncompatibleReason\(item/)
  assert.match(pickerSource, /aria-label="搜索素材名称"/)
})

test('FilmCreate wires the picker into storyboard free references with duplicate, promote, and remove flows', () => {
  assert.match(filmCreateSource, /<GlobalMediaPickerDialog[\s\S]*@select="onGlobalMediaAssetSelected"[\s\S]*@open-library="openMediaLibraryFromPicker"/)
  assert.match(filmCreateSource, /router\.push\(\{ name: 'media-library', query: \{ returnTo: route\.fullPath \} \}\)/)
  assert.match(storyboardPanelSource, /:aria-label="`分镜 \$\{sb\.storyboard_number\} 视频预览`"/)
  assert.match(deliveryPanelSource, /aria-label="本集合成视频预览"/)
  assert.match(storyboardDialogsSource, /<el-form-item label="素材中心参考图">/)
  assert.match(storyboardDialogsSource, /openGlobalMediaPicker\(videoParamsTarget, 'reference-primary'\)/)
  assert.match(storyboardDialogsSource, /openGlobalMediaPicker\(videoParamsTarget, 'reference'\)/)
  assert.match(storyboardReferencesSource, /storyboardsAPI\.update\(sb\.id, \{ reference_images: nextImages \}\)/)
  assert.match(storyboardReferencesSource, /ElMessage\.warning\('该图片已经挂到当前分镜的自由参考图中'\)/)
  assert.match(storyboardReferencesSource, /ElMessage\.warning\('该图片已经是当前分镜的视频主参考'\)/)
  assert.match(storyboardDialogsSource, /onPromoteSbFreeReferenceImage\(videoParamsTarget, item\)/)
  assert.match(storyboardDialogsSource, /onRemoveSbFreeReferenceImage\(videoParamsTarget, index\)/)
  assert.match(storyboardDialogsSource, /\{\{ item\.source_drama_title \|\| '全局上传' \}\}/)
  assert.match(storyboardDialogsSource, /\.vp-reference-thumb\s*\{[\s\S]*width:\s*64px;[\s\S]*height:\s*64px;[\s\S]*overflow:\s*hidden;/)
  assert.match(storyboardDialogsSource, /\.vp-reference-thumb img\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*object-fit:\s*cover;/)
  assert.match(storyboardDialogsSource, /\.vp-reference-item\s*\{[\s\S]*grid-template-columns:\s*64px minmax\(0, 1fr\);/)
})

test('all storyboard video submission paths reuse the shared video request builder', () => {
  const videoRequestSource = filmCreateSource + '\n' + pipelineStagesSource + '\n' + batchGenerationSource + '\n' + storyboardVideoGenerationSource
  const requestBuilderUses = videoRequestSource.match(/videosAPI\.create\(buildStoryboardVideoRequest\(/g) || []
  assert.equal(requestBuilderUses.length, 4)
  assert.match(videoRequestSource, /referenceImageUrls: referencePayload\.referenceUrls/)
  assert.match(storyboardReferencesSource, /const primaryReferenceUrl = getSbPrimaryReferenceAbsoluteUrl\(sb\)/)
})

test('free canvas picker only confirms current-project or global assets and closes after a successful pick', () => {
  assert.match(dramaCanvasSource, /reusePolicy: 'current-or-global'/)
  assert.match(dramaCanvasSource, /dramaId: dramaId\.value/)
  assert.match(dramaCanvasSource, /@select="onFreeCanvasMediaPicked"/)
  assert.match(dramaCanvasSource, /if \(added\) freeMediaPickerVisible\.value = false/)
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
