import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { useFilmCreateMediaPreview } from '../src/composables/filmCreate/useFilmCreateMediaPreview.js'
import { remainingImportedFunctionSource } from './helpers/remainingSourceBetween.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const dialogSource = read('../src/components/ImagePreviewDialog.vue')
const filmListSource = read('../src/views/FilmList.vue')
const freeCreateSource = read('../src/views/FreeCreate.vue')
const filmCreateSource = read('../src/views/FilmCreate.vue')
const resourceDialogsSource = read('../src/components/filmCreate/FilmCreateResourceDialogs.vue')
const resourcePanelSource = read('../src/components/filmCreate/FilmCreateResourcePanel.vue')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const dramaCanvasSource = read('../src/views/DramaCanvas.vue')

test('shared image preview uses an accessible Element Plus dialog', () => {
  assert.match(dialogSource, /<AccessibleDialog/)
  assert.match(dialogSource, /:title="title"/)
  assert.match(dialogSource, /append-to-body/)
  assert.match(dialogSource, /:show-close="true"/)
  assert.match(dialogSource, /:close-on-press-escape="true"/)
  assert.match(dialogSource, /@update:model-value="updateVisible"/)
  assert.match(dialogSource, /:alt="resolvedAlt"/)
  assert.match(dialogSource, /imageHasRenderableDimensions\(event\.currentTarget\)/)
  assert.match(dialogSource, /@error="handleImageError"/)
  assert.match(dialogSource, /role="alert"/)
  assert.match(dialogSource, />关闭预览<\/el-button>/)
})

test('FilmList library previews are named native buttons with meaningful image alternatives', () => {
  assert.match(filmListSource, /import ImagePreviewDialog from '@\/components\/ImagePreviewDialog\.vue'/)
  assert.match(filmListSource, /<ImagePreviewDialog[\s\S]*v-model="showImagePreview"/)
  assert.equal((filmListSource.match(/type="button"\s+class="library-item-cover"/g) || []).length, 3)
  assert.equal((filmListSource.match(/type="button"\s+class="lib-img-thumb"/g) || []).length, 3)
  assert.match(filmListSource, /角色素材「\$\{item\.name \|\| '未命名'\}」预览图/)
  assert.match(filmListSource, /场景素材「\$\{item\.location \|\| item\.time \|\| '未命名'\}」预览图/)
  assert.match(filmListSource, /道具素材「\$\{item\.name \|\| '未命名'\}」预览图/)
  assert.equal((filmListSource.match(/role="img" aria-label="(?:角色|场景|道具)素材暂无图片"/g) || []).length, 3)
  assert.doesNotMatch(filmListSource, /<div class="library-item-cover" @click=/)
  assert.doesNotMatch(filmListSource, /<div class="lib-img-thumb" @click=/)
  assert.doesNotMatch(filmListSource, /image-preview-overlay/)
})

test('FreeCreate keeps drag-and-drop while all image actions remain keyboard operable', () => {
  assert.match(freeCreateSource, /class="ref-image-zone"[\s\S]*@dragover\.prevent[\s\S]*@drop\.prevent="onRefImageDrop"/)
  assert.match(freeCreateSource, /<button[\s\S]*class="ref-image-trigger"[\s\S]*@click="triggerRefImageUpload"/)
  assert.match(freeCreateSource, /alt="当前视频参考图"/)
  assert.match(freeCreateSource, /class="result-image-button"/)
  assert.match(freeCreateSource, /:alt="resultImageAlt\(item, idx\)"/)
  assert.match(freeCreateSource, /<ImagePreviewDialog[\s\S]*v-model="showImagePreview"/)
  assert.match(freeCreateSource, /<el-radio-group[\s\S]*aria-label="视频画面比例"[\s\S]*class="aspect-ratio-group"/)
  assert.match(freeCreateSource, />\s*重试上传\s*<\/el-button>/)
  assert.match(freeCreateSource, />\s*移除\s*<\/el-button>/)
  assert.doesNotMatch(freeCreateSource, /class="ref-image-zone" @click=/)
  assert.doesNotMatch(freeCreateSource, /<img[\s\S]{0,180}@click="previewUrl/)
  assert.doesNotMatch(freeCreateSource, /image-preview-overlay/)
})

test('FilmCreate and DramaDetail use the shared focus-managed preview for every thumbnail family', () => {
  for (const source of [filmCreateSource, dramaDetailSource]) {
    assert.match(source, /import ImagePreviewDialog from '@\/components\/ImagePreviewDialog\.vue'/)
    assert.match(source, /<ImagePreviewDialog/)
    assert.doesNotMatch(source, /image-preview-overlay/)
    assert.doesNotMatch(source, /<img\b[^>]*@click/)
  }

  assert.equal((dramaDetailSource.match(/type="button" class="library-item-cover"/g) || []).length, 4)
  assert.equal((dramaDetailSource.match(/type="button" class="drama-res-cover"/g) || []).length, 3)
  assert.equal((dramaDetailSource.match(/type="button" class="lib-img-thumb"/g) || []).length, 6)
  assert.equal((resourceDialogsSource.match(/type="button" class="library-item-cover"/g) || []).length, 6)
  assert.equal((resourceDialogsSource.match(/class="ref-image-box" aria-label=/g) || []).length, 4)
  assert.match(remainingImportedFunctionSource(useFilmCreateMediaPreview), /await probeImageSource\(source\)/)
  assert.match(filmCreateSource, /hasSbDraftImagePlaceholder/)
  assert.match(remainingImportedFunctionSource(useFilmCreateMediaPreview), /草稿占位/)
})

test('custom canvas and asset controls expose native or complete keyboard semantics', () => {
  assert.match(dramaCanvasSource, /<button type="button" class="logo" aria-label="返回项目列表"/)
  assert.equal((dramaCanvasSource.match(/class="sidebar-item"/g) || []).length, 3)
  assert.match(filmCreateSource, /<button type="button" class="logo" aria-label="返回项目列表"/)
  assert.equal((resourcePanelSource.match(/:role="hasAssetImage\(/g) || []).length, 3)
  assert.equal((resourcePanelSource.match(/@keydown\.enter\.prevent=/g) || []).length, 3)
  assert.equal((resourcePanelSource.match(/@keydown\.space\.prevent=/g) || []).length, 3)
  assert.doesNotMatch(dramaCanvasSource, /<h1\b[^>]*@click/)
  assert.doesNotMatch(filmCreateSource, /<h1\b[^>]*@click/)
  assert.doesNotMatch(dramaDetailSource, /<h1\b[^>]*@click/)
})
