import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const mediaLibrarySource = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')
const pickerSource = readFileSync(new URL('../src/components/GlobalMediaPickerDialog.vue', import.meta.url), 'utf8')
const assetsApiSource = readFileSync(new URL('../src/api/assets.js', import.meta.url), 'utf8')

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
  assert.match(assetsApiSource, /const response = await request\.get\('\/assets', \{ params \}\)/)
})

test('media library cards surface source project context for cross-project reuse', () => {
  assert.match(mediaLibrarySource, /const res = await assetsAPI\.list\(params\)/)
  assert.match(mediaLibrarySource, /class="media-origin">\{\{ item\.source_drama_title \|\| '全局上传/)
})

test('global media picker shows mount context, media compatibility state, retry UI, and keyboard actions', () => {
  assert.match(pickerSource, /role="status" aria-live="polite"/)
  assert.match(pickerSource, /context\.projectTitle/)
  assert.match(pickerSource, /context\.episodeLabel/)
  assert.match(pickerSource, /context\.storyboardLabel/)
  assert.match(pickerSource, /class="picker-error" role="alert"/)
  assert.match(pickerSource, /aria-label="素材类型"/)
  assert.match(pickerSource, /:class="\{\s*'picker-card--selected': selectedId === item\.id,\s*'picker-card--incompatible': !isCompatible\(item\),/s)
  assert.match(pickerSource, /:disabled="!selectedItem \|\| !isCompatible\(selectedItem\)"/)
  assert.match(pickerSource, /@keydown\.enter\.prevent="onCardEnter\(item\)"/)
  assert.match(pickerSource, /@keydown\.space\.prevent="selectItem\(item\)"/)
  assert.match(pickerSource, /Number\(selectedId\.value\) === Number\(item\.id\)[\s\S]*confirmSelection\(\)[\s\S]*selectItem\(item\)/)
  assert.match(pickerSource, /\{\{ item\.source_drama_title \|\| '全局上传' \}\}/)
})

test('FilmCreate wires the picker into storyboard free references with duplicate, promote, and remove flows', () => {
  assert.match(filmCreateSource, /<GlobalMediaPickerDialog[\s\S]*@select="onGlobalMediaAssetSelected"/)
  assert.match(filmCreateSource, /<el-form-item label="素材中心参考图">/)
  assert.match(filmCreateSource, /openGlobalMediaPicker\(videoParamsTarget, 'reference-primary'\)/)
  assert.match(filmCreateSource, /openGlobalMediaPicker\(videoParamsTarget, 'reference'\)/)
  assert.match(filmCreateSource, /storyboardsAPI\.update\(sb\.id, \{ reference_images: nextImages \}\)/)
  assert.match(filmCreateSource, /ElMessage\.warning\('该图片已经挂到当前分镜的自由参考图中'\)/)
  assert.match(filmCreateSource, /ElMessage\.warning\('该图片已经是当前分镜的视频主参考'\)/)
  assert.match(filmCreateSource, /onPromoteSbFreeReferenceImage\(videoParamsTarget, item\)/)
  assert.match(filmCreateSource, /onRemoveSbFreeReferenceImage\(videoParamsTarget, index\)/)
  assert.match(filmCreateSource, /\{\{ item\.source_drama_title \|\| '全局上传' \}\}/)
  assert.match(filmCreateSource, /\.vp-reference-thumb\s*\{[\s\S]*width:\s*64px;[\s\S]*height:\s*64px;[\s\S]*overflow:\s*hidden;/)
  assert.match(filmCreateSource, /\.vp-reference-thumb img\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*object-fit:\s*cover;/)
  assert.match(filmCreateSource, /\.vp-reference-item\s*\{[\s\S]*grid-template-columns:\s*64px minmax\(0, 1fr\);/)
})

test('all storyboard video submission paths reuse the shared video request builder', () => {
  const requestBuilderUses = filmCreateSource.match(/videosAPI\.create\(buildStoryboardVideoRequest\(/g) || []
  assert.equal(requestBuilderUses.length, 4)
  assert.match(filmCreateSource, /referenceImageUrls: referencePayload\.referenceUrls/)
  assert.match(filmCreateSource, /const primaryReferenceUrl = getSbPrimaryReferenceAbsoluteUrl\(sb\)/)
})
