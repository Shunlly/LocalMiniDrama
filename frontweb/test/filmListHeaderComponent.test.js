import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const headerUrl = new URL('../src/components/filmList/FilmListHeader.vue', import.meta.url)
const iconStubUrl = compileIconStub([
  'ArrowDown',
  'Box',
  'Collection',
  'Delete',
  'Download',
  'Files',
  'MagicStick',
  'Moon',
  'PictureFilled',
  'Plus',
  'Setting',
  'Sunny',
  'Upload',
  'User',
])
const FilmListHeader = await loadCompiledSfc(
  headerUrl,
  'film-list-header-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()
const WRITE_LOCK_REASON = '项目数据加载失败，成功重试前不能新增或导入'

function mountHeader(initial = {}) {
  const events = []
  const showAiConfigDialog = ref(Boolean(initial.showAiConfigDialog))
  const mounted = mountHarness(renderer, () => h(FilmListHeader, {
    isDark: Boolean(initial.isDark),
    listWriteLocked: Boolean(initial.listWriteLocked),
    listWriteLockReason: initial.listWriteLockReason ?? '',
    listError: initial.listError ?? '',
    backupNavItem: Object.prototype.hasOwnProperty.call(initial, 'backupNavItem') ? initial.backupNavItem : { id: 'backup' },
    importing: Boolean(initial.importing),
    showAiConfigDialog: showAiConfigDialog.value,
    'onUpdate:showAiConfigDialog': (value) => {
      showAiConfigDialog.value = value
    },
    goMaterialCenter: () => events.push(['material-center']),
    openSemanticLibrary: (command) => events.push(['semantic', command]),
    goFreeCreate: () => events.push(['free-create']),
    openTrash: () => events.push(['trash']),
    toggleTheme: () => events.push(['theme']),
    goBackup: () => events.push(['backup']),
    triggerImport: () => events.push(['import']),
    goNewProject: () => events.push(['new-project']),
  }))
  return { ...mounted, events, showAiConfigDialog }
}

test('项目列表页头保留品牌，并把素材和工作区入口交给页面', async () => {
  const harness = mountHeader()
  try {
    await nextTick()
    assert.match(textContent(harness.root), /本地短剧助手/)
    assert.match(textContent(harness.root), /LocalMiniDrama/)
    assert.match(textContent(harness.root), /角色素材库/)
    assert.match(textContent(harness.root), /场景素材库/)
    assert.match(textContent(harness.root), /道具素材库/)
    click(buttonByAriaLabel(harness.root, '打开素材中心'))
    click(buttonByAriaLabel(harness.root, '打开自由创作'))
    click(buttonByAriaLabel(harness.root, '打开项目回收站'))
    click(buttonByAriaLabel(harness.root, '切换到暗色模式'))
    click(buttonByAriaLabel(harness.root, '打开数据备份与维护'))
    click(buttonByAriaLabel(harness.root, '新建项目'))
    assert.deepEqual(harness.events, [
      ['material-center'],
      ['free-create'],
      ['trash'],
      ['theme'],
      ['backup'],
      ['new-project'],
    ])
  } finally {
    harness.app.unmount()
  }
})

test('写锁时分类素材、导入和新建都展示中文原因', async () => {
  const harness = mountHeader({
    isDark: true,
    listWriteLocked: true,
    listWriteLockReason: WRITE_LOCK_REASON,
    listError: '项目服务暂时不可用',
  })
  try {
    await nextTick()
    const semantic = buttonByAriaLabel(harness.root, '打开分类素材')
    const imported = buttonByAriaLabel(harness.root, '导入项目包')
    const created = buttonByAriaLabel(harness.root, '新建项目')
    assert.ok(semantic)
    assert.ok(imported)
    assert.ok(created)
    assert.equal(semantic.props.disabled, true)
    assert.equal(imported.props.disabled, true)
    assert.equal(created.props.disabled, true)
    assert.equal(semantic.props.title, WRITE_LOCK_REASON)
    assert.equal(imported.props.title, WRITE_LOCK_REASON)
    assert.equal(created.props.title, WRITE_LOCK_REASON)
    assert.equal(semantic.props['aria-describedby'], 'project-list-write-lock-reason')
    assert.equal(imported.props['aria-describedby'], 'project-list-write-lock-reason')
    assert.equal(created.props['aria-describedby'], 'project-list-write-lock-reason')
    const theme = buttonByAriaLabel(harness.root, '切换到浅色模式')
    assert.ok(theme)
    assert.notEqual(theme.props.disabled, true)
  } finally {
    harness.app.unmount()
  }
})

test('没有备份入口时不渲染数据备份，AI 配置通过 v-model 打开', async () => {
  const harness = mountHeader({ backupNavItem: null })
  try {
    await nextTick()
    assert.equal(buttonByAriaLabel(harness.root, '打开数据备份与维护'), undefined)
    assert.equal(buttonByText(harness.root, '数据备份'), undefined)
    assert.equal(harness.showAiConfigDialog.value, false)
    const config = buttonByAriaLabel(harness.root, '打开 AI 配置')
    assert.ok(config)
    click(config)
    assert.equal(harness.showAiConfigDialog.value, true)
    assert.deepEqual(harness.events, [])
  } finally {
    harness.app.unmount()
  }
})