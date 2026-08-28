'use strict'

const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

const viteConfig = read('frontweb', 'vite.config.js')
const frontendIndex = read('frontweb', 'index.html')
const batchLauncher = read('run_dev.bat')
const powershellLauncher = read('run_dev.ps1')
const quickstart = read('docs', 'quickstart.md')
const backendReadme = read('backend-node', 'README.md')
const desktopReadme = read('desktop', 'README.md')
const openclawReadme = read('openclaw-skill', 'README.md')
const openclawSkill = read('openclaw-skill', 'SKILL.md')
const openclawManifest = JSON.parse(read('openclaw-skill', 'skill.json'))
const openclawTools = JSON.parse(read('openclaw-skill', 'tools.json'))
const backendRoutes = read('backend-node', 'src', 'routes', 'index.js')
const backendApp = read('backend-node', 'src', 'app.js')
const workspacePackage = JSON.parse(read('package.json'))
const backendPackage = JSON.parse(read('backend-node', 'package.json'))
const waitLocalDevPath = path.join(root, 'scripts', 'wait-local-dev.cjs')
const waitLocalDev = fs.existsSync(waitLocalDevPath) ? fs.readFileSync(waitLocalDevPath, 'utf8') : ''

function normalizeRoute(method, route) {
  const normalized = route
    .replace(/^\/api\/v1/, '')
    .replace(/[?#].*$/, '')
    .replace(/\{[^}]+\}|:[^/]+/g, '{}')
  return `${method.toUpperCase()} ${normalized}`
}

function declaredSkillRoutes(source) {
  return new Set(
    [...source.matchAll(/\b(GET|POST|PUT|DELETE|PATCH)\s+(?:\{baseUrl\})?(\/api\/v1\/[^\s`#]+)/g)]
      .map((match) => normalizeRoute(match[1], match[2])),
  )
}

function implementedBackendRoutes(source) {
  return new Set(
    [...source.matchAll(/r\.(get|post|put|delete|patch)\('([^']+)'/g)]
      .map((match) => normalizeRoute(match[1], match[2])),
  )
}

test('maintenance recovery is exposed from the workspace and backend packages', () => {
  assert.equal(
    workspacePackage.scripts['maintenance:recover'],
    'npm --prefix backend-node run maintenance:recover --',
  )
  assert.equal(backendPackage.scripts['maintenance:recover'], 'node scripts/recover-maintenance.js')
})

test('Vite development server binds to loopback unless explicitly overridden', () => {
  assert.match(viteConfig, /VITE_DEV_SERVER_HOST\s*\|\|\s*'127\.0\.0\.1'/)
  assert.match(viteConfig, /host:\s*devServerHost/)
  assert.match(viteConfig, /strictPort:\s*true/)
  assert.doesNotMatch(viteConfig, /host:\s*['"]0\.0\.0\.0['"]/)
  assert.match(frontendIndex, /name="application-name" content="LocalMiniDrama"/)
  assert.match(frontendIndex, /name="application-version" content="%VITE_LOCALMINIDRAMA_VERSION%"/)
  assert.match(frontendIndex, /name="localminidrama-instance" content="%VITE_LOCALMINIDRAMA_INSTANCE_ID%"/)
  assert.match(backendApp, /instance_id:\s*RUNTIME_INSTANCE_ID/)
})

test('development launchers reuse verified services, wait for readiness and never kill arbitrary listeners', () => {
  assert.doesNotMatch(batchLauncher, /taskkill/i)
  assert.match(batchLauncher, /Reusing existing LocalMiniDrama backend/i)
  assert.match(batchLauncher, /port 5679 is occupied by another process/i)
  assert.match(batchLauncher, /Reusing existing LocalMiniDrama frontend/i)
  assert.match(batchLauncher, /port 3013 is occupied by another process/i)
  assert.match(batchLauncher, /wait-local-dev\.cjs" backend 60000/i)
  assert.match(batchLauncher, /wait-local-dev\.cjs" frontend 60000/i)
  assert.match(batchLauncher, /did not become ready/i)
  assert.match(batchLauncher, /exit \/b 1/i)

  assert.doesNotMatch(powershellLauncher, /Stop-Process|taskkill/i)
  assert.match(powershellLauncher, /Reusing existing LocalMiniDrama backend/i)
  assert.match(powershellLauncher, /port 5679 is occupied by another process/i)
  assert.match(powershellLauncher, /Reusing existing LocalMiniDrama frontend/i)
  assert.match(powershellLauncher, /port 3013 is occupied by another process/i)
  assert.match(powershellLauncher, /wait-local-dev\.cjs" backend 60000/i)
  assert.match(powershellLauncher, /wait-local-dev\.cjs" frontend 60000/i)
  assert.match(powershellLauncher, /did not become ready/i)

  assert.match(waitLocalDev, /http:\/\/127\.0\.0\.1:5679\/health/)
  assert.match(waitLocalDev, /http:\/\/127\.0\.0\.1:5679\/ready/)
  assert.match(waitLocalDev, /http:\/\/127\.0\.0\.1:3013\//)
  assert.match(waitLocalDev, /\^LocalMiniDrama/)
  assert.match(waitLocalDev, /application-name/)
  assert.match(waitLocalDev, /favicon\\\.svg/)
})

test('local readiness helper polls until the backend identifies itself', async (t) => {
  assert.equal(fs.existsSync(waitLocalDevPath), true, 'local readiness helper must exist')
  const { waitForLocalService } = require(waitLocalDevPath)
  let attempts = 0
  const server = http.createServer((req, res) => {
    if (req.url === '/ready') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ status: 'ready' }))
      return
    }
    attempts += 1
    res.setHeader('Content-Type', 'application/json')
    if (attempts === 1) {
      res.statusCode = 503
      res.end(JSON.stringify({ status: 'starting' }))
      return
    }
    res.end(JSON.stringify({
      status: 'ok',
      app: 'LocalMiniDrama Test',
      version: 'test-version',
      instance_id: 'test-instance',
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const address = server.address()
  await waitForLocalService('backend', {
    url: `http://127.0.0.1:${address.port}/health`,
    timeoutMs: 1000,
    intervalMs: 10,
    requestTimeoutMs: 200,
    expectedVersion: 'test-version',
    expectedInstanceId: 'test-instance',
  })
  assert.ok(attempts >= 2)
})

test('local readiness helper rejects a matching backend whose dependencies are not ready', async (t) => {
  assert.equal(fs.existsSync(waitLocalDevPath), true, 'local readiness helper must exist')
  const { waitForLocalService } = require(waitLocalDevPath)
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/ready') {
      res.statusCode = 503
      res.end(JSON.stringify({ status: 'not_ready' }))
      return
    }
    res.end(JSON.stringify({
      status: 'ok',
      app: 'LocalMiniDrama Test',
      version: 'test-version',
      instance_id: 'test-instance',
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const address = server.address()
  await assert.rejects(
    waitForLocalService('backend', {
      url: `http://127.0.0.1:${address.port}/health`,
      readyUrl: `http://127.0.0.1:${address.port}/ready`,
      timeoutMs: 80,
      intervalMs: 10,
      requestTimeoutMs: 50,
      expectedVersion: 'test-version',
      expectedInstanceId: 'test-instance',
    }),
    /did not become ready/,
  )
})

test('local readiness helper rejects an unrelated frontend', async (t) => {
  assert.equal(fs.existsSync(waitLocalDevPath), true, 'local readiness helper must exist')
  const { waitForLocalService } = require(waitLocalDevPath)
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><link rel="icon" href="/favicon.svg"><div id="app"></div>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const address = server.address()
  await assert.rejects(
    waitForLocalService('frontend', {
      url: `http://127.0.0.1:${address.port}/`,
      timeoutMs: 80,
      intervalMs: 10,
      requestTimeoutMs: 50,
    }),
    /did not become ready/,
  )
})

test('operations documentation distinguishes executable data, downtime, API prefix and release order', () => {
  assert.match(quickstart, /%APPDATA%\\localminidrama-desktop\\backend\\/)
  assert.match(quickstart, /完全退出.*桌面应用[\s\S]*复制整个.*backend\\/)
  assert.match(quickstart, /database\.path[\s\S]*storage\.local_path[\s\S]*绝对路径/)
  assert.match(quickstart, /curl\.exe --fail http:\/\/127\.0\.0\.1:5679\/ready/)
  assert.match(quickstart, /API 路径前缀/)
  assert.doesNotMatch(quickstart, /API 根路径/)
  assert.match(quickstart, /正式发布顺序/)
  assert.match(quickstart, /分支 CI[\s\S]*创建 annotated tag[\s\S]*草稿 Release/)
  assert.doesNotMatch(quickstart, /\d+\s*项备份恢复专项测试/)

  assert.match(desktopReadme, /desktop\/backend-app/)
  assert.match(desktopReadme, /可重新生成/)
  assert.match(desktopReadme, /不要.*唯一.*开发数据/)
  assert.match(desktopReadme, /localminidrama-desktop-dev/)
  assert.match(desktopReadme, /localminidrama-desktop/)
  assert.match(desktopReadme, /四份.*CycloneDX SBOM/)
  assert.match(desktopReadme, /`npm run dist`.*Setup.*Portable.*`win-unpacked`/s)
  assert.match(quickstart, /`npm run dist`.*Setup.*Portable.*`win-unpacked`/s)

  for (const source of [quickstart, backendReadme]) {
    assert.doesNotMatch(source, /Server started on port 5679/)
    assert.match(source, /\/ready/)
  }
  assert.match(backendReadme, /curl\.exe --fail http:\/\/127\.0\.0\.1:5679\/ready/)
  assert.doesNotMatch(backendReadme, /\/ai-configs\/:id\/test|\/ai-configs\/preset\//)
  assert.doesNotMatch(backendReadme, /\/episodes\/:id\/merge-video|\/episodes\/:id\/merge-status/)
  assert.match(backendReadme, /POST.*`\/ai-configs\/test`/)
  assert.match(backendReadme, /POST.*`\/episodes\/:episode_id\/finalize`/)
  assert.match(backendReadme, /35_storyboard_order_integrity\.sql/)
})

test('OpenClaw documentation never recommends exposing the unauthenticated backend', () => {
  for (const source of [openclawReadme, openclawSkill]) {
    assert.doesNotMatch(source, /http:\/\/你的服务器IP:5679|cpolar\.io/)
    assert.match(source, /不得.*公网.*5679|禁止.*公网.*5679/)
    assert.match(source, /认证[\s\S]*TLS/)
  }
  assert.equal(openclawManifest.config.base_url.default, 'http://127.0.0.1:5679')
  assert.equal(openclawManifest.version, '1.1.1')
  assert.match(openclawSkill, /^version: 1\.1\.1$/m)
  assert.match(openclawReadme, /`1\.1\.1`/)
  assert.doesNotMatch(openclawTools.tools[0].description, /自动拼接/)
  assert.doesNotMatch(
    openclawSkill,
    /生成剧本（流式）|preset\/dashscope|sk-\.\.\.|\/images\/episode\/\{episode_id\}\/batch|\/videos\/episode\/\{episode_id\}\/batch|POST \{baseUrl\}\/api\/v1\/video-merges(?:\s|$)|prompt_override/,
  )
  assert.match(openclawSkill, /POST \{baseUrl\}\/api\/v1\/images\/upload/)
  assert.match(openclawSkill, /POST \{baseUrl\}\/api\/v1\/episodes\/\{episode_id\}\/finalize/)
  assert.match(openclawSkill, /POST \{baseUrl\}\/api\/v1\/characters\/\{character_id\}\/upload-image/)
})

test('every HTTP route documented by the OpenClaw skill exists in the backend router', () => {
  const declared = declaredSkillRoutes(openclawSkill)
  const implemented = implementedBackendRoutes(backendRoutes)
  const missing = [...declared].filter((route) => !implemented.has(route)).sort()
  assert.ok(declared.size > 50, 'OpenClaw route inventory is unexpectedly small')
  assert.deepEqual(missing, [])
})
