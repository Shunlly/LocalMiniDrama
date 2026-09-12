import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('SD2 资产弹窗和列表操作有中文名称', () => {
  const dialogs = read('../src/components/sd2/Sd2AssetDialogs.vue')
  const list = read('../src/components/sd2/Sd2AssetList.vue')
  const groups = read('../src/components/sd2/Sd2AssetGroupList.vue')
  assert.match(dialogs, /'取消新建资产组'/)
  assert.match(dialogs, /aria-label="关闭资产详情"/)
  assert.match(list, /'新建资产'/)
  assert.match(groups, /'新建资产组'/)
})

test('画布侧栏、浮动工具条和媒体面板使用中文动作名', () => {
  const sidebar = read('../src/components/dramaCanvas/FreeCanvasAssetSidebar.vue')
  const toolbar = read('../src/components/dramaCanvas/CanvasFloatingToolbar.vue')
  const media = read('../src/components/dramaCanvas/CanvasMediaPanel.vue')
  assert.match(sidebar, /aria-label="查看项目素材"/)
  assert.match(sidebar, /添加角色\$\{item\.name/)
  assert.match(toolbar, /aria-label="添加分镜"/)
  assert.match(media, /aria-label="刷新分镜状态"/)
  assert.match(media, /'重新生成视频'/)
})

test('素材中心加载失败、搜索和预览关闭有中文名称', () => {
  const grid = read('../src/components/mediaLibrary/MediaLibraryLocalGrid.vue')
  const network = read('../src/components/mediaLibrary/MediaLibraryNetworkPanel.vue')
  const preview = read('../src/components/mediaLibrary/MediaLibraryPreviewDialogs.vue')
  const empty = read('../src/components/mediaLibrary/MediaLibraryEmptyState.vue')
  assert.match(grid, /'重试加载素材'/)
  assert.match(grid, /aria-label="取消选择"/)
  assert.match(network, /'搜索网络素材'/)
  assert.match(preview, /aria-label="关闭预览"/)
  assert.match(empty, /aria-label="清除筛选"/)
})

test('一键配置弹窗取消与提交区分厂商', () => {
  const dialogs = read('../src/components/aiConfig/AiConfigOneKeyDialogs.vue')
  assert.match(dialogs, /aria-label="取消一键配置通义"/)
  assert.match(dialogs, /aria-label="取消一键配置火山"/)
  assert.match(dialogs, /aria-label="取消一键配置 Agnes"/)
})
