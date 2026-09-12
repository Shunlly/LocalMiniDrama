import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { h, nextTick } from 'vue'

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
import {
  compileVueRouterStub,
  installVueRouterHarness,
  resetVueRouterHarness,
} from './helpers/vueRouterHarness.js'

function listVueFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) listVueFiles(full, acc)
    else if (name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

const renderer = createHostRenderer()

test('页头组件和关键页面都不出现微信我', () => {
  const srcRoot = fileURLToPath(new URL('../src', import.meta.url))
  const files = listVueFiles(srcRoot).filter((file) => (
    /Header\.vue$/i.test(file)
    || /(?:^|[\\/])(?:App|AiConfig|NotFound|FreeCreate|FilmList|MediaLibrary|Backup|DramaDetail|DramaCanvas|FilmCreate)\.vue$/i.test(file)
  ))
  assert.ok(files.length >= 10, `页头扫描范围过窄: ${files.length}`)
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /微信我/, file)
    assert.doesNotMatch(source, /WeChat/i, file)
  }
})

test('项目列表页头渲染后没有微信我，并保留备份入口', async () => {
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
    'film-list-header-no-wechat',
    new Map([
      ['vue', vueUrl],
      ['@element-plus/icons-vue', iconStubUrl],
    ]),
  )
  const harness = mountHarness(renderer, () => h(FilmListHeader, {
    isDark: false,
    listWriteLocked: false,
    listWriteLockReason: '',
    listError: '',
    backupNavItem: { id: 'backup' },
    importing: false,
    showAiConfigDialog: false,
    'onUpdate:showAiConfigDialog': () => {},
    goMaterialCenter: () => {},
    openSemanticLibrary: () => {},
    goFreeCreate: () => {},
    openTrash: () => {},
    toggleTheme: () => {},
    goBackup: () => {},
    triggerImport: () => {},
    goNewProject: () => {},
  }))
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.doesNotMatch(copy, /微信我/)
    assert.doesNotMatch(copy, /WeChat/i)
    assert.ok(buttonByAriaLabel(harness.root, '打开数据备份与维护'))
    assert.ok(buttonByAriaLabel(harness.root, '打开 AI 配置'))
  } finally {
    harness.app.unmount()
  }
})

test('404 主按钮读屏名和可见文案都是返回项目列表，且没有微信我', async () => {
  const pageUrl = new URL('../src/views/NotFound.vue', import.meta.url)
  const notFoundSource = read(pageUrl)
  assert.match(notFoundSource, /aria-label="返回项目列表"/)
  assert.match(notFoundSource, />返回项目列表<\/el-button>/)
  assert.doesNotMatch(notFoundSource, /微信我/)

  const iconStubUrl = compileIconStub(['ArrowLeft', 'HomeFilled'])
  const routerStubUrl = compileVueRouterStub()
  const NotFoundPage = await loadCompiledSfc(
    pageUrl,
    'not-found-return-list-contract',
    new Map([
      ['vue', vueUrl],
      ['vue-router', routerStubUrl],
      ['@element-plus/icons-vue', iconStubUrl],
    ]),
  )
  const router = installVueRouterHarness({
    name: 'not-found',
    fullPath: '/not-found',
  })
  const harness = mountHarness(renderer, () => h(NotFoundPage))
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.doesNotMatch(copy, /微信我/)
    const home = buttonByAriaLabel(harness.root, '返回项目列表')
    assert.ok(home, '缺少返回项目列表')
    assert.equal(buttonByText(harness.root, '返回项目列表'), home)
    assert.equal(home.props['aria-label'], '返回项目列表')
    assert.equal(home.props['data-variant'], 'primary')
    click(home)
    assert.deepEqual(router.calls, [['replace', { name: 'list' }]])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
  }
})

test('自由创作页头返回按钮读屏名是返回项目首页，页面接上该页头', async () => {
  const pageSource = read('../src/views/FreeCreate.vue')
  const headerSource = read('../src/components/freeCreate/FreeCreateHeader.vue')
  assert.match(pageSource, /<FreeCreateHeader @go-back="goBack" \/>/)
  assert.match(headerSource, /aria-label="返回项目首页"/)
  assert.match(headerSource, />\s*返回项目首页\s*</)
  assert.doesNotMatch(pageSource, /微信我/)
  assert.doesNotMatch(headerSource, /微信我/)

  const headerUrl = new URL('../src/components/freeCreate/FreeCreateHeader.vue', import.meta.url)
  const iconStubUrl = compileIconStub(['ArrowLeft'])
  const FreeCreateHeader = await loadCompiledSfc(
    headerUrl,
    'free-create-back-home-contract',
    new Map([
      ['vue', vueUrl],
      ['@element-plus/icons-vue', iconStubUrl],
    ]),
  )
  const events = []
  const harness = mountHarness(renderer, () => h(FreeCreateHeader, {
    onGoBack: () => events.push('go-back'),
  }))
  try {
    await nextTick()
    const copy = textContent(harness.root)
    assert.doesNotMatch(copy, /微信我/)
    const back = buttonByAriaLabel(harness.root, '返回项目首页')
    assert.ok(back, '缺少返回项目首页')
    assert.equal(buttonByText(harness.root, '返回项目首页'), back)
    assert.equal(back.props['aria-label'], '返回项目首页')
    click(back)
    assert.deepEqual(events, ['go-back'])
  } finally {
    harness.app.unmount()
  }
})
