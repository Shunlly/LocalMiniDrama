import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '@vue/compiler-sfc'

import { listMediaLibrarySourceFiles, readMediaLibrarySources } from './helpers/mediaLibrarySources.js'

const files = listMediaLibrarySourceFiles()
const byName = Object.fromEntries(files.map((file) => [file.name, file.source]))
const page = byName['MediaLibrary.vue']
const header = byName['MediaLibraryHeader.vue']
const filterBar = byName['MediaLibraryFilterBar.vue']
const localGrid = byName['MediaLibraryLocalGrid.vue']
const networkPanel = byName['MediaLibraryNetworkPanel.vue']
const card = byName['MediaLibraryCard.vue']
const emptyState = byName['MediaLibraryEmptyState.vue']
const networkCard = byName['MediaLibraryNetworkCard.vue']
const networkEmpty = byName['MediaLibraryNetworkEmpty.vue']
const previewDialogs = byName['MediaLibraryPreviewDialogs.vue']
const networkImportFeedback = byName['MediaLibraryNetworkImportFeedback.vue']
const sourceImportDialog = byName['MediaLibrarySourceImportDialog.vue']
const combined = readMediaLibrarySources()

function assertValidVueSfc(name, source) {
  const { errors } = parse(source, { filename: name })
  assert.deepEqual(errors, [], `${name} 必须仍是合法 Vue SFC`)
}

test('素材中心页把头、筛选、网格、卡片、空态和预览抽成展示组件，请求方法抽到 mediaLibrary 模块', () => {
  for (const file of files) {
    if (file.name.endsWith('.vue')) assertValidVueSfc(file.name, file.source)
  }

  assert.match(page, /<MediaLibraryHeader[\s\S]*v-bind="headerBindings"/)
  assert.match(page, /<MediaLibraryFilterBar[\s\S]*v-model:media-type="mediaType"[\s\S]*v-model:keyword="keyword"/)
  assert.match(page, /<MediaLibraryLocalGrid[\s\S]*v-model:page="page"[\s\S]*v-bind="localGridBindings"/)
  assert.match(page, /<MediaLibraryNetworkPanel[\s\S]*v-bind="networkPanelBindings"/)
  assert.match(page, /<MediaLibraryPreviewDialogs[\s\S]*v-bind="previewDialogBindings"/)
  assert.match(page, /<MediaLibraryNetworkImportFeedback[\s\S]*:import-network-item="importNetworkItem"/)
  assert.match(page, /<MediaLibrarySourceImportDialog[\s\S]*v-bind="sourceImportPickerBindings"/)
  assert.match(page, /createMediaLibrarySourceImport\(/)
  assert.match(localGrid, /<MediaLibraryCard[\s\S]*v-for="item in mediaItems"/)
  assert.match(localGrid, /<MediaLibraryEmptyState[\s\S]*v-if="!loading && hasSuccessfulMediaLoad && !loadError && mediaItems\.length === 0"/)
  assert.match(networkPanel, /<MediaLibraryNetworkCard[\s\S]*v-for="\(item, index\) in networkItems"/)
  assert.match(networkPanel, /<MediaLibraryNetworkEmpty/)

  assert.match(page, /createMediaLibraryNavigation\(/)
  assert.match(page, /createMediaLibraryLocalLoad\(/)
  assert.match(page, /createMediaLibraryNetworkActions\(/)
  assert.match(page, /createMediaLibrarySelection\(/)
  assert.match(page, /function triggerUpload\(/)
  assert.match(page, /async function onUpload\(/)
  assert.match(combined, /async function loadMedia\(/)
  assert.match(combined, /async function deleteItem\(/)
  assert.match(combined, /async function batchDelete\(/)
  assert.match(combined, /async function searchNetworkMedia\(/)
  assert.match(combined, /async function importNetworkItem\(/)
  for (const [name, source] of Object.entries({
    header, filterBar, localGrid, networkPanel, card, emptyState, networkCard, networkEmpty, previewDialogs, networkImportFeedback, sourceImportDialog,
  })) {
    assert.doesNotMatch(source, /async function /, `${name} 不应再持有异步写操作`)
  }
})

test('返回按钮、删除确认和空态文案保持产品合同', () => {
  assert.match(header, /:aria-label="returnTo \? '返回制作台' : '返回项目首页'"/)
  assert.match(header, /\{\{ returnTo \? '返回制作台' : '项目首页' \}\}/)
  assert.match(localGrid, /:aria-label="returnTo \? '返回制作台' : '返回项目首页'"/)
  assert.match(localGrid, /\{\{ returnTo \? '返回制作台' : '返回项目首页' \}\}/)
  assert.match(localGrid, /@click="goBack"/)
  assert.match(combined, /ElMessageBox\.confirm\(`\$\{describeMediaDeleteImpact\(item\)\}确定删除？`, '删除确认'/)
  assert.match(combined, /confirmButtonText: '删除'/)
  assert.match(combined, /当前项目（编号 \$\{scopedDramaId\.value\}）/)
  assert.doesNotMatch(header, /返回项目列表/)
  assert.doesNotMatch(combined, /用户可见 ID/)
  assert.doesNotMatch(combined, /微信我/)
})

test('上传、筛选空态、网络导入和删除禁用原因仍走中文展示', () => {
  assert.match(header, /:disabled="mediaWriteLocked \|\| uploading"/)
  assert.match(header, /:title="mediaUploadDisableReason \|\| undefined"/)
  assert.match(emptyState, /没有匹配的素材/)
  assert.match(emptyState, /素材中心还是空的/)
  assert.match(emptyState, /@click="clearFilters">清除筛选/)
  assert.match(localGrid, /v-if="!loading && hasSuccessfulMediaLoad && !loadError && mediaItems\.length === 0"/)
  assert.match(localGrid, /:disabled="mediaWriteLocked \|\| visibleSelectedMediaCount <= 0"/)
  assert.match(localGrid, /:title="mediaBatchDeleteDisableReason \|\| undefined"/)
  assert.match(networkEmpty, /没有找到匹配的网络素材/)
  assert.match(networkEmpty, /搜索可导入的网络素材/)
  assert.match(networkEmpty, /class="network-empty"\s*role="status"/)
  assert.match(networkImportFeedback, /aria-label="重试导入该网络素材"/)
  assert.match(page, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(combined, /from 'element-plus'/)
})
