import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const toolbarSource = read('../src/components/dramaCanvas/FreeCanvasToolbar.vue')
const nodeSource = read('../src/components/dramaCanvas/FreeCanvasNode.vue')
const inspectorSource = read('../src/components/dramaCanvas/FreeCanvasInspector.vue')
const inspectorMediaSource = read('../src/components/dramaCanvas/CanvasMediaPanel.vue')
const storyboardPanelSource = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
const assetSidebarSource = read('../src/components/dramaCanvas/FreeCanvasAssetSidebar.vue')
const desktopToolbarSource = read('../src/components/dramaCanvas/CanvasDesktopToolbar.vue')
const contextMenuSource = read('../src/components/dramaCanvas/CanvasContextMenu.vue')
const dramaCanvasSource = read('../src/views/DramaCanvas.vue')

test('free canvas toolbar names every icon-only action and exposes mode selection', () => {
  for (const label of ['撤销', '重做', '适配视图', '切换背景']) {
    assert.match(toolbarSource, new RegExp(`aria-label="${label}"`))
    assert.match(toolbarSource, new RegExp(`title="${label}"`))
  }
  assert.match(toolbarSource, /libraryActionLabel/)
  assert.match(toolbarSource, /'收起素材栏'/)
  assert.match(toolbarSource, /'展开素材栏'/)
  assert.match(toolbarSource, /:aria-pressed="mode === 'free'"/)
  assert.match(toolbarSource, /:aria-pressed="mode === 'production'"/)
  assert.match(toolbarSource, /v-if="isFreeMode"/)
  assert.match(toolbarSource, /if \(!isFreeMode\.value\) return/)
  for (const event of ['create-node', 'undo', 'redo', 'fit-view', 'set-background', 'toggle-library']) {
    assert.match(toolbarSource, new RegExp(`'${event}'`))
  }
})

test('free canvas create menu keeps the button as the dropdown trigger', () => {
  assert.match(
    toolbarSource,
    /<el-tooltip[^>]+content="新建自由节点"[\s\S]*?<el-dropdown trigger="click" @command="createNode">\s*<el-button[^>]+aria-label="新建自由节点"/,
  )
  assert.doesNotMatch(
    toolbarSource,
    /<el-dropdown[^>]*>\s*<el-tooltip[^>]+content="新建自由节点"/,
  )
})

test('free mode node renders text safely and protects editor gestures from the canvas', () => {
  assert.doesNotMatch(nodeSource, /v-html/)
  assert.match(nodeSource, /\{\{\s*displayContent\b/)
  assert.match(nodeSource, /v-if="isFreeMode"/)
  assert.match(nodeSource, /<Handle[^>]+v-if="isFreeMode"[^>]+type="target"/)
  assert.match(nodeSource, /<Handle[^>]+v-if="isFreeMode"[^>]+type="source"/)
  assert.match(nodeSource, /nodrag nopan/)
  for (const event of [
    'update-content',
    'request-convert',
    'request-delete',
    'request-retry',
    'request-configure',
    'request-cancel-config',
    'request-retry-config',
  ]) {
    assert.match(nodeSource, new RegExp(`'${event}'`))
  }
  assert.match(nodeSource, /height: 208px;/)
  assert.match(nodeSource, /grid-template-rows: 24px 20px minmax\(72px, 1fr\) 24px;/)
  assert.match(nodeSource, /role="alert"/)
  assert.match(nodeSource, /aria-live="assertive"/)
  assert.match(nodeSource, /editing:\s*\{\s*type:\s*Boolean/)
  assert.match(nodeSource, /props\.editing\s*&&\s*!props\.readonly\s*&&\s*props\.node\.type === 'text'/)
  assert.match(nodeSource, /@blur="finishEditing"/)
  assert.match(nodeSource, /:data-free-node-id="String\(node\.id\)"/)
  assert.match(nodeSource, /overflow: visible;/)
  assert.match(nodeSource, /<Handle[\s\S]*?type="target"[\s\S]*?:data-free-node-id="String\(node\.id\)"/)
  assert.match(nodeSource, /<Handle[\s\S]*?type="source"[\s\S]*?:data-free-node-id="String\(node\.id\)"/)
  assert.match(nodeSource, /\.free-canvas-node :deep\(\.vue-flow__handle\)/)
  assert.match(dramaCanvasSource, /\.drama-canvas-page\.free-mode[\s\S]*?\.vue-flow__node-freeCanvas[\s\S]*?overflow:\s*visible/)
  assert.match(dramaCanvasSource, /await new Promise\(\(resolve\) => setTimeout\(resolve, duration \+ 50\)\)/)
})

test('free image and video nodes render real media with stable loading and retry states', () => {
  assert.match(nodeSource, /mediaUrl:\s*\{\s*type:\s*String/)
  assert.match(nodeSource, /<img[\s\S]*?:src="mediaUrl"[\s\S]*?@load="markMediaReady"[\s\S]*?@error="markMediaFailed"/)
  assert.match(nodeSource, /<video[\s\S]*?:src="mediaUrl"[\s\S]*?controls[\s\S]*?@loadedmetadata="markMediaReady"[\s\S]*?@error="markMediaFailed"/)
  assert.match(nodeSource, /const mediaState = ref\('idle'\)/)
  assert.match(nodeSource, /function retryMedia\(\)/)
  assert.match(nodeSource, /role="status"/)
  assert.match(nodeSource, /role="alert"/)
})

test('free video controls stay interactive without opening the node inspector', () => {
  assert.match(nodeSource, /<video[\s\S]*?@pointerdown\.stop[\s\S]*?@mousedown\.stop[\s\S]*?@click\.stop[\s\S]*?@dblclick\.stop/)
})

test('free canvas inspector exposes an explicit production conversion target', () => {
  assert.match(inspectorSource, /aria-label="转换目标"/)
  assert.match(inspectorSource, /v-model="conversionTarget"/)
  assert.match(inspectorSource, /:model-value="draft\.title"[^>]+@update:model-value="updateDraftField\('title', \$event\)"/)
  assert.match(inspectorSource, /:model-value="draft\.content"[^>]+@update:model-value="updateDraftField\('content', \$event\)"/)
  assert.match(inspectorSource, /function updateDraftField\(field, value\)/)
  assert.match(
    dramaCanvasSource,
    /function updateFreeCanvasNode\([\s\S]*?commitFreeCanvasState\([\s\S]*?`text:\$\{nodeId\}`\)/,
  )
  assert.match(inspectorSource, /@click="emitConvertReference"/)
  for (const event of [
    'update-node',
    'convert-reference',
    'save-asset',
    'close',
    'configure',
    'cancel-config',
    'retry-config',
  ]) {
    assert.match(inspectorSource, new RegExp(`'${event}'`))
  }
  assert.doesNotMatch(inspectorSource, /dramaAPI|fetch\(|axios|request\(/)
})

test('config nodes expose input, provider gate, configure, cancel, and retry states', () => {
  assert.match(nodeSource, /configRuntime\.inputSummary/)
  assert.match(nodeSource, /configRuntime\.providerLabel/)
  assert.match(nodeSource, /configRuntime\.statusLabel/)
  assert.match(nodeSource, /configRuntime\.canConfigure/)
  assert.match(nodeSource, /configRuntime\.canCancel/)
  assert.match(nodeSource, /configRuntime\.canRetry/)
  assert.match(inspectorSource, /aria-label="生成配置状态"/)
  assert.match(dramaCanvasSource, /buildFreeCanvasConfigRuntime/)
  assert.match(dramaCanvasSource, /getVideoGenerationCapability/)
  assert.match(dramaCanvasSource, /refreshFreeCanvasVideoCapability/)
})

test('desktop toolbar and context menu expose free mode entry points without replacing production actions', () => {
  assert.doesNotMatch(desktopToolbarSource, /FreeCanvasToolbar/)
  assert.match(desktopToolbarSource, /aria-label="画布模式"/)
  assert.match(dramaCanvasSource, /<FreeCanvasToolbar[\s\S]*?v-if="canvasMode === 'free'"[\s\S]*?:show-mode-switch="false"/)
  assert.match(dramaCanvasSource, /class="free-canvas-bottom-toolbar"/)
  assert.match(contextMenuSource, /free-node/)
  assert.match(contextMenuSource, /'text'/)
  assert.match(contextMenuSource, /'image'/)
})

test('free canvas selection and editing keep single, multi-select, and history modes isolated', () => {
  assert.match(dramaCanvasSource, /const editingFreeNodeId = ref\(null\)/)
  assert.match(dramaCanvasSource, /function startFreeCanvasNodeEditing\(nodeId\)/)
  assert.match(dramaCanvasSource, /selectedFreeNodeIds\.value\.length > 1[\s\S]*?selectedFreeNodeId\.value = null/)
  assert.match(dramaCanvasSource, /function undoFreeCanvas\(\)[\s\S]*?canvasMode\.value !== 'free'/)
  assert.match(dramaCanvasSource, /function redoFreeCanvas\(\)[\s\S]*?canvasMode\.value !== 'free'/)
  assert.match(dramaCanvasSource, /normalizeFreeCanvasForProject\(\{[\s\S]*?\.\.\.nextState,[\s\S]*?mode: activeMode/)
})

test('keyboard node activation synchronizes selection before destructive shortcuts', () => {
  assert.match(dramaCanvasSource, /function activateFreeCanvasNode\(nodeId/)
  assert.match(dramaCanvasSource, /synchronizeFreeCanvasSelection\(nodes\.value, nodeId\)/)
  assert.match(
    dramaCanvasSource,
    /if \(event\.key === 'Enter' \|\| event\.key === ' '||event\.key === ' ' \|\| event\.key === 'Enter'\)[\s\S]*?activateFreeCanvasNode/,
  )
  assert.match(dramaCanvasSource, /filter\(\(node\) => node\.selected && isFreeCanvasNodeId\(node\.id\)\)/)
  assert.match(dramaCanvasSource, /event\.key === 'Delete' \|\| event\.key === 'Backspace'[\s\S]*deleteFreeCanvasSelection\(\)/)
  assert.match(
    dramaCanvasSource,
    /function deleteFreeCanvasSelection\(\) \{[\s\S]*removeFreeCanvasItems\(nodeIds, edgeIds\)[\s\S]*persistCanvasState\(\{ freeOnly: true \}\)/,
  )
})

test('free mode empty state exposes text config and media actions while production is demoted', () => {
  assert.match(dramaCanvasSource, /class="free-canvas-empty-state"/)
  assert.match(dramaCanvasSource, /@click="createFreeCanvasNode\('text'\)"/)
  assert.match(dramaCanvasSource, /@click="createFreeCanvasNode\('config'\)"/)
  assert.match(dramaCanvasSource, /@click="openFreeCanvasMediaPicker"/)
  assert.match(dramaCanvasSource, /\.drama-canvas-page\.free-mode[\s\S]*?\.vue-flow__node:not\(\.vue-flow__node-freeCanvas\)[\s\S]*?opacity:/)
})

test('free node placement reserves visible overlays and checks the merged graph', () => {
  assert.match(dramaCanvasSource, /function freeCanvasSafeBounds\(\)/)
  assert.match(dramaCanvasSource, /findFreeNodeSpawnPosition\([^\n]*nodes\.value,\s*\{\s*bounds\s*\}\)/)
})

test('multi-selection has stable copy and delete actions wired to shared commands', () => {
  assert.match(toolbarSource, /selectionCount:\s*\{\s*type:\s*Number/)
  assert.match(toolbarSource, /已选 \{\{ selectionCount \}\} 项/)
  assert.match(toolbarSource, /aria-label="复制所选节点"[\s\S]*?emit\('copy-selection'\)/)
  assert.match(toolbarSource, /aria-label="删除所选节点"[\s\S]*?emit\('delete-selection'\)/)
  assert.match(dramaCanvasSource, /@copy-selection="copyFreeCanvasSelection"/)
  assert.match(dramaCanvasSource, /@delete-selection="deleteFreeCanvasSelection"/)
})

test('save failures remain visible with retry until a successful save clears them', () => {
  assert.match(dramaCanvasSource, /const layoutSaveError = ref\(''\)/)
  assert.match(dramaCanvasSource, /class="layout-save-error"[\s\S]*?\{\{ layoutSaveError \}\}/)
  assert.match(dramaCanvasSource, /const saveError = safeFreeCanvasError[\s\S]*?layoutError: saveOperation\.writesLayout \? saveError/)
  assert.match(dramaCanvasSource, /layoutSaveError\.value = canvasSaveOperationError\(failedCanvasSaveOperation\.value\)/)
  assert.match(dramaCanvasSource, /const remainingError = canvasSaveOperationError\(remainingFailure\)/)
  assert.match(dramaCanvasSource, /layoutSaveError\.value = ''/)
  assert.match(dramaCanvasSource, /aria-live="polite"/)
  assert.match(dramaCanvasSource, /if \(failedCanvasSaveOperation\.value\) layoutSaveState\.value = 'error'/)
  assert.match(dramaCanvasSource, /, 4000\)/)
})

test('inspector disables save-as-asset with an accessible eligibility reason', () => {
  assert.match(inspectorSource, /saveAssetEligibility/)
  assert.match(inspectorSource, /!saveAssetEligibility\.eligible/)
  assert.match(inspectorSource, /saveAssetEligibility\.reason/)
  assert.match(dramaCanvasSource, /getFreeCanvasAssetSaveEligibility/)
})

test('free canvas uses a collapsible project media sidebar with upload and drag-drop entry points', () => {
  assert.match(assetSidebarSource, /<details[^>]+open/)
  assert.match(assetSidebarSource, /项目素材/)
  assert.match(assetSidebarSource, /分镜媒体/)
  assert.match(assetSidebarSource, /type="file"[\s\S]*?accept="image\/\*,video\/\*"/)
  assert.match(assetSidebarSource, /@drop\.prevent="handleDrop"/)
  assert.match(dramaCanvasSource, /<FreeCanvasAssetSidebar/)
  assert.match(dramaCanvasSource, /function uploadFreeCanvasFiles\(files, position/)
  assert.match(dramaCanvasSource, /uploadAPI\.uploadAsset\(file, \{ dramaId:/)
  assert.match(dramaCanvasSource, /@drop="onFreeCanvasDrop"/)
  assert.match(dramaCanvasSource, /function ensureFreeCanvasUploadFinished\(\)/)
  assert.match(dramaCanvasSource, /素材正在上传，请等待完成后再离开/)
})

test('asset sidebar exposes one upload stop plus keyword type filtering and project asset reveal', () => {
  assert.match(assetSidebarSource, /type="file"[\s\S]*?aria-label="上传本地图片或视频"[\s\S]*?tabindex="-1"/)
  assert.match(assetSidebarSource, /aria-label="搜索创作素材"/)
  assert.match(assetSidebarSource, /aria-label="素材类型"/)
  assert.match(assetSidebarSource, /filterFreeCanvasAssetItems/)
  assert.match(assetSidebarSource, /@click="revealProjectAssets"/)
  assert.match(assetSidebarSource, /ref="projectAssetsSectionRef"/)
})

test('context menu moves focus into the menu and restores it on close', () => {
  assert.match(contextMenuSource, /ref="menuRef"/)
  assert.match(contextMenuSource, /tabindex="-1"/)
  assert.match(contextMenuSource, /@keydown\.esc\.prevent="close"/)
  assert.match(contextMenuSource, /menuRef\.value\?\.focus\(\)/)
  assert.match(contextMenuSource, /returnFocus\?\.focus\(\)/)
  assert.match(contextMenuSource, /watch\(\(\) => props\.visible/)
})

test('free inspector dock exposes the node id that focus restore actually reads', () => {
  assert.match(dramaCanvasSource, /class="free-canvas-inspector-dock"/)
  assert.match(dramaCanvasSource, /:data-free-node-id="String\(selectedFreeNode\.id\)"/)
  assert.match(dramaCanvasSource, /inspector\?\.dataset\?\.freeNodeId/)
  assert.doesNotMatch(dramaCanvasSource, /data-free-inspector-node-id/)
})

test('creating a free node suppresses the empty selection race until Vue Flow settles', () => {
  assert.match(
    dramaCanvasSource,
    /function createFreeCanvasNode\([\s\S]*ignoreEmptyFreeSelectionUntil = Date\.now\(\) \+ 1500[\s\S]*commitFreeCanvasState/,
  )
})

test('project-list return actions keep list-mode and project-list destinations distinct', () => {
  assert.match(dramaCanvasSource, /<button type="button" class="logo" aria-label="返回项目列表" @click="goProjectList">/)
  assert.match(dramaCanvasSource, /canvas-load-actions[\s\S]*@click="goProjectList">返回项目列表/)
  assert.match(dramaCanvasSource, /free-canvas-version-warning[\s\S]*@click="goListMode">列表模式/)
  assert.match(dramaCanvasSource, /function goProjectList\(\)[\s\S]*projectListReturnTo\.value \|\| '\/'/)
})

test('delete shortcut ignores inspector and other editable chrome', () => {
  assert.match(
    dramaCanvasSource,
    /event\.key === 'Delete' \|\| event\.key === 'Backspace'[\s\S]*free-canvas-inspector-dock[\s\S]*deleteFreeCanvasSelection\(\)/,
  )
})

test('free-mode controls sit above the bottom toolbar and hide the minimap on small inspector layouts', () => {
  assert.match(dramaCanvasSource, /\.drama-canvas-page\.free-mode :deep\(\.vue-flow__controls\)[\s\S]*bottom: 76px/)
  assert.match(dramaCanvasSource, /max-width: min\(720px, calc\(100% - 160px\)\)/)
  assert.match(dramaCanvasSource, /\.drama-canvas-page\.free-inspector-open :deep\(\.vue-flow__minimap\)[\s\S]*display: none/)
})

test('first and last frame generation remains reachable from media and storyboard inspectors', () => {
  assert.match(inspectorMediaSource, /frameKind === 'first'/)
  assert.match(inspectorMediaSource, /重新生成\$\{frameTitle\.value\}/)
  assert.match(storyboardPanelSource, /runStep\('first-frame'\)/)
  assert.match(storyboardPanelSource, /runStep\('last-frame'\)/)
  assert.match(storyboardPanelSource, /runFrameImageStep/)
  assert.match(storyboardPanelSource, /dramaUsesFirstLastFrame/)
})
