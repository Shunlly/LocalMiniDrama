import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'

import { readMediaLibrarySources } from './helpers/mediaLibrarySources.js'

const page = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')
const header = readFileSync(new URL('../src/components/mediaLibrary/MediaLibraryHeader.vue', import.meta.url), 'utf8')
const filterBar = readFileSync(new URL('../src/components/mediaLibrary/MediaLibraryFilterBar.vue', import.meta.url), 'utf8')
const localGrid = readFileSync(new URL('../src/components/mediaLibrary/MediaLibraryLocalGrid.vue', import.meta.url), 'utf8')
const networkPanel = readFileSync(new URL('../src/components/mediaLibrary/MediaLibraryNetworkPanel.vue', import.meta.url), 'utf8')
const combined = readMediaLibrarySources()

function assertValidVueSfc(name, source) {
  const { errors } = parse(source, { filename: name })
  assert.deepEqual(errors, [], `${name} 必须仍是合法 Vue SFC`)
}

test('素材中心页把头、筛选、本地网格和网络区抽成展示组件，状态方法留在页面', () => {
  assertValidVueSfc('MediaLibrary.vue', page)
  assertValidVueSfc('MediaLibraryHeader.vue', header)
  assertValidVueSfc('MediaLibraryFilterBar.vue', filterBar)
  assertValidVueSfc('MediaLibraryLocalGrid.vue', localGrid)
  assertValidVueSfc('MediaLibraryNetworkPanel.vue', networkPanel)

  assert.match(page, /<MediaLibraryHeader[\s\S]*v-bind="headerBindings"/)
  assert.match(page, /<MediaLibraryFilterBar[\s\S]*v-model:media-type="mediaType"[\s\S]*v-model:keyword="keyword"/)
  assert.match(page, /<MediaLibraryLocalGrid[\s\S]*v-model:page="page"[\s\S]*v-bind="localGridBindings"/)
  assert.match(page, /<MediaLibraryNetworkPanel[\s\S]*v-bind="networkPanelBindings"/)

  assert.match(page, /async function loadMedia\(/)
  assert.match(page, /function triggerUpload\(/)
  assert.match(page, /async function onUpload\(/)
  assert.match(page, /async function deleteItem\(/)
  assert.match(page, /async function batchDelete\(/)
  assert.match(page, /async function searchNetworkMedia\(/)
  assert.match(page, /async function importNetworkItem\(/)
  assert.doesNotMatch(header, /async function /)
  assert.doesNotMatch(filterBar, /async function /)
  assert.doesNotMatch(localGrid, /async function /)
  assert.doesNotMatch(networkPanel, /async function /)
})

test('返回按钮、删除确认和空态文案保持产品合同', () => {
  assert.match(header, /:aria-label="returnTo \? '返回制作台' : '返回项目首页'"/)
  assert.match(header, /\{\{ returnTo \? '返回制作台' : '项目首页' \}\}/)
  assert.match(localGrid, />返回项目首页<\/el-button>/)
  assert.match(page, /ElMessageBox\.confirm\(`\$\{describeMediaDeleteImpact\(item\)\}确定删除？`, '删除确认'/)
  assert.match(page, /confirmButtonText: '删除'/)
  assert.match(combined, /当前项目（编号 \$\{scopedDramaId\.value\}）/)
  assert.doesNotMatch(header, /返回项目列表/)
  assert.doesNotMatch(localGrid, /用户可见 ID/)
})

test('上传、筛选空态、网络导入和删除禁用原因仍走中文展示', () => {
  assert.match(header, /:disabled="mediaWriteLocked \|\| uploading"/)
  assert.match(header, /:title="mediaUploadDisableReason \|\| undefined"/)
  assert.match(localGrid, /没有匹配的素材/)
  assert.match(localGrid, /素材中心还是空的/)
  assert.match(localGrid, /@click="clearFilters">清除筛选/)
  assert.match(localGrid, /v-if="!loading && hasSuccessfulMediaLoad && !loadError && mediaItems\.length === 0"/)
  assert.match(localGrid, /:disabled="mediaWriteLocked \|\| visibleSelectedMediaCount <= 0"/)
  assert.match(localGrid, /:title="mediaBatchDeleteDisableReason \|\| undefined"/)
  assert.match(networkPanel, /没有找到匹配的网络素材/)
  assert.match(networkPanel, /搜索可导入的网络素材/)
  assert.match(networkPanel, /class="network-empty"\s*role="status"/)
  assert.match(page, /aria-label="重试导入该网络素材"/)
  assert.match(page, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(combined, /from 'element-plus'/)
})
