'use strict'

const fs = require('node:fs')
const path = require('node:path')
const {
  createRuntimeInstanceId,
} = require('../backend-node/src/utils/runtimeInstanceId.js')

const WORKSPACE_ROOT = path.resolve(__dirname, '..')
const EXPECTED_VERSION = JSON.parse(
  fs.readFileSync(path.join(WORKSPACE_ROOT, 'backend-node', 'package.json'), 'utf8'),
).version
const EXPECTED_INSTANCE_ID = createRuntimeInstanceId({ rootDirectory: WORKSPACE_ROOT })

const SERVICE_DEFAULTS = Object.freeze({
  backend: Object.freeze({
    url: 'http://127.0.0.1:5679/health',
    readyUrl: 'http://127.0.0.1:5679/ready',
    accept: 'application/json',
  }),
  frontend: Object.freeze({
    url: 'http://127.0.0.1:3013/',
    accept: 'text/html',
  }),
})

function positiveInteger(value, fallback, name) {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function metaContent(body, name) {
  for (const match of String(body).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0]
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i)
    if (nameMatch?.[1] !== name) continue
    return tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? null
  }
  return null
}

function isExpectedService(service, body, identity = {}) {
  const expectedVersion = identity.expectedVersion || EXPECTED_VERSION
  const expectedInstanceId = identity.expectedInstanceId || EXPECTED_INSTANCE_ID
  if (service === 'backend') {
    try {
      const payload = JSON.parse(body)
      return payload?.status === 'ok'
        && /^LocalMiniDrama/.test(String(payload?.app || ''))
        && payload?.version === expectedVersion
        && payload?.instance_id === expectedInstanceId
    } catch {
      return false
    }
  }

  return /<meta\s+name=["']application-name["']\s+content=["']LocalMiniDrama["']\s*\/?>/i.test(body)
    && /<div\s+id=["']app["']\s*><\/div>/i.test(body)
    && /href=["'][^"']*favicon\.svg(?:[?#][^"']*)?["']/i.test(body)
    && metaContent(body, 'application-version') === expectedVersion
    && metaContent(body, 'localminidrama-instance') === expectedInstanceId
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForLocalService(service, options = {}) {
  const defaults = SERVICE_DEFAULTS[service]
  if (!defaults) throw new Error('service must be backend or frontend')

  const url = options.url || defaults.url
  const readyUrl = options.readyUrl || (
    service === 'backend'
      ? (options.url ? new URL('/ready', url).toString() : defaults.readyUrl)
      : null
  )
  const timeoutMs = positiveInteger(options.timeoutMs, 60000, 'timeoutMs')
  const intervalMs = positiveInteger(options.intervalMs, 250, 'intervalMs')
  const requestTimeoutMs = positiveInteger(options.requestTimeoutMs, 2000, 'requestTimeoutMs')
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('Node.js 20 or newer is required')

  const deadline = Date.now() + timeoutMs
  const request = async (requestUrl, accept) => {
    const remainingMs = Math.max(1, deadline - Date.now())
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(requestTimeoutMs, remainingMs),
    )
    try {
      const response = await fetchImpl(requestUrl, {
        headers: { Accept: accept },
        redirect: 'error',
        signal: controller.signal,
      })
      return { response, body: await response.text() }
    } finally {
      clearTimeout(timer)
    }
  }

  do {
    try {
      const identity = {
        expectedVersion: options.expectedVersion,
        expectedInstanceId: options.expectedInstanceId,
      }
      const probe = await request(url, defaults.accept)
      if (probe.response.ok && isExpectedService(service, probe.body, identity)) {
        if (service !== 'backend') return { service, url }
        const readiness = await request(readyUrl, 'application/json')
        let readinessPayload = null
        try {
          readinessPayload = JSON.parse(readiness.body)
        } catch (_) {}
        if (readiness.response.ok && readinessPayload?.status === 'ready') {
          return { service, url }
        }
      }
    } catch {
      // A service may refuse connections or reset sockets while it is starting.
    }

    const delayMs = Math.min(intervalMs, Math.max(0, deadline - Date.now()))
    if (delayMs > 0) await sleep(delayMs)
  } while (Date.now() < deadline)

  throw new Error(`LocalMiniDrama ${service} did not become ready at ${url} within ${timeoutMs}ms`)
}

async function main(argv = process.argv.slice(2)) {
  const service = String(argv[0] || '').toLowerCase()
  const timeoutMs = positiveInteger(argv[1], 60000, 'timeoutMs')
  const result = await waitForLocalService(service, { timeoutMs })
  process.stdout.write(`[dev] ${result.service} ready at ${result.url}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[dev] ${error.message}\n`)
    process.exitCode = 1
  })
}

module.exports = {
  isExpectedService,
  waitForLocalService,
}
