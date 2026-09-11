import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ElMessage, ElMessageBox } from '../src/utils/elementPlusFeedback.js'
import {
  describeServiceLoadError,
  isRequestCanceled,
  withRequestRetry,
} from '../src/utils/requestError.js'
import { shouldShowRequestErrorToast } from '../src/utils/request.js'
import { requestCoreJson } from '../src/utils/coreJsonRequest.js'
import { runConcurrently } from '../src/utils/filmCreateConcurrency.js'
import {
  fetchVerifiedVideoBlob,
  normalizeVideoDownloadFilenamePart,
} from '../src/utils/filmCreateDelivery.js'
import { clipSecondsForStoryboardEstimate } from '../src/utils/filmCreateEstimates.js'
import { readFilmListSources } from './helpers/filmListSources.js'
import { readMediaLibrarySources } from './helpers/mediaLibrarySources.js'

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const routerSource = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
const registerSource = readFileSync(new URL('../src/elementPlus/register.js', import.meta.url), 'utf8')
const feedbackSource = readFileSync(new URL('../src/utils/elementPlusFeedback.js', import.meta.url), 'utf8')
const viteSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const deliveryPanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url),
  'utf8',
)
const filmListSource = readFilmListSources().ui
const mediaLibrarySource = readMediaLibrarySources()

test('entry loads Element Plus config provider and dialogs on demand', () => {
  assert.equal(typeof ElMessage.error, 'function')
  assert.equal(typeof ElMessageBox.confirm, 'function')
  assert.match(mainSource, /from '\.\/elementPlus\/register\.js'/)
  assert.match(mainSource, /import AccessibleDialog from '\.\/components\/AccessibleDialog\.vue'/)
  assert.match(
    registerSource,
    /import \{ ElConfigProvider \} from 'element-plus\/es\/components\/config-provider\/index\.mjs'/,
  )
  assert.match(registerSource, /element-plus\/es\/locale\/lang\/zh-cn\.mjs/)
  assert.match(registerSource, /element-plus\/es\/components\/config-provider\/style\/css/)
  assert.match(feedbackSource, /element-plus\/es\/components\/message\/index\.mjs/)
  assert.match(feedbackSource, /element-plus\/es\/components\/message-box\/index\.mjs/)
  assert.doesNotMatch(mainSource, /from ['"]element-plus['"]/)
  assert.doesNotMatch(mainSource, /app\.use\(\s*ElementPlus/)
  assert.doesNotMatch(mainSource, /element-plus\/es\/components\/message\/style\/css/)
  assert.doesNotMatch(mainSource, /element-plus\/es\/components\/message-box\/style\/css/)
  assert.doesNotMatch(registerSource, /element-plus\/dist/)
  assert.doesNotMatch(registerSource, /theme-chalk\/index/)
  assert.doesNotMatch(feedbackSource, /from ['"]element-plus['"]/)
  assert.doesNotMatch(viteSource, /elementPlusComponentEntries/)
  assert.doesNotMatch(viteSource, /unplugin-vue-components\/resolvers/)
  assert.doesNotMatch(viteSource, /unplugin-element-plus/)
  assert.doesNotMatch(viteSource, /element-plus\/dist/)
  assert.match(viteSource, /createElementPlusOnDemandPlugins/)
  assert.match(viteSource, /createElementPlusResolvers/)
})

test('request feedback and list loaders share timeout, cancel and retry', async () => {
  assert.equal(shouldShowRequestErrorToast({ config: {} }), true)
  assert.equal(shouldShowRequestErrorToast({ config: { suppressErrorToast: true } }), false)
  assert.equal(isRequestCanceled({ name: 'AbortError' }), true)
  assert.match(describeServiceLoadError({ name: 'AbortError' }, { canceled: '已取消' }), /已取消/)

  let attempts = 0
  const result = await withRequestRetry(async () => {
    attempts += 1
    if (attempts === 1) {
      const error = new Error('network')
      error.code = 'ERR_NETWORK'
      throw error
    }
    return 'ok'
  }, { retries: 1, delayMs: 0 })
  assert.equal(result, 'ok')
  assert.equal(attempts, 2)

  assert.match(filmListSource, /withRequestRetry/)
  assert.match(filmListSource, /isRequestCanceled/)
  assert.match(filmListSource, /describeServiceLoadError/)
  assert.match(mediaLibrarySource, /withRequestRetry/)
  assert.match(mediaLibrarySource, /describeServiceLoadError/)
})

test('FilmCreate delivery panel owns export actions and imports split helpers', async () => {
  assert.equal(normalizeVideoDownloadFilenamePart('测试:<项目>', '成片'), '测试__项目_')
  assert.equal(clipSecondsForStoryboardEstimate(8), 8)
  const seen = []
  await runConcurrently(['a', 'b'], 2, async (item) => { seen.push(item) })
  assert.deepEqual(seen.sort(), ['a', 'b'])

  const blob = await fetchVerifiedVideoBlob('/static/final.mp4', async (url, options) => {
    assert.equal(url, '/static/final.mp4')
    assert.match(options.headers.Accept, /video\/*/)
    return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })
  })
  assert.equal(blob.type, 'video/mp4')

  const drama = await requestCoreJson('/dramas/7', {
    fetchImpl: async (url) => new Response(JSON.stringify({ success: true, data: { id: 7 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  })
  assert.equal(drama.id, 7)

  const outputSectionSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateOutputSection.vue', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /<FilmCreateOutputSection/)
  assert.match(outputSectionSource, /<FilmCreateDeliveryPanel/)
  assert.doesNotMatch(filmCreateSource, /async function fetchVerifiedVideoBlob/)
  assert.doesNotMatch(filmCreateSource, /function normalizeVideoDownloadFilenamePart/)
  assert.match(deliveryPanelSource, /<section id="anchor-video" class="section card delivery-section">/)
  assert.match(deliveryPanelSource, /@click="\$emit\('download-video'\)"/)
  assert.match(deliveryPanelSource, /videoDownloadStatus === 'error' \? '重试下载' : '下载成片'/)
})

test('router keeps axios request feedback out of the initial graph', () => {
  assert.match(mainSource, /import router from '\.\/router'/)
  assert.match(routerSource, /component: \(\) => import\('@\/views\/Backup\.vue'\)/)
  assert.doesNotMatch(routerSource, /from ['"][^'"]*useBackupSettings/)
  assert.doesNotMatch(routerSource, /from ['"][^'"]*utils\/request/)
  assert.doesNotMatch(routerSource, /from ['"][^'"]*elementPlusFeedback/)
  assert.doesNotMatch(routerSource, /from ['"]axios['"]/)
  assert.doesNotMatch(routerSource, /from ['"]element-plus['"]/)
  assert.doesNotMatch(mainSource, /from ['"][^'"]*utils\/request/)
  assert.doesNotMatch(mainSource, /from ['"][^'"]*useBackupSettings/)
})

test('制作页与画布拆成独立异步块，且不把 Element Plus 打回全量共享块', () => {
  assert.match(viteSource, /name: 'canvas-domain'/)
  assert.match(viteSource, /name: 'vue-flow'/)
  assert.match(viteSource, /name: 'film-create-domain'/)
  assert.match(viteSource, /name: 'film-create-utils'/)
  assert.match(viteSource, /includeDependenciesRecursively:\s*false/)
  assert.match(viteSource, /composables/)
  assert.match(viteSource, /filmCreate/)
  assert.doesNotMatch(viteSource, /name: 'element-plus'/)
  assert.doesNotMatch(viteSource, /return 'element-plus'/)
})
