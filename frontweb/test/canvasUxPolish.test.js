import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  buildCanvasReferenceDisplaySlots,
  canvasReferenceDisplayName,
  canvasReferenceKindLabel,
  canvasReferenceSourceLabel,
} from '../src/composables/useCanvasReferenceDisplay.js'
import { canvasUserError, isCanvasUserAbort } from '../src/composables/useCanvasUserError.js'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const canvasSource = read('../src/views/DramaCanvas.vue')
const emptyStateSource = read('../src/components/dramaCanvas/CanvasEmptyState.vue')
const assetNodeSource = read('../src/components/dramaCanvas/CanvasAssetNode.vue')
const assetPanelSource = read('../src/components/dramaCanvas/CanvasAssetPanel.vue')
const storyboardPanelSource = read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue')
const mediaNodeSource = read('../src/components/dramaCanvas/CanvasMediaNode.vue')
const mediaPanelSource = read('../src/components/dramaCanvas/CanvasMediaPanel.vue')
const scriptPanelSource = read('../src/components/dramaCanvas/CanvasScriptPanel.vue')
const contextMenuSource = read('../src/components/dramaCanvas/CanvasContextMenu.vue')

test('canvasUserError 把英文技术错误翻成中文，中文原文原样返回', () => {
  assert.equal(canvasUserError({ message: 'Network Error' }, '参考图生成失败'), '参考图生成失败')
  assert.equal(canvasUserError({ message: 'timeout of 600000ms exceeded' }, '保存失败'), '连接画布服务超时，请稍后重试')
  assert.equal(canvasUserError({ message: 'Request failed with status code 500' }, '生成失败'), '生成失败')
  assert.equal(canvasUserError({ message: '请先填写角色名称' }, '保存失败'), '请先填写角色名称')
  assert.equal(canvasUserError({ message: '生成失败: Internal Server Error' }, '生成失败'), '生成失败')
  assert.equal(canvasUserError({ response: { status: 503 } }, '保存失败'), '画布服务暂时不可用（HTTP 503）')
  assert.equal(canvasUserError({ response: { data: { error: { message: '配额已用完' } } } }, '生成失败'), '配额已用完')
  assert.equal(canvasUserError('cancel'), '操作已取消')
  assert.equal(isCanvasUserAbort('cancel'), true)
  assert.equal(isCanvasUserAbort({ name: 'AbortError' }), true)
})

test('canvasReferenceDisplay 英文自由参考图名转成中文，并标出来源', () => {
  assert.equal(canvasReferenceKindLabel('scene'), '场景')
  assert.equal(canvasReferenceKindLabel('character'), '角色')
  assert.equal(canvasReferenceKindLabel('prop'), '道具')
  assert.equal(canvasReferenceKindLabel('free'), '自由')
  assert.equal(canvasReferenceDisplayName({ kind: 'free', name: 'Free reference', freeIndex: 0 }), '自由参考图 1')
  assert.equal(canvasReferenceDisplayName({ kind: 'free', name: 'Media library reference', index: 2 }), '自由参考图 2')
  assert.equal(canvasReferenceSourceLabel({ kind: 'character', name: '小明', url: '/static/a.png' }), '角色参考图：小明')
  assert.equal(canvasReferenceSourceLabel({ kind: 'scene', name: '教室', url: '' }), '场景「教室」暂无参考图')
})

test('buildCanvasReferenceDisplaySlots 为空时给出可绑定提示数据，缺图素材单独占位', () => {
  const empty = buildCanvasReferenceDisplaySlots()
  assert.deepEqual(empty, [])

  const slots = buildCanvasReferenceDisplaySlots({
    filledSlots: [
      { kind: 'character', name: '配角', url: '/static/b.png', index: 1 },
      { kind: 'free', name: 'Free reference', url: '/static/free.png', index: 2 },
    ],
    sceneId: 8,
    characterIds: [1, 2],
    propIds: [9],
    scenes: [{ id: 8, location: '教室' }],
    characters: [
      { id: 1, name: '主角' },
      { id: 2, name: '配角', image_url: '/static/b.png' },
    ],
    propsList: [{ id: 9, name: '雨伞' }],
    resolveUrl: (entity) => entity?.image_url || '',
  })

  assert.equal(slots.length, 5)
  assert.deepEqual(slots.map((slot) => [slot.kind, slot.name, Boolean(slot.url), slot.pending]), [
    ['scene', '教室', false, true],
    ['character', '主角', false, true],
    ['character', '配角', true, false],
    ['prop', '雨伞', false, true],
    ['free', 'Free reference', true, false],
  ])
  assert.equal(canvasReferenceSourceLabel(slots[0]), '场景「教室」暂无参考图')
  assert.equal(canvasReferenceDisplayName(slots[4]), '自由参考图 1')
})

test('DramaCanvas 侧栏空态可键盘新建，自由画布空态有说明', () => {
  assert.match(canvasSource, /class="sidebar-empty" role="status"/)
  assert.match(canvasSource, /暂无角色/)
  assert.match(canvasSource, /暂无场景/)
  assert.match(canvasSource, /暂无道具/)
  assert.match(canvasSource, /aria-label="新建角色"/)
  assert.match(canvasSource, /aria-label="新建场景"/)
  assert.match(canvasSource, /aria-label="新建道具"/)
  assert.match(canvasSource, /:aria-label="`定位角色\$\{c\.name \|\| '未命名'\}`"/)
  assert.match(canvasSource, /id="free-canvas-empty-desc"/)
  assert.match(canvasSource, /还没有自由节点/)
  assert.match(canvasSource, /@go-production="setCanvasMode\('production'\)"/)
  assert.match(emptyStateSource, /aria-label="返回列表模式"/)
})

test('素材节点和面板空态显示暂无参考图，失败可重试', () => {
  assert.match(assetNodeSource, /暂无参考图/)
  assert.match(assetNodeSource, /key: 'empty', label: '无图'/)
  assert.match(assetPanelSource, /暂无参考图/)
  assert.match(assetPanelSource, /还没有参考图，可在下方生成/)
  assert.match(assetPanelSource, /重新生成参考图/)
  assert.match(assetPanelSource, /v-if="canGenerate \|\| generating \|\| entityStatus === 'failed'"/)
  assert.match(assetPanelSource, /generateError/)
  assert.match(assetPanelSource, /role="alert"/)
  assert.match(assetPanelSource, /aria-label="收起面板"/)
  assert.match(assetPanelSource, /@keydown\.esc\.stop\.prevent="closePanel"/)
  assert.match(assetPanelSource, /canvasUserError/)
  assert.doesNotMatch(assetPanelSource, /Network Error/)
})

test('分镜面板参考图用来源中文标签，空态和缺图占位可见', () => {
  assert.match(storyboardPanelSource, /尚未加入参考图/)
  assert.match(storyboardPanelSource, /canvasReferenceKindLabel/)
  assert.match(storyboardPanelSource, /canvasReferenceSourceLabel/)
  assert.match(storyboardPanelSource, /reference-missing/)
  assert.match(storyboardPanelSource, /class="reference-empty" role="status"/)
  assert.match(storyboardPanelSource, /buildCanvasReferenceDisplaySlots/)
  assert.doesNotMatch(storyboardPanelSource, /scene: '场', character: '角', prop: '物', free: '自'/)
  assert.match(storyboardPanelSource, /aria-label="收起面板"/)
  assert.match(storyboardPanelSource, /canvasUserError/)
})

test('分镜面板自由参考图达上限时给出中文禁用原因', () => {
  assert.match(storyboardPanelSource, /:disabled="referenceSlots.length >= 10"/)
  assert.match(
    storyboardPanelSource,
    /:title="referenceSlots.length >= 10 \? '每个分镜最多保存 10 张自由参考图' : undefined"/,
  )
  assert.doesNotMatch(storyboardPanelSource, /title="每个分镜最多保存 10 张自由参考图"/)
})

test('媒体面板区分生成与重新生成，音频空态和英文省略号已去掉', () => {
  assert.match(mediaPanelSource, /生成首帧/)
  assert.match(mediaPanelSource, /重新生成首帧/)
  assert.match(mediaPanelSource, /生成尾帧/)
  assert.match(mediaPanelSource, /待生成首帧/)
  assert.match(mediaPanelSource, /待生成尾帧/)
  assert.match(mediaPanelSource, /暂无配音/)
  assert.match(mediaPanelSource, /生视频中…/)
  assert.match(mediaPanelSource, /生图中…/)
  assert.match(mediaPanelSource, /重试中…/)
  assert.doesNotMatch(mediaPanelSource, /生视频中\.\.\./)
  assert.doesNotMatch(mediaPanelSource, /重试中\.\.\./)
  assert.match(mediaPanelSource, /aria-label="收起面板"/)
  assert.match(mediaNodeSource, /\.canvas-media-node\.pending/)
  assert.match(mediaNodeSource, /待生成首帧/)
  assert.match(mediaNodeSource, /pending-frame/)
})

test('剧本面板提取失败不再静默，右键菜单键盘可达', () => {
  assert.match(scriptPanelSource, /canvasUserError\(e, '提取失败'\)/)
  assert.match(scriptPanelSource, /aria-label="收起面板"/)
  assert.match(scriptPanelSource, /@keydown\.esc\.stop\.prevent="closePanel"/)
  assert.match(scriptPanelSource, /function requireScriptContent/)
  assert.match(scriptPanelSource, /if \(!requireScriptContent\(\)\) return/)
  assert.match(scriptPanelSource, /:disabled="!hasScriptContent"/)
  assert.match(contextMenuSource, /role="menu"/)
  assert.match(contextMenuSource, /role="menuitem"/)
})

test('画布页用户 toast 不再直出 e.message', () => {
  assert.match(canvasSource, /from '@\/composables\/useCanvasUserError'/)
  assert.match(canvasSource, /function safeFreeCanvasError\(error, fallback\) \{[\s\S]*return canvasUserError\(error, fallback/)
  assert.doesNotMatch(canvasSource, /ElMessage\.(error|warning)\(e\?\.message/)
  assert.doesNotMatch(canvasSource, /ElMessage\.(error|warning)\((?:error\?\.message|`[^`]*\$\{error\?\.message)/)
  assert.match(canvasSource, /if \(isCanvasUserAbort\(e\)\) return/)
  assert.match(canvasSource, /当前集还没有剧本，请先编写或导入剧本/)
  assert.match(canvasSource, /await focusScriptNode\(\)/)
})

test('批量生成、素材参考图和剧本提取都有可点的取消按钮', () => {
  assert.match(canvasSource, /aria-label="取消批量生成"/)
  assert.match(canvasSource, /@click="cancelEpisodeGenerate"/)
  assert.match(canvasSource, /abortEpisodeGenerate/)
  assert.match(assetPanelSource, /aria-label="取消生成参考图"/)
  assert.match(assetPanelSource, />取消<\/el-button>/)
  assert.match(scriptPanelSource, /aria-label="取消提取"/)
  assert.match(scriptPanelSource, />取消<\/el-button>/)
  assert.match(scriptPanelSource, /isCanvasUserAbort/)
})

test('\u6574\u7ec4\u5de5\u4f5c\u6d41\u6267\u884c\u4e2d\u53ef\u4ece\u5de5\u5177\u6761\u53d6\u6d88', () => {
  const workflowToolbarSource = read('../src/components/dramaCanvas/CanvasWorkflowToolbarGroup.vue')
  const desktopToolbarSource = read('../src/components/dramaCanvas/CanvasDesktopToolbar.vue')
  assert.match(canvasSource, /@cancel-workflow="cancelActiveWorkflow"/)
  assert.match(desktopToolbarSource, /@cancel-workflow="emit\('cancel-workflow'\)"/)
  assert.match(workflowToolbarSource, /aria-label="\u53d6\u6d88\u6267\u884c"/)
  assert.match(workflowToolbarSource, />\s*\u53d6\u6d88\u6267\u884c\s*</)
  assert.match(workflowToolbarSource, /props\.workflowRunning && props\.workflowProgress/)
  assert.match(desktopToolbarSource, /<span v-if="workflowProgress">\{\{ workflowProgress \}\}<\/span>/)
})



test('空剧本不能提取素材，并给出中文原因', async () => {
  const { ref } = await import('vue')
  const { useCanvasScript } = await import('../src/composables/useCanvasScript.js')
  const { useCanvasEpisodeGenerate } = await import('../src/composables/useCanvasEpisodeGenerate.js')
  const messages = []
  const drama = ref({
    id: 7,
    episodes: [{ id: 11, script_content: '   ', storyboards: [] }],
  })
  const script = useCanvasScript({
    drama,
    dramaId: ref(7),
    refreshCanvas: async () => {},
    nodeStatus: { set() {}, clear() {} },
    ElMessage: {
      warning(message) { messages.push(['warning', message]) },
      error(message) { messages.push(['error', message]) },
      success(message) { messages.push(['success', message]) },
      info(message) { messages.push(['info', message]) },
    },
    generationAPIImpl: {
      generateCharacters: async () => { throw new Error('should not generate') },
    },
  })
  await assert.rejects(script.extractCharacters(11, '  '), /请先填写剧本内容/)
  await assert.rejects(script.extractScenes(11), /请先填写剧本内容/)

  const generate = useCanvasEpisodeGenerate({
    drama,
    filterEpisodeId: ref(11),
    imagesBySbId: ref({}),
    videosBySbId: ref({}),
    refreshCanvas: async () => {},
    nodeStatus: { set() {}, clear() {} },
    ElMessage: {
      warning(message) { messages.push(['warning', message]) },
      error(message) { messages.push(['error', message]) },
      success(message) { messages.push(['success', message]) },
      info(message) { messages.push(['info', message]) },
    },
    dramaAPIImpl: {
      generateStoryboard: async () => { throw new Error('should not generate') },
    },
  })
  await generate.aiGenerateStoryboards()
  assert.match(messages.map((item) => item[1]).join('|'), /当前集还没有剧本，请先编写或导入剧本/)
  assert.doesNotMatch(messages.map((item) => item[1]).join('|'), /列表模式编写/)
})


test('画布反馈按需引入，禁用按钮带中文 title，工作流步骤显示中文', () => {
  const desktopToolbarSource = read('../src/components/dramaCanvas/CanvasDesktopToolbar.vue')
  const workflowToolbarSource = read('../src/components/dramaCanvas/CanvasWorkflowToolbarGroup.vue')
  const inspectorDockSource = read('../src/components/dramaCanvas/CanvasInspectorDock.vue')
  const createDialogSource = read('../src/components/dramaCanvas/CanvasCreateDialog.vue')
  const workflowSidebarSource = read('../src/components/dramaCanvas/CanvasWorkflowSidebarList.vue')
  const canvasDir = new URL('../src/components/dramaCanvas/', import.meta.url)
  const componentSources = readdirSync(fileURLToPath(canvasDir))
    .filter((name) => name.endsWith('.vue'))
    .map((name) => read(`../src/components/dramaCanvas/${name}`))

  for (const source of [canvasSource, ...componentSources]) {
    assert.doesNotMatch(source, /from 'element-plus'/)
  }
  for (const source of [
    canvasSource,
    assetPanelSource,
    createDialogSource,
    inspectorDockSource,
    mediaPanelSource,
    scriptPanelSource,
    storyboardPanelSource,
  ]) {
    assert.match(source, /from '@\/utils\/elementPlusFeedback\.js'/)
  }

  assert.match(desktopToolbarSource, /aria-label="AI 生成分镜"/)
  assert.match(desktopToolbarSource, />\s*AI 分镜\s*</)
  assert.match(desktopToolbarSource, /:title="actionReasons.generateStoryboards \|\| undefined"/)
  assert.match(desktopToolbarSource, /:title="actionReasons.editScript \|\| undefined"/)
  assert.match(workflowToolbarSource, /:title="actionReasons.createWorkflow \|\| undefined"/)
  assert.match(workflowToolbarSource, /:title="actionReasons.deleteWorkflow \|\| undefined"/)
  assert.match(assetPanelSource, /:title="panoramaDisabledReason \|\| undefined"/)
  assert.match(scriptPanelSource, /:title="emptyScriptReason \|\| undefined"/)
  assert.match(mediaPanelSource, /:title="videoAction.reason \|\| undefined"/)
  assert.match(storyboardPanelSource, /:title="videoAction.reason \|\| undefined"/)
  assert.match(inspectorDockSource, /重试中…/)
  assert.doesNotMatch(inspectorDockSource, /重试中\.\.\./)
  assert.match(workflowSidebarSource, /function pipelineStepLabel/)
  assert.match(workflowSidebarSource, /image: '生图'/)
  assert.match(workflowSidebarSource, /video: '生视频'/)
  assert.match(workflowSidebarSource, /audio: '配音'/)
  assert.doesNotMatch(workflowSidebarSource, /\(group\.pipeline \|\| \[\]\)\.join\(' → '\)/)
})
