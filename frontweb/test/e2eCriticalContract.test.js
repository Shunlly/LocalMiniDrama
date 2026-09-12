import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const critical = require('../scripts/e2e-critical-contracts.cjs')
const productionSource = readFileSync(new URL('../scripts/e2e-production.cjs', import.meta.url), 'utf8')
const helperSource = readFileSync(new URL('../scripts/e2e-critical-contracts.cjs', import.meta.url), 'utf8')
const smokeSource = readFileSync(new URL('../scripts/e2e-smoke.cjs', import.meta.url), 'utf8')
const freeCanvasSource = readFileSync(new URL('../scripts/e2e-free-canvas.cjs', import.meta.url), 'utf8')

const FRONTEND_URL = 'http://127.0.0.1:3013'
const FIXTURE = {
  frontendUrl: FRONTEND_URL,
  dramaId: 41,
  episodeId: 7,
  storyboardId: 13,
  fixtureTitle: 'E2E 往返项目',
}

function sourceOrder(source, snippets) {
  let cursor = -1
  for (const snippet of snippets) {
    const index = source.indexOf(snippet, cursor + 1)
    assert.ok(index > cursor, `missing or out-of-order: ${snippet}`)
    cursor = index
  }
}

function createCriticalPageMock(options = {}) {
  const frontendUrl = FRONTEND_URL
  const dramaId = options.dramaId || FIXTURE.dramaId
  const episodeId = String(options.episodeId || FIXTURE.episodeId)
  const title = options.fixtureTitle || FIXTURE.fixtureTitle
  const backupName = options.backupName || critical.BACKUP_FIXTURE_NAME
  let href = `${frontendUrl}/`
  let dialog = null
  let dirty = false
  const events = []
  const routes = []

  function url() {
    return href
  }

  function parsed() {
    return new URL(href)
  }

  function setHref(next) {
    href = new URL(next, frontendUrl).toString()
    events.push(['url', parsed().pathname + parsed().search])
  }

  function openDialog(name, texts = []) {
    dialog = { name, texts }
    events.push(['dialog-open', name])
  }

  function closeDialog() {
    if (!dialog) return
    events.push(['dialog-close', dialog.name])
    dialog = null
  }

  function textMatches(matcher) {
    const haystack = [dialog?.name, ...(dialog?.texts || [])].join('\n')
    if (matcher instanceof RegExp) return matcher.test(haystack)
    return haystack.includes(String(matcher))
  }

  async function handleFill(meta, value) {
    events.push(['fill', meta.name || meta.role, value])
    if (meta.name === critical.CRITICAL_UI.searchProjects) {
      const next = new URL('/', frontendUrl)
      next.searchParams.set('q', String(value))
      setHref(next)
      return
    }
    if (meta.name === critical.CRITICAL_UI.scriptContent) {
      dirty = true
    }
  }

  async function handleClick(meta) {
    const name = String(meta.name || meta.text || '')
    events.push(['click', name])
    if (name === critical.CRITICAL_UI.openProject(title) || name === critical.CRITICAL_UI.continueProduction) {
      setHref(`${frontendUrl}/film/${dramaId}?episode=${episodeId}`)
      return
    }
    if (name === critical.CRITICAL_UI.canvasMode) {
      setHref(`${frontendUrl}/film/${dramaId}/canvas?episode=${episodeId}`)
      return
    }
    if (name === critical.CRITICAL_UI.listMode || name === critical.CRITICAL_UI.listModeAria) {
      setHref(`${frontendUrl}/film/${dramaId}?episode=${episodeId}`)
      return
    }
    if (name === critical.CRITICAL_UI.productionMode) {
      events.push(['mode', 'production'])
      return
    }
    if (name === critical.WORKFLOW_GROUP_TITLE) {
      events.push(['select-group', name])
      return
    }
    if (name === critical.CRITICAL_UI.runGroup) {
      openDialog(critical.CRITICAL_UI.rerunGroupTitle, ['将对 1 个分镜依次执行：audio'])
      return
    }
    if (name === critical.CRITICAL_UI.openMediaLibrary) {
      setHref(`${frontendUrl}/media-library`)
      return
    }
    if (name === critical.CRITICAL_UI.openFreeCreate) {
      setHref(`${frontendUrl}/free-create`)
      return
    }
    if (name === critical.CRITICAL_UI.backToHome) {
      setHref(`${frontendUrl}/`)
      return
    }
    if (name === critical.CRITICAL_UI.openAiConfig) {
      openDialog(critical.CRITICAL_UI.aiConfigTitle, [
        critical.CRITICAL_UI.aiConfigWorkspace,
        critical.CRITICAL_UI.aiConfigCoverage,
        critical.CRITICAL_UI.aiConfigManage,
      ])
      return
    }
    if (name === critical.CRITICAL_UI.aiConfigManage || name === critical.CRITICAL_UI.aiConfigCoverage) {
      events.push(['workspace-tab', name])
      return
    }
    if (name === critical.CRITICAL_UI.openSemanticLibrary) {
      events.push(['menu', name])
      return
    }
    if (name === critical.CRITICAL_UI.characterLibraryMenu) {
      openDialog(critical.CRITICAL_UI.characterLibraryTitle, [critical.CRITICAL_UI.characterLibraryEmpty])
      return
    }
    if (name === critical.CRITICAL_UI.close) {
      closeDialog()
      return
    }
    if (String(meta.selector || '').includes('headerbtn')) {
      closeDialog()
      return
    }
    if (name === critical.CRITICAL_UI.backupNav) {
      setHref(`${frontendUrl}/backup`)
      return
    }
    if (name === critical.CRITICAL_UI.restoreBackup(backupName)) {
      openDialog(critical.CRITICAL_UI.restoreConfirmTitle, [`将用「${backupName}」覆盖当前全部项目、素材和原文`])
      return
    }
    if (name === critical.CRITICAL_UI.cancel || name === critical.CRITICAL_UI.restoreCancel) {
      closeDialog()
      return
    }
    if (name === critical.CRITICAL_UI.leaveAnyway) {
      closeDialog()
      dirty = false
      setHref(`${frontendUrl}/`)
      return
    }
    if (name === critical.CRITICAL_UI.saveAndLeave) {
      return
    }
    if (name === critical.CRITICAL_UI.backToList || name === critical.CRITICAL_UI.logoBackToList) {
      const pathName = parsed().pathname
      if (pathName === `/film/${dramaId}` && dirty) {
        openDialog(critical.CRITICAL_UI.unsavedScriptTitle, ['自动保存失败。可先重试保存，或仍然离开并丢弃本次剧本修改。'])
        return
      }
      setHref(`${frontendUrl}/`)
      return
    }
    if (name === critical.CRITICAL_UI.projectList) {
      setHref(`${frontendUrl}/`)
    }
  }

  function locator(meta = {}) {
    return {
      async waitFor(options = {}) {
        const state = options.state || 'visible'
        const name = meta.name
        if (meta.role === 'dialog') {
          if (state === 'visible' && dialog?.name !== meta.name) {
            throw new Error(`对话框未打开: ${meta.name}`)
          }
          if (state === 'hidden' && dialog?.name === meta.name) {
            throw new Error(`对话框仍打开: ${meta.name}`)
          }
        } else if (meta.parentRole === 'dialog' && state === 'visible' && !dialog) {
          throw new Error(`对话框未打开: ${meta.parentName || ''}`)
        }
        if (meta.text && state !== 'hidden' && dialog && !textMatches(meta.text)) {
          throw new Error(`对话框缺少文案: ${meta.text}`)
        }
      },
      async click() {
        await handleClick(meta)
      },
      async fill(value) {
        await handleFill(meta, value)
      },
      async isEnabled() {
        return true
      },
      async isVisible() {
        return true
      },
      async getAttribute(name) {
        if (name === 'aria-label' && meta.selector === '.library-tabs') return critical.CRITICAL_UI.mediaSourceTabs
        return null
      },
      async textContent() {
        if (meta.selector === '.group-helper') return critical.CRITICAL_UI.canvasEmptyStoryboard
        return ''
      },
      async count() {
        return 1
      },
      first() {
        return locator({ ...meta, first: true })
      },
      filter(opts) {
        return locator({ ...meta, filter: opts })
      },
      locator(selector) {
        return locator({ ...meta, selector })
      },
      getByRole(role, opts = {}) {
        return locator({
          role,
          name: opts.name,
          exact: opts.exact,
          parentRole: meta.role,
          parentName: meta.name,
        })
      },
      getByText(text, opts = {}) {
        return locator({
          text,
          exact: opts.exact,
          parentRole: meta.role,
          parentName: meta.name,
        })
      },
    }
  }

  const page = {
    url,
    async goto(next) {
      setHref(next)
      closeDialog()
      events.push(['goto', parsed().pathname])
    },
    async waitForURL(predicate) {
      const deadline = Date.now() + 200
      while (Date.now() < deadline) {
        if (predicate(parsed())) return
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (!predicate(parsed())) throw new Error(`waitForURL 失败: ${href}`)
    },
    async route(pattern, handler) {
      routes.push({ pattern, handler })
    },
    async unroute(pattern) {
      events.push(['unroute', pattern])
    },
    keyboard: {
      async press(key) {
        events.push(['key', key])
        if (key === 'Escape') closeDialog()
      },
    },
    locator(selector) {
      return locator({ selector })
    },
    getByRole(role, opts = {}) {
      return locator({ role, name: opts.name, exact: opts.exact })
    },
    getByText(text, opts = {}) {
      return locator({ text, exact: opts.exact })
    },
  }

  return { page, events, routes, url: () => parsed() }
}

test('共享合同覆盖工作区入口、素材库空态、项目列表-制作页-画布往返、离开保护、整组确认取消、备份恢复、分镜空状态和中文 404', () => {
  sourceOrder(helperSource, [
    'async function verifyProjectListFilmCanvasRoundTrip',
    'CRITICAL_UI.openProject(fixture.fixtureTitle)',
    "pathname === `/film/${fixture.dramaId}/canvas`",
    'page.goto(deepLink',
    'CRITICAL_UI.listModeAria, exact: true }).first()',
    'CRITICAL_UI.logoBackToList, exact: true }).first()',
    'async function verifyLeaveProtectionWhenAutosavePending',
    'E2E_AUTOSAVE_FAILED',
    "press('Escape')",
    "CRITICAL_UI.leaveAnyway, exact: true }).click()",
    'async function verifyWorkflowGroupConfirmAndCancel',
    'const group = buildAudioOnlyWorkflowGroup({',
    'await installVendorMutationGuard(page, vendorHits)',
    'CRITICAL_UI.rerunGroupTitle, exact: true })',
    'CRITICAL_UI.startRun, exact: true })',
    "CRITICAL_UI.cancel, exact: true }).click()",
    'async function verifyBackupRestoreEntry',
    'CRITICAL_UI.backupNav, exact: true }).first()',
    'CRITICAL_UI.restoreConfirmTitle, exact: true })',
    'CRITICAL_UI.restoreCancel, exact: true }).click()',
    'restore_posts: restorePosts.length',
    'async function verifyMissingProjectChineseFailurePages',
    'CRITICAL_UI.missingDramaTitle, exact: true })',
    'CRITICAL_UI.missingFilmTitle, exact: true })',
    'CRITICAL_UI.missingCanvasTitle, exact: true })',
    "goto(`${fixture.frontendUrl}/film/abc`",
    'CRITICAL_UI.notFoundTitle, exact: true })',
    'getByText(/制作页深链接已失效，项目编号不正确/)',
    'returnToProjectListFromNotFound(page)',
    "goto(`${fixture.frontendUrl}/e2e-missing-route`",
    'getByText(/这个地址不在应用里/)',
    'CRITICAL_UI.mediaLoadFailedDetail, { exact: true }',
    'async function verifyWorkspaceEntries',
    'CRITICAL_UI.openMediaLibrary, exact: true }).click()',
    'CRITICAL_UI.openFreeCreate, exact: true }).click()',
    'CRITICAL_UI.aiConfigWorkspace, exact: true })',
    'async function verifyMediaLibraryEmptyStates',
    'CRITICAL_UI.mediaLibraryEmpty, exact: true })',
    'CRITICAL_UI.characterLibraryEmpty, { exact: true }',
    'async function verifyStoryboardEmptyStates',
    'CRITICAL_UI.storyboardEmpty, { exact: true }',
    'name: CRITICAL_UI.generateStoryboard,',
    'exact: true,',
    'async function runCriticalUiContracts',
    'verifyWorkspaceEntries(page, options)',
    'verifyMediaLibraryEmptyStates(page, options)',
    'verifyProjectListFilmCanvasRoundTrip(page, options)',
    'verifyLeaveProtectionWhenAutosavePending(page, options)',
    'verifyWorkflowGroupConfirmAndCancel(page, options)',
    'verifyBackupRestoreEntry(page, options)',
    'verifyStoryboardEmptyStates(page, options)',
    'verifyMissingProjectChineseFailurePages(page, options)',
  ])
  assert.doesNotMatch(helperSource, /api\.openai\.com|openai_api_key|sk-[A-Za-z0-9]/)
  assert.doesNotMatch(
    helperSource,
    /getByRole\('button', \{ name: CRITICAL_UI\.startRun[\s\S]{0,80}\.click\(/,
  )
  assert.doesNotMatch(
    helperSource,
    /getByRole\('button', \{ name: CRITICAL_UI\.restoreConfirm[\s\S]{0,80}\.click\(/,
  )
  assert.doesNotMatch(
    helperSource,
    /getByRole\('button', \{ name: CRITICAL_UI\.generateStoryboard[\s\S]{0,80}\.click\(/,
  )
})

test('production E2E 在 focused acceptance 之后串上关键 UI 合同，且用 audio-only 分组避免打到图片视频供应商', () => {
  assert.match(productionSource, /require\('\.\/e2e-critical-contracts\.cjs'\)/)
  assert.match(productionSource, /criticalUiContracts\.runCriticalUiContracts\(criticalPage/)
  assert.match(productionSource, /workflow_groups: \[group\]/)
  assert.match(productionSource, /seedWorkflowGroup: async \(group\) => \{/)
  sourceOrder(productionSource, [
    "await evidenceRecorder.stage('focused_desktop_acceptance', 'passed')",
    "await evidenceRecorder.stage('critical_ui_contracts')",
    'criticalUiContracts.runCriticalUiContracts(criticalPage',
    "await evidenceRecorder.stage('critical_ui_contracts', 'passed')",
    "await evidenceRecorder.stage('browser_acceptance')",
  ])
  assert.match(helperSource, /pipeline: \['audio'\]/)
  assert.match(helperSource, /E2E 合同禁止调用图片、视频或配音供应商/)
})

test('供应商守卫只拦截生成类写操作，不拦截 readiness 或普通 GET', () => {
  assert.equal(critical.isVendorMutation({ pathname: '/api/v1/images/generations' }, 'POST'), true)
  assert.equal(critical.isVendorMutation({ pathname: '/api/v1/videos/render' }, 'POST'), true)
  assert.equal(critical.isVendorMutation({ pathname: '/api/v1/generation/characters' }, 'POST'), true)
  assert.equal(critical.isVendorMutation({ pathname: '/api/v1/tts' }, 'POST'), true)
  assert.equal(critical.isVendorMutation({ pathname: '/api/v1/workflows/novel2anime' }, 'POST'), true)
  assert.equal(critical.isVendorMutation({ pathname: '/api/v1/workflows/novel2anime/readiness' }, 'POST'), false)
  assert.equal(critical.isVendorMutation({ pathname: '/api/v1/images/generations' }, 'GET'), false)
  assert.equal(critical.isVendorMutation({ pathname: '/api/v1/dramas/41' }, 'GET'), false)
  assert.ok(critical.vendorGuardPatterns().every((pattern) => !pattern.includes('readiness')))
  assert.equal(critical.isGetPathname({ method: 'GET', url: 'http://127.0.0.1:5679/api/v1/assets' }, '/api/v1/assets'), true)
  assert.equal(critical.isGetPathname({ method: 'GET', url: 'http://127.0.0.1:5679/api/v1/assets/network-search' }, '/api/v1/assets'), false)
  assert.equal(critical.isGetPathname({ method: 'POST', url: 'http://127.0.0.1:5679/api/v1/assets' }, '/api/v1/assets'), false)
  const group = critical.buildAudioOnlyWorkflowGroup({ storyboardId: 13 })
  assert.deepEqual(group.pipeline, ['audio'])
  assert.deepEqual(group.storyboard_ids, [13])
})

test('mock page 能跑通八条关键合同且取消时不发恢复、生成或供应商请求', async () => {
  const mock = createCriticalPageMock(FIXTURE)
  let seeded = null
  const evidence = await critical.runCriticalUiContracts(mock.page, {
    ...FIXTURE,
    seedWorkflowGroup: async (group) => {
      seeded = group
    },
  })
  assert.equal(evidence.deep_link_round_trip.returned_to_list, true)
  assert.match(String(evidence.deep_link_round_trip.deep_link), /\/film\/41\/canvas\?episode=7/)
  assert.equal(evidence.leave_protection.stayed, true)
  assert.equal(evidence.leave_protection.left_after_discard, true)
  assert.equal(evidence.workflow_group.cancelled, true)
  assert.equal(evidence.workflow_group.vendor_calls, 0)
  assert.equal(evidence.backup_restore.cancelled, true)
  assert.equal(evidence.backup_restore.restore_posts, 0)
  assert.equal(evidence.workspace_entries.ai_config_workspace, true)
  assert.equal(evidence.workspace_entries.media_library, true)
  assert.equal(evidence.media_library.media_empty, true)
  assert.equal(evidence.media_library.character_library_empty, true)
  assert.equal(evidence.storyboard_empty.film, true)
  assert.equal(evidence.storyboard_empty.canvas, true)
  assert.equal(evidence.missing_project.unknown_route, true)
  assert.equal(evidence.missing_project.catchall_route, true)
  assert.equal(evidence.missing_project.media_load_failure, true)
  assert.equal(evidence.missing_project.missing_id, critical.MISSING_PROJECT_ID)
  assert.equal(seeded.pipeline[0], 'audio')
  assert.equal(seeded.storyboard_ids[0], 13)
  assert.ok(mock.events.some((item) => item[0] === 'dialog-open' && item[1] === '剧本尚未保存'))
  assert.ok(mock.events.some((item) => item[0] === 'dialog-open' && item[1] === '整组重跑'))
  assert.ok(mock.events.some((item) => item[0] === 'dialog-open' && item[1] === '确认恢复备份'))
  assert.ok(mock.events.some((item) => item[0] === 'dialog-open' && item[1] === 'AI 配置'))
  assert.ok(mock.events.some((item) => item[0] === 'dialog-open' && item[1] === '素材库 · 角色'))
  assert.ok(mock.events.some((item) => item[0] === 'key' && item[1] === 'Escape'))
  assert.equal(mock.events.filter((item) => item[0] === 'click' && item[1] === '开始执行').length, 0)
  assert.equal(mock.events.filter((item) => item[0] === 'click' && item[1] === '确认恢复').length, 0)
  assert.equal(mock.events.filter((item) => item[0] === 'click' && item[1] === 'AI 生成分镜').length, 0)
  assert.ok(mock.routes.some((item) => String(item.pattern).includes('/settings/backups/restore')))
  assert.ok(mock.routes.some((item) => String(item.pattern).includes(`/dramas/${FIXTURE.dramaId}/episodes`)))
  assert.ok(mock.routes.some((item) => String(item.pattern).includes('/api/v1/assets')))
  assert.ok(mock.routes.some((item) => String(item.pattern).includes('/character-library')))
  assert.ok(mock.routes.some((item) => String(item.pattern).includes(`/dramas/${FIXTURE.dramaId}`)))
})

test('烟测与自由画布脚本不自己接真实生成供应商，404、素材库空态和分镜空状态由共享合同覆盖', () => {
  assert.match(helperSource, /制作项目不存在/)
  assert.match(helperSource, /页面不存在/)
  assert.match(helperSource, /该项目不存在，或已移入回收站。/)
  assert.match(helperSource, /素材中心还是空的/)
  assert.match(helperSource, /还没有分镜，可生成分镜或添加一个分镜/)
  assert.match(helperSource, /AI 配置工作区/)
  assert.doesNotMatch(smokeSource, /api\.openai\.com|sk-[A-Za-z0-9]/)
  assert.doesNotMatch(freeCanvasSource, /api\.openai\.com|sk-[A-Za-z0-9]/)
  assert.match(productionSource, /runCriticalUiContracts/)
})