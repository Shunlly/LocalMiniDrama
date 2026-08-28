import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const requestSource = readFileSync(new URL('../src/utils/request.js', import.meta.url), 'utf8')
const feedbackSource = readFileSync(new URL('../src/utils/elementPlusFeedback.js', import.meta.url), 'utf8')
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const pipelineRunSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreatePipelineRun.js', import.meta.url), 'utf8')
const productionReadinessSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateProductionReadiness.js', import.meta.url), 'utf8')
const deliveryPanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url),
  'utf8',
)
const filmListSource = readFileSync(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')
const mediaLibrarySource = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')

test('entry loads Element Plus config provider and dialogs on demand', () => {
  assert.match(
    mainSource,
    /import \{ ElConfigProvider \} from 'element-plus\/es\/components\/config-provider\/index\.mjs'/,
  )
  assert.match(mainSource, /import AccessibleDialog from '\.\/components\/AccessibleDialog\.vue'/)
  assert.doesNotMatch(mainSource, /element-plus\/es\/components\/message\/style\/css/)
  assert.doesNotMatch(mainSource, /element-plus\/es\/components\/message-box\/style\/css/)
})

test('request feedback and list loaders share timeout, cancel and retry', () => {
  assert.match(feedbackSource, /element-plus\/es\/components\/message\/index\.mjs/)
  assert.match(feedbackSource, /element-plus\/es\/components\/message-box\/index\.mjs/)
  assert.match(requestSource, /from '\.\/elementPlusFeedback\.js'/)
  assert.match(requestSource, /describeServiceLoadError/)
  assert.match(requestSource, /isRequestCanceled/)
  assert.match(filmListSource, /withRequestRetry/)
  assert.match(filmListSource, /isRequestCanceled/)
  assert.match(filmListSource, /describeServiceLoadError/)
  assert.match(filmListSource, /signal: controller\.signal/)
  assert.match(mediaLibrarySource, /withRequestRetry/)
  assert.match(mediaLibrarySource, /describeServiceLoadError/)
})

test('FilmCreate delivery panel owns export actions and imports split helpers', () => {
  assert.match(filmCreateSource, /<FilmCreateDeliveryPanel/)
  assert.match(filmCreateSource, /from '@\/utils\/filmCreateDelivery'/)
  assert.match(productionReadinessSource, /from '@\/utils\/coreJsonRequest'/)
  assert.match(pipelineRunSource, /from '@\/utils\/filmCreateConcurrency'/)
  assert.match(filmCreateSource, /from '@\/utils\/filmCreateEstimates'/)
  assert.doesNotMatch(filmCreateSource, /async function fetchVerifiedVideoBlob/)
  assert.doesNotMatch(filmCreateSource, /function normalizeVideoDownloadFilenamePart/)
  assert.match(deliveryPanelSource, /<section id="anchor-video" class="section card delivery-section">/)
  assert.match(deliveryPanelSource, /@click="\$emit\('download-video'\)"/)
  assert.match(deliveryPanelSource, /videoDownloadStatus === 'error' \? '重试下载' : '下载成片'/)
})
