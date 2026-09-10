const assert = require('node:assert/strict')

const MISSING_PROJECT_ID = 2147483000
const BACKUP_FIXTURE_NAME = 'e2e-restore-entry.zip'
const WORKFLOW_GROUP_ID = 'e2e-critical-workflow'
const WORKFLOW_GROUP_TITLE = 'E2E 整组确认'
const VENDOR_MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const CRITICAL_UI = Object.freeze({
  searchProjects: '搜索项目',
  continueProduction: '继续制作',
  canvasMode: '画布模式',
  listMode: '列表模式',
  backToList: '返回项目列表',
  projectList: '项目列表',
  canvasModeGroup: '画布模式',
  productionMode: '制作',
  scriptContent: '剧本内容',
  unsavedScriptTitle: '剧本尚未保存',
  saveAndLeave: '保存并离开',
  leaveAnyway: '仍然离开',
  runGroup: '执行分组',
  rerunGroupTitle: '整组重跑',
  startRun: '开始执行',
  cancel: '取消',
  backupNav: '打开数据备份与维护',
  backupTitle: '数据备份与维护',
  createBackup: '创建全量备份',
  chooseBackupFile: '选择备份文件',
  restoreConfirmTitle: '确认恢复备份',
  restoreConfirm: '确认恢复',
  missingDramaTitle: '项目不存在',
  missingFilmTitle: '制作项目不存在',
  missingCanvasTitle: '当前画布暂时无法打开',
  missingProjectDetail: '该项目不存在，或已移入回收站。',
  notFoundTitle: '页面不存在',
  workspaceTitle: '项目列表',
  openMediaLibrary: '打开素材中心',
  openSemanticLibrary: '打开分类素材',
  characterLibraryMenu: '角色素材库',
  characterLibraryTitle: '素材库 · 角色',
  characterLibraryEmpty: '素材库暂无角色，可在项目中将角色「加入素材库」后在此查看',
  openFreeCreate: '打开自由创作',
  openAiConfig: '打开 AI 配置',
  aiConfigTitle: 'AI 配置',
  aiConfigWorkspace: 'AI 配置工作区',
  aiConfigCoverage: '服务状态',
  aiConfigManage: '配置管理',
  mediaLibraryTitle: '素材中心',
  mediaSourceTabs: '素材来源',
  localMediaTab: '本地素材',
  networkMediaTab: '网络素材',
  mediaLibraryEmpty: '素材中心还是空的',
  mediaLibraryEmptyHint: '上传图片或视频，后续项目可以直接复用。',
  uploadMediaAria: '上传图片或视频到素材中心',
  backToHome: '返回项目首页',
  freeCreateTitle: '自由创作',
  close: '关闭',
  storyboardEmpty: '还没有分镜，可生成分镜或添加一个分镜',
  generateStoryboard: 'AI 生成分镜',
  emptyGenerateStoryboard: '生成分镜',
  addStoryboard: '添加一个分镜',
  canvasEmptyStoryboard: '当前集还没有分镜，请先生成或新建分镜',
  batchGenerateGroup: '本集批量生成',
  mediaLoadFailed: '素材数据加载失败',
  mediaLoadFailedDetail: '暂时无法确认服务器中的最新素材。您的素材数据没有被删除。',
  retryLoad: '重试加载',
  openProject(title) {
    return `打开项目「${title}」`
  },
  restoreBackup(name) {
    return `恢复备份 ${name}`
  },
})

function normalizeFrontendUrl(value) {
  return String(value || '').replace(/\/$/, '')
}

function currentUrl(page) {
  return new URL(page.url())
}

function isGetPathname(request, pathname) {
  const method = String(typeof request?.method === 'function' ? request.method() : request?.method || '').toUpperCase()
  if (method !== 'GET') return false
  const href = typeof request?.url === 'function' ? request.url() : request?.url
  try {
    return new URL(href).pathname === pathname
  } catch (_) {
    return false
  }
}

function buildEmptyStoryboardDrama(fixture) {
  return {
    id: fixture.dramaId,
    title: fixture.fixtureTitle || 'E2E 空分镜项目',
    episodes: [{
      id: fixture.episodeId,
      episode_number: 1,
      title: '第1集',
      script_content: 'E2E 空分镜剧本',
      storyboards: [],
    }],
    characters: [],
    scenes: [],
    props: [],
  }
}

async function fulfillEmptyStoryboardDrama(route, fixture) {
  if (typeof route.fetch === 'function') {
    try {
      const response = await route.fetch()
      const rawText = await response.text()
      const raw = rawText ? JSON.parse(rawText) : {}
      const payload = raw && typeof raw === 'object' ? raw : {}
      const data = payload.data && typeof payload.data === 'object' ? payload.data : payload
      const episodes = Array.isArray(data.episodes) && data.episodes.length
        ? data.episodes.map((episode) => ({ ...episode, storyboards: [] }))
        : buildEmptyStoryboardDrama(fixture).episodes
      const nextData = {
        ...data,
        id: data.id || fixture.dramaId,
        title: data.title || fixture.fixtureTitle,
        episodes,
      }
      const body = Object.prototype.hasOwnProperty.call(payload, 'success')
        || Object.prototype.hasOwnProperty.call(payload, 'data')
        ? { ...payload, success: true, data: nextData }
        : nextData
      await route.fulfill({
        status: response.status(),
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
      return
    } catch (_) {
      // 无真实后端时退回夹具
    }
  }
  await fulfillJson(route, { data: buildEmptyStoryboardDrama(fixture) })
}

function isPositiveId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : 0
}

function resolveFixture(options = {}) {
  const drama = options.drama && typeof options.drama === 'object' ? options.drama : {}
  const episode = Array.isArray(drama.episodes) ? drama.episodes[0] : null
  const storyboard = Array.isArray(episode?.storyboards) ? episode.storyboards[0] : null
  return {
    frontendUrl: normalizeFrontendUrl(options.frontendUrl),
    dramaId: isPositiveId(options.dramaId || drama.id),
    episodeId: isPositiveId(options.episodeId || episode?.id),
    storyboardId: isPositiveId(options.storyboardId || storyboard?.id),
    fixtureTitle: String(options.fixtureTitle || drama.title || '').trim(),
    missingProjectId: isPositiveId(options.missingProjectId) || MISSING_PROJECT_ID,
  }
}

async function fulfillJson(route, { status = 200, data, error } = {}) {
  const payload = error
    ? { success: false, error }
    : { success: true, data: data === undefined ? {} : data }
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  })
}

function isVendorMutation(url, method) {
  if (!VENDOR_MUTATION_METHODS.has(String(method || '').toUpperCase())) return false
  const pathname = String(url?.pathname || '')
  if (pathname === '/api/v1/workflows/novel2anime') return true
  return /\/api\/v1\/(?:images|videos|generation|tts|audio)(?:\/|$)/.test(pathname)
}

function vendorGuardPatterns() {
  return Object.freeze([
    '**/api/v1/images/**',
    '**/api/v1/videos/**',
    '**/api/v1/generation/**',
    '**/api/v1/tts',
    '**/api/v1/tts/**',
    '**/api/v1/audio/**',
    '**/api/v1/workflows/novel2anime',
  ])
}

async function installVendorMutationGuard(page, hits) {
  const handler = async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (isVendorMutation(url, request.method())) {
      hits.push(`${request.method()} ${url.pathname}`)
      await fulfillJson(route, {
        status: 599,
        error: {
          code: 'E2E_VENDOR_FORBIDDEN',
          message: 'E2E 合同禁止调用图片、视频或配音供应商',
        },
      })
      return
    }
    await route.continue()
  }
  const patterns = vendorGuardPatterns()
  for (const pattern of patterns) await page.route(pattern, handler)
  return async () => {
    for (const pattern of patterns) await page.unroute(pattern, handler)
  }
}

async function waitForEnabled(locator, label, timeout = 30000) {
  await locator.waitFor({ state: 'visible', timeout })
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return locator
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`${label} 仍未启用`)
}

async function waitForPath(page, predicate, timeout = 30000) {
  await page.waitForURL((url) => predicate(url), { timeout })
  return currentUrl(page)
}

function buildAudioOnlyWorkflowGroup({
  storyboardId,
  title = WORKFLOW_GROUP_TITLE,
  id = WORKFLOW_GROUP_ID,
} = {}) {
  const normalizedId = isPositiveId(storyboardId)
  assert.ok(normalizedId, '整组确认合同需要有效分镜 id')
  return {
    id,
    title,
    storyboard_ids: [normalizedId],
    pipeline: ['audio'],
    created_at: '2026-09-10T00:00:00.000Z',
  }
}

async function verifyProjectListFilmCanvasRoundTrip(page, options = {}) {
  const fixture = resolveFixture(options)
  assert.ok(fixture.frontendUrl, '深链接往返需要 FRONTEND_URL')
  assert.ok(fixture.dramaId, '深链接往返需要项目 id')
  assert.ok(fixture.episodeId, '深链接往返需要集 id')
  assert.ok(fixture.fixtureTitle, '深链接往返需要项目标题')
  const episodeId = String(fixture.episodeId)

  await page.goto(`${fixture.frontendUrl}/`, { waitUntil: 'domcontentloaded' })
  const search = page.getByRole('textbox', { name: CRITICAL_UI.searchProjects, exact: true })
  await search.waitFor({ state: 'visible', timeout: 30000 })
  await search.fill(fixture.fixtureTitle)
  const projectLink = page.getByRole('link', { name: CRITICAL_UI.openProject(fixture.fixtureTitle), exact: true })
  await projectLink.waitFor({ state: 'visible', timeout: 30000 })
  await projectLink.getByText(CRITICAL_UI.continueProduction, { exact: true }).waitFor({
    state: 'visible',
    timeout: 10000,
  })
  await Promise.all([
    waitForPath(page, (url) => (
      url.pathname === `/film/${fixture.dramaId}`
      && url.searchParams.get('episode') === episodeId
    )),
    projectLink.click(),
  ])
  await page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })

  const canvasButton = page.getByRole('button', { name: CRITICAL_UI.canvasMode, exact: true })
  await waitForEnabled(canvasButton, '画布模式')
  await Promise.all([
    waitForPath(page, (url) => (
      url.pathname === `/film/${fixture.dramaId}/canvas`
      && url.searchParams.get('episode') === episodeId
    )),
    canvasButton.click(),
  ])
  await page.locator('.drama-canvas-page').waitFor({ state: 'visible', timeout: 30000 })

  const deepLink = page.url()
  await page.goto(deepLink, { waitUntil: 'domcontentloaded' })
  await page.locator('.drama-canvas-page').waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(currentUrl(page).pathname, `/film/${fixture.dramaId}/canvas`)
  assert.equal(currentUrl(page).searchParams.get('episode'), episodeId)

  const modeSwitch = page.getByRole('group', { name: CRITICAL_UI.canvasModeGroup, exact: true })
  await modeSwitch.waitFor({ state: 'visible', timeout: 30000 })
  await modeSwitch.getByRole('button', { name: CRITICAL_UI.productionMode, exact: true }).click()

  const listMode = page.getByRole('button', { name: CRITICAL_UI.listMode, exact: true }).first()
  await waitForEnabled(listMode, '列表模式')
  await Promise.all([
    waitForPath(page, (url) => (
      url.pathname === `/film/${fixture.dramaId}`
      && url.searchParams.get('episode') === episodeId
    )),
    listMode.click(),
  ])
  await page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(currentUrl(page).searchParams.get('episode'), episodeId)

  const backToList = page.getByRole('button', { name: CRITICAL_UI.backToList, exact: true }).first()
  await Promise.all([
    waitForPath(page, (url) => url.pathname === '/'),
    backToList.click(),
  ])
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })
  return {
    list: true,
    film: true,
    canvas: true,
    deep_link: deepLink,
    returned_to_list: true,
  }
}

async function verifyLeaveProtectionWhenAutosavePending(page, options = {}) {
  const fixture = resolveFixture(options)
  assert.ok(fixture.frontendUrl && fixture.dramaId && fixture.episodeId, '离开保护合同需要制作页夹具')
  const episodesRoute = `**/api/v1/dramas/${fixture.dramaId}/episodes`
  const routeHandler = async (route) => {
    if (route.request().method() === 'PUT') {
      await fulfillJson(route, {
        status: 503,
        error: { code: 'E2E_AUTOSAVE_FAILED', message: '自动保存失败' },
      })
      return
    }
    await route.continue()
  }
  await page.route(episodesRoute, routeHandler)
  try {
    await page.goto(
      `${fixture.frontendUrl}/film/${fixture.dramaId}?episode=${fixture.episodeId}`,
      { waitUntil: 'domcontentloaded' },
    )
    await page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })
    const scriptBox = page.getByRole('textbox', { name: CRITICAL_UI.scriptContent, exact: true })
    await scriptBox.waitFor({ state: 'visible', timeout: 30000 })
    await scriptBox.fill(`E2E 离开保护未完成自动保存 ${Date.now()}`)

    const backToList = page.getByRole('button', { name: CRITICAL_UI.backToList, exact: true }).first()
    await backToList.click()
    const dialog = page.getByRole('dialog', { name: CRITICAL_UI.unsavedScriptTitle, exact: true })
    await dialog.waitFor({ state: 'visible', timeout: 15000 })
    await dialog.getByText(/自动保存失败/).waitFor({ timeout: 10000 })
    await dialog.getByRole('button', { name: CRITICAL_UI.saveAndLeave, exact: true }).waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: CRITICAL_UI.leaveAnyway, exact: true }).waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    try {
      await dialog.waitFor({ state: 'hidden', timeout: 3000 })
    } catch (_) {
      await dialog.locator('.el-message-box__headerbtn').click()
      await dialog.waitFor({ state: 'hidden', timeout: 10000 })
    }
    assert.equal(currentUrl(page).pathname, `/film/${fixture.dramaId}`)

    await backToList.click()
    await dialog.waitFor({ state: 'visible', timeout: 15000 })
    await Promise.all([
      waitForPath(page, (url) => url.pathname === '/'),
      dialog.getByRole('button', { name: CRITICAL_UI.leaveAnyway, exact: true }).click(),
    ])
    await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })
    return { dialog: true, stayed: true, left_after_discard: true }
  } finally {
    await page.unroute(episodesRoute, routeHandler)
  }
}

async function verifyWorkflowGroupConfirmAndCancel(page, options = {}) {
  const fixture = resolveFixture(options)
  assert.ok(fixture.frontendUrl && fixture.dramaId && fixture.episodeId, '整组执行合同需要画布夹具')
  const group = buildAudioOnlyWorkflowGroup({
    storyboardId: fixture.storyboardId,
    title: options.groupTitle || WORKFLOW_GROUP_TITLE,
    id: options.groupId || WORKFLOW_GROUP_ID,
  })
  if (typeof options.seedWorkflowGroup === 'function') {
    await options.seedWorkflowGroup(group)
  }
  const vendorHits = []
  const restoreVendorGuard = await installVendorMutationGuard(page, vendorHits)
  try {
    await page.goto(
      `${fixture.frontendUrl}/film/${fixture.dramaId}/canvas?episode=${fixture.episodeId}`,
      { waitUntil: 'domcontentloaded' },
    )
    await page.locator('.drama-canvas-page').waitFor({ state: 'visible', timeout: 30000 })
    const modeSwitch = page.getByRole('group', { name: CRITICAL_UI.canvasModeGroup, exact: true })
    await modeSwitch.waitFor({ state: 'visible', timeout: 30000 })
    await modeSwitch.getByRole('button', { name: CRITICAL_UI.productionMode, exact: true }).click()
    await page.getByRole('button', { name: group.title }).first().click()
    const runButton = page.getByRole('button', { name: CRITICAL_UI.runGroup, exact: true })
    await waitForEnabled(runButton, '执行分组')
    await runButton.click()
    const dialog = page.getByRole('dialog', { name: CRITICAL_UI.rerunGroupTitle, exact: true })
    await dialog.waitFor({ state: 'visible', timeout: 15000 })
    await dialog.getByText(/个分镜依次执行/).waitFor({ timeout: 10000 })
    await dialog.getByRole('button', { name: CRITICAL_UI.startRun, exact: true }).waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: CRITICAL_UI.cancel, exact: true }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 10000 })
    assert.deepEqual(vendorHits, [], `取消整组执行后仍发出了供应商请求: ${vendorHits.join(', ')}`)
    assert.equal(currentUrl(page).pathname, `/film/${fixture.dramaId}/canvas`)
    return { confirm_shown: true, cancelled: true, vendor_calls: vendorHits.length, group_title: group.title }
  } finally {
    await restoreVendorGuard()
  }
}

async function verifyBackupRestoreEntry(page, options = {}) {
  const frontendUrl = normalizeFrontendUrl(options.frontendUrl)
  assert.ok(frontendUrl, '备份恢复合同需要 FRONTEND_URL')
  const backupName = String(options.backupName || BACKUP_FIXTURE_NAME)
  const restorePosts = []
  const listRoute = '**/api/v1/settings/backups'
  const restoreRoute = '**/api/v1/settings/backups/restore'
  const listHandler = async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, {
        data: {
          items: [{
            id: backupName,
            name: backupName,
            created_at: '2026-09-10T00:00:00.000Z',
            archive_bytes: 12,
          }],
        },
      })
      return
    }
    await route.continue()
  }
  const restoreHandler = async (route) => {
    restorePosts.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    await fulfillJson(route, {
      status: 599,
      error: { code: 'E2E_RESTORE_FORBIDDEN', message: 'E2E 合同只验证恢复入口，不执行恢复' },
    })
  }
  await page.route(listRoute, listHandler)
  await page.route(restoreRoute, restoreHandler)
  try {
    await page.goto(`${frontendUrl}/`, { waitUntil: 'domcontentloaded' })
    const backupNav = page.getByRole('button', { name: CRITICAL_UI.backupNav, exact: true }).first()
    await backupNav.waitFor({ state: 'visible', timeout: 30000 })
    await Promise.all([
      waitForPath(page, (url) => url.pathname === '/backup'),
      backupNav.click(),
    ])
    await page.getByRole('heading', { name: CRITICAL_UI.backupTitle, exact: true }).waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: CRITICAL_UI.createBackup, exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: CRITICAL_UI.chooseBackupFile, exact: true }).waitFor({ state: 'visible' })
    const restoreButton = page.getByRole('button', { name: CRITICAL_UI.restoreBackup(backupName), exact: true })
    await waitForEnabled(restoreButton, '列表恢复')
    await restoreButton.click()
    const dialog = page.getByRole('dialog', { name: CRITICAL_UI.restoreConfirmTitle, exact: true })
    await dialog.waitFor({ state: 'visible', timeout: 15000 })
    await dialog.getByText(/覆盖当前全部项目/).waitFor({ timeout: 10000 })
    await dialog.getByRole('button', { name: CRITICAL_UI.restoreConfirmTitle, exact: true }).waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: CRITICAL_UI.cancel, exact: true }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 10000 })
    assert.deepEqual(restorePosts, [], `备份恢复入口取消后仍发出恢复请求: ${restorePosts.join(', ')}`)
    assert.equal(currentUrl(page).pathname, '/backup')
    return { reachable: true, confirm_shown: true, cancelled: true, restore_posts: restorePosts.length }
  } finally {
    await page.unroute(restoreRoute, restoreHandler)
    await page.unroute(listRoute, listHandler)
  }
}

async function verifyMissingProjectChineseFailurePages(page, options = {}) {
  const fixture = resolveFixture(options)
  assert.ok(fixture.frontendUrl, '不存在项目合同需要 FRONTEND_URL')
  const missingId = fixture.missingProjectId

  await page.goto(`${fixture.frontendUrl}/drama/${missingId}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: CRITICAL_UI.missingDramaTitle, exact: true }).waitFor({ timeout: 30000 })
  await page.getByText(CRITICAL_UI.missingProjectDetail, { exact: true }).waitFor({ timeout: 10000 })
  await Promise.all([
    waitForPath(page, (url) => url.pathname === '/'),
    page.locator('.project-load-state--error').getByRole('button', { name: CRITICAL_UI.backToList, exact: true }).click(),
  ])
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })

  await page.goto(`${fixture.frontendUrl}/film/${missingId}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: CRITICAL_UI.missingFilmTitle, exact: true }).waitFor({ timeout: 30000 })
  await page.getByText(CRITICAL_UI.missingProjectDetail, { exact: true }).waitFor({ timeout: 10000 })
  await Promise.all([
    waitForPath(page, (url) => url.pathname === '/'),
    page.locator('.project-load-state--error').getByRole('button', { name: CRITICAL_UI.backToList, exact: true }).click(),
  ])
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })

  await page.goto(`${fixture.frontendUrl}/film/${missingId}/canvas`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: CRITICAL_UI.missingCanvasTitle, exact: true }).waitFor({ timeout: 30000 })
  await page.getByText(CRITICAL_UI.missingProjectDetail, { exact: true }).waitFor({ timeout: 10000 })
  await Promise.all([
    waitForPath(page, (url) => url.pathname === '/'),
    page.locator('.canvas-load-failure').getByRole('button', { name: CRITICAL_UI.backToList, exact: true }).click(),
  ])
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })

  await page.goto(`${fixture.frontendUrl}/film/abc`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: CRITICAL_UI.notFoundTitle, exact: true }).waitFor({ timeout: 30000 })
  await page.getByText(/地址可能已失效，或项目编号不正确/).waitFor({ timeout: 10000 })
  await Promise.all([
    waitForPath(page, (url) => url.pathname === '/'),
    page.getByRole('button', { name: CRITICAL_UI.projectList, exact: true }).click(),
  ])
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })

  await page.goto(`${fixture.frontendUrl}/e2e-missing-route`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: CRITICAL_UI.notFoundTitle, exact: true }).waitFor({ timeout: 30000 })
  await page.getByText(/地址可能已失效，或项目编号不正确/).waitFor({ timeout: 10000 })
  await Promise.all([
    waitForPath(page, (url) => url.pathname === '/'),
    page.getByRole('button', { name: CRITICAL_UI.projectList, exact: true }).click(),
  ])
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })

  const assetsRoute = '**/api/v1/assets'
  const assetsHandler = async (route) => {
    if (isGetPathname(route.request(), '/api/v1/assets')) {
      await fulfillJson(route, {
        status: 503,
        error: { code: 'E2E_MEDIA_UNAVAILABLE', message: CRITICAL_UI.mediaLoadFailed },
      })
      return
    }
    await route.continue()
  }
  await page.route(assetsRoute, assetsHandler)
  try {
    await page.goto(`${fixture.frontendUrl}/media-library`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: CRITICAL_UI.mediaLoadFailed, exact: true }).waitFor({ timeout: 30000 })
    await page.getByText(CRITICAL_UI.mediaLoadFailedDetail, { exact: true }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: CRITICAL_UI.retryLoad, exact: true }).waitFor({ state: 'visible' })
  } finally {
    await page.unroute(assetsRoute, assetsHandler)
  }

  return {
    drama: true,
    film: true,
    canvas: true,
    unknown_route: true,
    catchall_route: true,
    media_load_failure: true,
    missing_id: missingId,
  }
}


async function verifyWorkspaceEntries(page, options = {}) {
  const fixture = resolveFixture(options)
  assert.ok(fixture.frontendUrl, '工作区入口合同需要 FRONTEND_URL')

  await page.goto(`${fixture.frontendUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('heading', { name: CRITICAL_UI.workspaceTitle, exact: true }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: CRITICAL_UI.openMediaLibrary, exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: CRITICAL_UI.openFreeCreate, exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: CRITICAL_UI.openAiConfig, exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: CRITICAL_UI.backupNav, exact: true }).first().waitFor({ state: 'visible' })

  await Promise.all([
    waitForPath(page, (url) => url.pathname === '/media-library'),
    page.getByRole('button', { name: CRITICAL_UI.openMediaLibrary, exact: true }).click(),
  ])
  await page.locator('.media-library-page').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('heading', { name: CRITICAL_UI.mediaLibraryTitle, exact: true }).waitFor({ timeout: 15000 })
  await Promise.all([
    waitForPath(page, (url) => url.pathname === '/'),
    page.getByRole('button', { name: CRITICAL_UI.backToHome, exact: true }).click(),
  ])
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })

  await Promise.all([
    waitForPath(page, (url) => url.pathname === '/free-create'),
    page.getByRole('button', { name: CRITICAL_UI.openFreeCreate, exact: true }).click(),
  ])
  await page.locator('.free-create-page').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('heading', { name: CRITICAL_UI.freeCreateTitle, exact: true }).waitFor({ timeout: 15000 })
  await Promise.all([
    waitForPath(page, (url) => url.pathname === '/'),
    page.getByRole('button', { name: CRITICAL_UI.backToHome, exact: true }).click(),
  ])
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })

  await page.getByRole('button', { name: CRITICAL_UI.openAiConfig, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: CRITICAL_UI.aiConfigTitle, exact: true })
  await dialog.waitFor({ state: 'visible', timeout: 30000 })
  const workspace = dialog.getByRole('tablist', { name: CRITICAL_UI.aiConfigWorkspace, exact: true })
  await workspace.waitFor({ state: 'visible', timeout: 15000 })
  await workspace.getByRole('tab', { name: CRITICAL_UI.aiConfigManage, exact: true }).click()
  await page.locator('#ai-config-configs-panel').waitFor({ state: 'visible', timeout: 15000 })
  await workspace.getByRole('tab', { name: CRITICAL_UI.aiConfigCoverage, exact: true }).click()
  await page.locator('#ai-config-coverage-panel').waitFor({ state: 'visible', timeout: 15000 })
  await page.keyboard.press('Escape')
  try {
    await dialog.waitFor({ state: 'hidden', timeout: 3000 })
  } catch (_) {
    await dialog.locator('.el-dialog__headerbtn').click()
    await dialog.waitFor({ state: 'hidden', timeout: 10000 })
  }
  assert.equal(currentUrl(page).pathname, '/')
  return {
    list: true,
    media_library: true,
    free_create: true,
    ai_config_workspace: true,
    backup_nav: true,
  }
}

async function verifyMediaLibraryEmptyStates(page, options = {}) {
  const fixture = resolveFixture(options)
  assert.ok(fixture.frontendUrl, '素材库合同需要 FRONTEND_URL')
  const assetsRoute = '**/api/v1/assets'
  const characterRoute = '**/api/v1/character-library'
  const emptyAssetsHandler = async (route) => {
    if (isGetPathname(route.request(), '/api/v1/assets')) {
      await fulfillJson(route, {
        data: { items: [], total: 0, pagination: { total: 0, page: 1, page_size: 20 } },
      })
      return
    }
    await route.continue()
  }
  const emptyCharacterHandler = async (route) => {
    if (isGetPathname(route.request(), '/api/v1/character-library')) {
      await fulfillJson(route, {
        data: { items: [], pagination: { total: 0, page: 1, page_size: 10 } },
      })
      return
    }
    await route.continue()
  }
  await page.route(assetsRoute, emptyAssetsHandler)
  await page.route(characterRoute, emptyCharacterHandler)
  try {
    await page.goto(`${fixture.frontendUrl}/media-library`, { waitUntil: 'domcontentloaded' })
    await page.locator('.media-library-page').waitFor({ state: 'visible', timeout: 30000 })
    await page.getByRole('heading', { name: CRITICAL_UI.mediaLibraryTitle, exact: true }).waitFor({ timeout: 15000 })
    const sourceTabsRoot = page.locator('.library-tabs')
    await sourceTabsRoot.waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await sourceTabsRoot.getAttribute('aria-label'), CRITICAL_UI.mediaSourceTabs)
    await sourceTabsRoot.getByRole('tablist').waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('tab', { name: CRITICAL_UI.localMediaTab, exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('tab', { name: CRITICAL_UI.networkMediaTab, exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.locator('.empty-media').waitFor({ state: 'visible', timeout: 30000 })
    await page.getByRole('heading', { name: CRITICAL_UI.mediaLibraryEmpty, exact: true }).waitFor({ timeout: 15000 })
    await page.getByText(CRITICAL_UI.mediaLibraryEmptyHint, { exact: true }).waitFor({ timeout: 10000 })
    await page.locator('.empty-media').getByRole('button', { name: CRITICAL_UI.uploadMediaAria, exact: true }).waitFor({ state: 'visible' })

    await page.goto(`${fixture.frontendUrl}/`, { waitUntil: 'domcontentloaded' })
    await page.locator('.film-list').waitFor({ state: 'visible', timeout: 30000 })
    await page.getByRole('button', { name: CRITICAL_UI.openSemanticLibrary, exact: true }).click()
    await page.getByRole('menuitem', { name: CRITICAL_UI.characterLibraryMenu, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: CRITICAL_UI.characterLibraryTitle, exact: true })
    await dialog.waitFor({ state: 'visible', timeout: 15000 })
    await dialog.getByText(CRITICAL_UI.characterLibraryEmpty, { exact: true }).waitFor({ timeout: 10000 })
    await dialog.getByRole('button', { name: CRITICAL_UI.close, exact: true }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 10000 })
    return {
      media_empty: true,
      character_library_empty: true,
    }
  } finally {
    await page.unroute(characterRoute, emptyCharacterHandler)
    await page.unroute(assetsRoute, emptyAssetsHandler)
  }
}

async function verifyStoryboardEmptyStates(page, options = {}) {
  const fixture = resolveFixture(options)
  assert.ok(fixture.frontendUrl && fixture.dramaId && fixture.episodeId, '分镜空状态合同需要制作页夹具')
  const dramaRoute = `**/api/v1/dramas/${fixture.dramaId}`
  const storyboardsRoute = `**/api/v1/episodes/${fixture.episodeId}/storyboards`
  const dramaHandler = async (route) => {
    if (isGetPathname(route.request(), `/api/v1/dramas/${fixture.dramaId}`)) {
      await fulfillEmptyStoryboardDrama(route, fixture)
      return
    }
    await route.continue()
  }
  const storyboardsHandler = async (route) => {
    if (isGetPathname(route.request(), `/api/v1/episodes/${fixture.episodeId}/storyboards`)) {
      await fulfillJson(route, { data: [] })
      return
    }
    await route.continue()
  }
  await page.route(dramaRoute, dramaHandler)
  await page.route(storyboardsRoute, storyboardsHandler)
  try {
    await page.goto(
      `${fixture.frontendUrl}/film/${fixture.dramaId}?episode=${fixture.episodeId}`,
      { waitUntil: 'domcontentloaded' },
    )
    await page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })
    await page.getByText(CRITICAL_UI.storyboardEmpty, { exact: true }).waitFor({ timeout: 15000 })
    const emptyActions = page.locator('.empty-tip-actions')
    await emptyActions.getByRole('button', { name: CRITICAL_UI.emptyGenerateStoryboard, exact: true }).waitFor({ state: 'visible' })
    await emptyActions.getByRole('button', { name: CRITICAL_UI.addStoryboard, exact: true }).waitFor({ state: 'visible' })

    await page.goto(
      `${fixture.frontendUrl}/film/${fixture.dramaId}/canvas?episode=${fixture.episodeId}`,
      { waitUntil: 'domcontentloaded' },
    )
    await page.locator('.drama-canvas-page').waitFor({ state: 'visible', timeout: 30000 })
    const modeSwitch = page.getByRole('group', { name: CRITICAL_UI.canvasModeGroup, exact: true })
    await modeSwitch.waitFor({ state: 'visible', timeout: 30000 })
    await modeSwitch.getByRole('button', { name: CRITICAL_UI.productionMode, exact: true }).click()
    await page.getByRole('group', { name: CRITICAL_UI.batchGenerateGroup, exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByText(CRITICAL_UI.canvasEmptyStoryboard, { exact: true }).waitFor({ timeout: 15000 })
    return {
      film: true,
      canvas: true,
    }
  } finally {
    await page.unroute(storyboardsRoute, storyboardsHandler)
    await page.unroute(dramaRoute, dramaHandler)
  }
}

async function runCriticalUiContracts(page, options = {}) {
  const workspace = await verifyWorkspaceEntries(page, options)
  const mediaLibrary = await verifyMediaLibraryEmptyStates(page, options)
  const deepLink = await verifyProjectListFilmCanvasRoundTrip(page, options)
  const leaveProtection = await verifyLeaveProtectionWhenAutosavePending(page, options)
  const workflowGroup = await verifyWorkflowGroupConfirmAndCancel(page, options)
  const backupRestore = await verifyBackupRestoreEntry(page, options)
  const storyboardEmpty = await verifyStoryboardEmptyStates(page, options)
  const missingProject = await verifyMissingProjectChineseFailurePages(page, options)
  return {
    workspace_entries: workspace,
    media_library: mediaLibrary,
    deep_link_round_trip: deepLink,
    leave_protection: leaveProtection,
    workflow_group: workflowGroup,
    backup_restore: backupRestore,
    storyboard_empty: storyboardEmpty,
    missing_project: missingProject,
  }
}

module.exports = {
  BACKUP_FIXTURE_NAME,
  CRITICAL_UI,
  MISSING_PROJECT_ID,
  WORKFLOW_GROUP_ID,
  WORKFLOW_GROUP_TITLE,
  buildAudioOnlyWorkflowGroup,
  isVendorMutation,
  runCriticalUiContracts,
  vendorGuardPatterns,
  isGetPathname,
  verifyBackupRestoreEntry,
  verifyLeaveProtectionWhenAutosavePending,
  verifyMediaLibraryEmptyStates,
  verifyMissingProjectChineseFailurePages,
  verifyProjectListFilmCanvasRoundTrip,
  verifyStoryboardEmptyStates,
  verifyWorkflowGroupConfirmAndCancel,
  verifyWorkspaceEntries,
}