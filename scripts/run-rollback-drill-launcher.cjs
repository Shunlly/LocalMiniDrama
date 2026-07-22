'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const backendRoot = path.join(root, 'backend-node')
const backendRequire = createRequire(path.join(backendRoot, 'package.json'))
const { loadConfig } = backendRequire('./src/config')
const {
  acquireServiceMaintenanceLockSync,
  assertServiceStopped,
  createExternalMaintenanceLease,
} = backendRequire('./src/services/dataBackupService')
const { parseDrillArguments } = require('./rollback-drill-evidence.cjs')

const ROLLBACK_NODE_IMAGE = 'node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0'
const DOCKER_CONTROL_TIMEOUT_MS = 5000
const MAX_LAUNCHER_DIAGNOSTIC_BYTES = 64 * 1024
const CONTAINER_LABEL_PREFIX = 'localminidrama.rollback-drill.run='
const CONTAINER_NAME_PREFIX = 'localminidrama-rollback-'
const PASSTHROUGH_ENVIRONMENT = Object.freeze([
  'CI',
  'GITHUB_ACTIONS',
  'HOST',
  'LOCALMINIDRAMA_CONFIG_DIR',
  'LOCALMINIDRAMA_CONFIG_PATH',
  'LOCALMINIDRAMA_DATA_DIR',
  'NODE_ENV',
  'PORT',
])

function assertAbsolute(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`)
  assert.equal(path.isAbsolute(value), true, `${label} must be absolute`)
  return path.resolve(value)
}

function isInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function containerPath(repoRoot, hostPath) {
  if (!isInside(repoRoot, hostPath)) return hostPath
  const relative = path.relative(repoRoot, hostPath).split(path.sep).join('/')
  return relative ? `/workspace/${relative}` : '/workspace'
}

function assertDiagnosticDirectory(repoRoot, artifactDirectory) {
  const resolvedRepoRoot = assertAbsolute(repoRoot, 'repository root')
  const resolvedArtifactDirectory = assertAbsolute(artifactDirectory, 'rollback artifact directory')
  const expectedArtifactDirectory = path.join(resolvedRepoRoot, 'artifacts', 'rollback-drill')
  assert.equal(
    resolvedArtifactDirectory,
    expectedArtifactDirectory,
    'rollback artifact directory must be the repository diagnostic directory',
  )

  const realRepoRoot = fs.realpathSync.native(resolvedRepoRoot)
  const realArtifactDirectory = fs.realpathSync.native(resolvedArtifactDirectory)
  assert.equal(
    realArtifactDirectory,
    path.join(realRepoRoot, 'artifacts', 'rollback-drill'),
    'rollback diagnostic directory must remain physically inside the repository',
  )

  let cursor = resolvedRepoRoot
  for (const component of ['artifacts', 'rollback-drill']) {
    cursor = path.join(cursor, component)
    const information = fs.lstatSync(cursor)
    assert.equal(information.isSymbolicLink(), false, 'rollback diagnostic directory must not contain symbolic links')
    assert.equal(information.isDirectory(), true, 'rollback diagnostic path must contain only ordinary directories')
  }
  return resolvedArtifactDirectory
}

function ensureDiagnosticDirectory(repoRoot) {
  const resolvedRepoRoot = assertAbsolute(repoRoot, 'repository root')
  const realRepoRoot = fs.realpathSync.native(resolvedRepoRoot)
  let cursor = resolvedRepoRoot
  let realCursor = realRepoRoot
  for (const component of ['artifacts', 'rollback-drill']) {
    cursor = path.join(cursor, component)
    realCursor = path.join(realCursor, component)
    let information
    try {
      information = fs.lstatSync(cursor)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      fs.mkdirSync(cursor)
      information = fs.lstatSync(cursor)
    }
    assert.equal(information.isSymbolicLink(), false, 'rollback diagnostic directory must not contain symbolic links')
    assert.equal(information.isDirectory(), true, 'rollback diagnostic path must contain only ordinary directories')
    assert.equal(
      fs.realpathSync.native(cursor),
      realCursor,
      'rollback diagnostic directory must remain physically inside the repository',
    )
  }
  return assertDiagnosticDirectory(resolvedRepoRoot, cursor)
}

function appendMount(args, seenTargets, source, target, mode) {
  const resolvedSource = assertAbsolute(source, `Docker mount source for ${target}`)
  assert.equal(path.isAbsolute(target), true, `Docker mount target must be absolute: ${target}`)
  if (seenTargets.has(target)) return
  seenTargets.add(target)
  args.push('--volume', `${resolvedSource}:${target}:${mode}`)
}

function buildLinuxRollbackContainerInvocation({
  repoRoot,
  dataRoot,
  archivePath = null,
  artifactDirectory,
  drillArguments = [],
  environment = {},
  externalMaintenanceLease,
  cidFile,
  containerLabel,
  containerName,
  sourceCommit,
  uid,
  gid,
}) {
  const resolvedRepoRoot = assertAbsolute(repoRoot, 'repository root')
  const resolvedDataRoot = assertAbsolute(dataRoot, 'rollback data root')
  const resolvedArtifactDirectory = assertAbsolute(artifactDirectory, 'rollback artifact directory')
  const expectedArtifactDirectory = path.join(resolvedRepoRoot, 'artifacts', 'rollback-drill')
  assert.equal(resolvedArtifactDirectory, expectedArtifactDirectory, 'rollback artifact directory must be the repository diagnostic directory')
  assert.ok(Array.isArray(drillArguments) && drillArguments.every((value) => typeof value === 'string'), 'rollback drill arguments must be strings')
  assert.ok(Number.isSafeInteger(uid) && uid >= 0, 'Linux rollback UID is invalid')
  assert.ok(Number.isSafeInteger(gid) && gid >= 0, 'Linux rollback GID is invalid')
  assert.match(sourceCommit || '', /^[a-f0-9]{40}$/, 'Linux rollback source commit is invalid')
  const management = validateContainerManagement({ cidFile, containerLabel, containerName })

  const args = [
    'run',
    '--rm',
    '--cidfile',
    management.cidFile,
    '--label',
    management.containerLabel,
    '--name',
    management.containerName,
    '--init',
    '--read-only',
    '--network',
    'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--tmpfs',
    `/tmp:rw,nosuid,nodev,exec,mode=700,size=48g,uid=${uid},gid=${gid}`,
    '--user',
    `${uid}:${gid}`,
    '--workdir',
    '/workspace',
  ]
  const seenTargets = new Set()
  appendMount(args, seenTargets, resolvedRepoRoot, '/workspace', 'ro')
  appendMount(args, seenTargets, resolvedArtifactDirectory, '/workspace/artifacts/rollback-drill', 'rw')
  appendMount(args, seenTargets, resolvedDataRoot, resolvedDataRoot, 'ro')
  if (archivePath) {
    const resolvedArchivePath = assertAbsolute(archivePath, 'rollback archive')
    appendMount(args, seenTargets, path.dirname(resolvedArchivePath), path.dirname(resolvedArchivePath), 'ro')
  }

  assert.ok(
    externalMaintenanceLease && typeof externalMaintenanceLease === 'object',
    'Linux rollback requires a retained host maintenance lease',
  )
  const encodedMaintenanceLease = Buffer.from(JSON.stringify(externalMaintenanceLease), 'utf8').toString('base64url')
  args.push(
    '--env',
    'HOME=/tmp',
    '--env',
    'LMD_ROLLBACK_PRIVATE_CLEANUP=container-v1',
    '--env',
    `LMD_ROLLBACK_MAINTENANCE_LEASE=${encodedMaintenanceLease}`,
    '--env',
    `LMD_ROLLBACK_SOURCE_COMMIT=${sourceCommit}`,
  )
  for (const name of PASSTHROUGH_ENVIRONMENT) {
    const raw = environment[name]
    if (raw === undefined || raw === null || String(raw).length === 0) continue
    let value = String(raw)
    if (name === 'LOCALMINIDRAMA_CONFIG_DIR' || name === 'LOCALMINIDRAMA_CONFIG_PATH' || name === 'LOCALMINIDRAMA_DATA_DIR') {
      const resolved = assertAbsolute(value, name)
      if (!isInside(resolvedRepoRoot, resolved)) {
        const source = name === 'LOCALMINIDRAMA_CONFIG_PATH' ? path.dirname(resolved) : resolved
        const target = name === 'LOCALMINIDRAMA_CONFIG_PATH' ? path.dirname(resolved) : resolved
        appendMount(args, seenTargets, source, target, 'ro')
      }
      value = containerPath(resolvedRepoRoot, resolved)
    }
    args.push('--env', `${name}=${value}`)
  }

  const mappedArguments = drillArguments.map((value) => {
    if (!path.isAbsolute(value)) return value
    return containerPath(resolvedRepoRoot, path.resolve(value))
  })
  args.push(ROLLBACK_NODE_IMAGE, 'node', 'scripts/run-rollback-drill.cjs', ...mappedArguments)
  return { command: 'docker', args }
}

function assertPrivateCleanupBoundary({
  platform = process.platform,
  environment = process.env,
  dockerEnvironmentPresent = platform === 'linux' && fs.existsSync('/.dockerenv'),
} = {}) {
  if (platform === 'win32') return
  assert.equal(platform, 'linux', 'POSIX rollback cleanup is supported only by the Linux private-container launcher')
  assert.equal(
    environment.LMD_ROLLBACK_PRIVATE_CLEANUP,
    'container-v1',
    'POSIX rollback cleanup requires the private-container boundary marker',
  )
  assert.equal(dockerEnvironmentPresent, true, 'POSIX rollback cleanup requires an actual private Docker container boundary')
}

function decodeExternalMaintenanceLease(value) {
  assert.equal(typeof value, 'string', 'rollback maintenance lease must be encoded text')
  assert.match(value, /^[A-Za-z0-9_-]{1,4096}$/, 'rollback maintenance lease encoding is invalid')
  const bytes = Buffer.from(value, 'base64url')
  assert.equal(bytes.toString('base64url'), value, 'rollback maintenance lease encoding is not canonical')
  const parsed = JSON.parse(bytes.toString('utf8'))
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'rollback maintenance lease must be an object')
  return Object.freeze(parsed)
}

function configuredPath(value, fallback) {
  const candidate = value || fallback
  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(backendRoot, candidate)
}

function resolveStandaloneSourcePaths(config) {
  const databasePath = configuredPath(config.database?.path, './data/drama_generator.db')
  const storagePath = configuredPath(config.storage?.local_path, './data/storage')
  const storySourcesPath = path.join(backendRoot, 'data', 'story_sources')
  const dataRoot = path.dirname(databasePath)
  for (const candidate of [storagePath, storySourcesPath]) {
    assert.equal(path.dirname(candidate), dataRoot, 'standalone rollback source paths must share one data root')
  }
  return { dataRoot, databasePath, storagePath, storySourcesPath }
}

function resolveCheckpointSourcePaths(dataRoot) {
  return {
    dataRoot,
    databasePath: path.join(dataRoot, 'drama_generator.db'),
    storagePath: path.join(dataRoot, 'storage'),
    storySourcesPath: path.join(dataRoot, 'story_sources'),
  }
}

function selectedConfigPath() {
  const explicit = String(process.env.LOCALMINIDRAMA_CONFIG_PATH || '').trim()
  if (explicit) return path.resolve(explicit)
  return path.join(backendRoot, 'configs', 'config.yaml')
}

function gitOutput(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    windowsHide: true,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Git source proof failed: ${String(result.stderr || '').trim()}`)
  return String(result.stdout || '').trim()
}

function assertHostSourceRevision(expectedCommit = null, runGit = gitOutput) {
  const status = String(runGit(['status', '--porcelain', '--untracked-files=all']) || '').trim()
  assert.equal(status, '', 'rollback drill requires a clean host working tree')
  const commit = String(runGit(['rev-parse', 'HEAD']) || '').trim().toLowerCase()
  assert.match(commit, /^[a-f0-9]{40}$/, 'rollback drill host revision is not a full Git commit')
  if (expectedCommit !== null) {
    assert.equal(commit, expectedCommit, 'rollback drill host revision changed while the container was running')
  }
  return commit
}

function validateContainerManagement({ cidFile, containerLabel, containerName }) {
  const resolvedCidFile = assertAbsolute(cidFile, 'rollback Docker CID file')
  assert.match(
    containerLabel || '',
    /^localminidrama\.rollback-drill\.run=[a-f0-9]{32}$/,
    'rollback Docker ownership label is invalid',
  )
  assert.match(
    containerName || '',
    /^localminidrama-rollback-[a-f0-9]{32}$/,
    'rollback Docker container name is invalid',
  )
  const labelToken = containerLabel.slice(CONTAINER_LABEL_PREFIX.length)
  assert.equal(containerName, `${CONTAINER_NAME_PREFIX}${labelToken}`, 'rollback Docker ownership values disagree')
  return { cidFile: resolvedCidFile, containerLabel, containerName }
}

function createContainerManagement(environment = process.env) {
  const explicit = {
    cidFile: String(environment.LMD_ROLLBACK_CIDFILE || '').trim(),
    containerLabel: String(environment.LMD_ROLLBACK_CONTAINER_LABEL || '').trim(),
    containerName: String(environment.LMD_ROLLBACK_CONTAINER_NAME || '').trim(),
  }
  const explicitCount = Object.values(explicit).filter(Boolean).length
  if (explicitCount > 0) {
    assert.equal(explicitCount, 3, 'rollback Docker ownership environment must define CID file, label, and name together')
    const management = validateContainerManagement(explicit)
    const parentStat = fs.lstatSync(path.dirname(management.cidFile))
    assert.equal(parentStat.isDirectory() && !parentStat.isSymbolicLink(), true, 'rollback Docker CID directory is unsafe')
    assert.equal(fs.existsSync(management.cidFile), false, 'rollback Docker CID file already exists')
    return { ...management, ownedDirectory: null }
  }

  const ownedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-rollback-launcher-'))
  fs.chmodSync(ownedDirectory, 0o700)
  const token = crypto.randomBytes(16).toString('hex')
  return {
    cidFile: path.join(ownedDirectory, 'container.cid'),
    containerLabel: `${CONTAINER_LABEL_PREFIX}${token}`,
    containerName: `${CONTAINER_NAME_PREFIX}${token}`,
    ownedDirectory,
  }
}

function createInterruptionController() {
  let interruptionSignal = null
  let child = null
  let forceKillTimer = null
  let unreapedTimer = null
  let onUnreaped = null
  const handlers = new Map()
  const interrupt = (signal) => {
    if (!interruptionSignal) interruptionSignal = signal
    if (!child) return
    try { child.kill('SIGTERM') } catch (_) {}
    if (!forceKillTimer) {
      forceKillTimer = setTimeout(() => {
        try { child?.kill('SIGKILL') } catch (_) {}
        if (child && !unreapedTimer) {
          unreapedTimer = setTimeout(() => onUnreaped?.(), 2000)
          unreapedTimer.unref?.()
        }
      }, 2000)
      forceKillTimer.unref?.()
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => interrupt(signal)
    handlers.set(signal, handler)
    process.on(signal, handler)
  }
  return {
    get signal() { return interruptionSignal },
    setChild(value, unreapedCallback = null) {
      child = value
      onUnreaped = unreapedCallback
      if (child && interruptionSignal) interrupt(interruptionSignal)
      if (!child && forceKillTimer) {
        clearTimeout(forceKillTimer)
        forceKillTimer = null
      }
      if (!child && unreapedTimer) {
        clearTimeout(unreapedTimer)
        unreapedTimer = null
      }
      if (!child) onUnreaped = null
    },
    dispose() {
      this.setChild(null)
      for (const [signal, handler] of handlers) process.off(signal, handler)
    },
  }
}

function runManagedChild(command, args, controller) {
  return new Promise((resolve, reject) => {
    let settled = false
    let child
    try {
      child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
    } catch (error) {
      reject(error)
      return
    }
    controller.setChild(child, () => {
      try { child.unref() } catch (_) {}
      const error = new Error('Rollback Docker CLI did not exit after bounded TERM and KILL escalation.')
      error.dockerCliExitUnproven = true
      finish(reject, error)
    })
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      controller.setChild(null)
      callback(value)
    }
    child.once('error', (error) => finish(reject, error))
    child.once('exit', (status, signal) => finish(resolve, { signal, status }))
  })
}

function dockerControl(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    timeout: DOCKER_CONTROL_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    windowsHide: true,
  })
  if (result.error) {
    if (allowFailure) return result
    throw result.error
  }
  assert.equal(Number.isInteger(result.status), true, `Docker control command did not return an exit code: ${args.join(' ')}`)
  if (!allowFailure) {
    assert.equal(result.status, 0, `Docker control command failed: docker ${args.join(' ')}\n${String(result.stderr || '').trim()}`)
  }
  return result
}

function listContainerIds(filter) {
  const result = dockerControl(['container', 'ls', '--all', '--no-trunc', '--quiet', '--filter', filter])
  const output = String(result.stdout || '').trim()
  if (!output) return []
  const ids = output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
  assert.ok(ids.length <= 1, 'rollback Docker ownership label matched more than one container')
  for (const id of ids) assert.match(id, /^[a-f0-9]{64}$/, 'rollback Docker returned a truncated or invalid container ID')
  return ids
}

function readContainerId(cidFile) {
  if (!fs.existsSync(cidFile)) return null
  const stat = fs.lstatSync(cidFile)
  assert.equal(stat.isFile() && !stat.isSymbolicLink(), true, 'rollback Docker CID path is unsafe')
  if (stat.size <= 0 || stat.size > 129) return null
  const value = fs.readFileSync(cidFile, 'utf8').trim()
  return /^[a-f0-9]{64}$/.test(value) ? value : null
}

function inspectOwnedContainer(id, management, controls = {}) {
  const runDockerControl = controls.dockerControl || dockerControl
  const listIds = controls.listContainerIds || listContainerIds
  const labelKey = management.containerLabel.slice(0, management.containerLabel.indexOf('='))
  const expectedValue = management.containerLabel.slice(management.containerLabel.indexOf('=') + 1)
  const result = runDockerControl([
    'container',
    'inspect',
    '--format',
    `{{ index .Config.Labels ${JSON.stringify(labelKey)} }}`,
    id,
  ], { allowFailure: true })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const remaining = listIds(`id=${id}`)
    assert.deepEqual(
      remaining,
      [],
      'Docker inspect failed for a rollback container that still exists',
    )
    return false
  }
  assert.equal(String(result.stdout || '').trim(), expectedValue, 'rollback Docker candidate is not owned by this run')
  return true
}

function discoverOwnedContainerIds(management, extraIds = []) {
  const recordedId = readContainerId(management.cidFile)
  const candidates = new Set([
    ...listContainerIds(`label=${management.containerLabel}`),
    ...listContainerIds(`name=^/${management.containerName}$`),
  ])
  for (const id of [recordedId, ...extraIds]) {
    if (!id) continue
    for (const candidate of listContainerIds(`id=${id}`)) candidates.add(candidate)
  }
  const owned = []
  for (const id of candidates) {
    if (inspectOwnedContainer(id, management)) owned.push(id)
  }
  return owned
}

function removeOwnedContainers(management, extraIds = []) {
  const ids = discoverOwnedContainerIds(management, extraIds)
  for (const id of ids) {
    dockerControl(['stop', '--time', '3', id], { allowFailure: true })
    dockerControl(['kill', id], { allowFailure: true })
    dockerControl(['rm', '--force', id], { allowFailure: true })
  }
}

function createDockerDaemonBarrier(management) {
  let lastFailure = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    removeOwnedContainers(management)
    const result = dockerControl([
      'create',
      '--pull',
      'never',
      '--name',
      management.containerName,
      '--label',
      management.containerLabel,
      ROLLBACK_NODE_IMAGE,
      'node',
      '-e',
      'process.exit(0)',
    ], { allowFailure: true })
    if (result.error) throw result.error
    if (result.status !== 0) {
      lastFailure = new Error(`Docker cleanup barrier was rejected: ${String(result.stderr || '').trim()}`)
      continue
    }
    const sentinelId = String(result.stdout || '').trim()
    assert.match(sentinelId, /^[a-f0-9]{64}$/, 'Docker cleanup barrier returned an invalid container ID')
    assert.equal(inspectOwnedContainer(sentinelId, management), true, 'Docker cleanup barrier disappeared before verification')
    dockerControl(['rm', '--force', sentinelId], { allowFailure: true })
    assert.deepEqual(
      discoverOwnedContainerIds(management, [sentinelId]),
      [],
      'rollback Docker container cleanup could not be proven after the daemon barrier',
    )
    return
  }
  throw lastFailure || new Error('Docker cleanup barrier could not be established.')
}

function cleanupOwnedContainer(management) {
  createDockerDaemonBarrier(management)
  fs.rmSync(management.cidFile, { force: true })
}

function cleanupContainerManagement(management) {
  fs.rmSync(management.cidFile, { force: true })
  if (management.ownedDirectory) fs.rmSync(management.ownedDirectory, { recursive: true, force: true })
}

function attachCleanupError(primaryError, cleanupError) {
  let existing = []
  try {
    const descriptor = Object.getOwnPropertyDescriptor(primaryError, 'cleanupErrors')
    if (descriptor && Object.hasOwn(descriptor, 'value') && Array.isArray(descriptor.value)) {
      for (let index = 0; index < Math.min(7, descriptor.value.length); index += 1) {
        const entry = Object.getOwnPropertyDescriptor(descriptor.value, String(index))
        if (entry && Object.hasOwn(entry, 'value')) existing.push(entry.value)
      }
    }
  } catch (_) {}
  try {
    Object.defineProperty(primaryError, 'cleanupErrors', {
      configurable: true,
      enumerable: false,
      value: Object.freeze([...existing, cleanupError]),
    })
  } catch (_) {}
  return primaryError
}

function boundedLauncherDiagnostic(value, limit = 24 * 1024) {
  let text
  try { text = String(value?.stack || value) } catch (_) { text = '[unprintable thrown value]' }
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= limit) return text
  return `${bytes.subarray(0, Math.max(0, limit - 32)).toString('utf8')}\n[diagnostic truncated]`
}

function renderLauncherError(error) {
  const sections = [boundedLauncherDiagnostic(error)]
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'cleanupErrors')
    if (descriptor && Object.hasOwn(descriptor, 'value') && Array.isArray(descriptor.value)) {
      for (let index = 0; index < Math.min(8, descriptor.value.length); index += 1) {
        const entry = Object.getOwnPropertyDescriptor(descriptor.value, String(index))
        if (!entry || !Object.hasOwn(entry, 'value')) continue
        sections.push(`[cleanup ${index + 1}] ${boundedLauncherDiagnostic(entry.value, 4 * 1024)}`)
      }
    }
  } catch (_) {}
  const output = sections.join('\n')
  const bytes = Buffer.from(output, 'utf8')
  if (bytes.length <= MAX_LAUNCHER_DIAGNOSTIC_BYTES) return output
  return `${bytes.subarray(0, MAX_LAUNCHER_DIAGNOSTIC_BYTES - 32).toString('utf8')}\n[diagnostic truncated]`
}

function recordLauncherCleanupFailure(primaryError, cleanupError) {
  return primaryError ? attachCleanupError(primaryError, cleanupError) : cleanupError
}

async function runWindowsRollback({
  parsed,
  config = loadConfig(),
  environment = process.env,
  drillMain = (options) => require('./run-rollback-drill.cjs').main(options),
} = {}) {
  assert.ok(parsed && typeof parsed === 'object', 'Windows rollback arguments are required')
  const sourcePaths = parsed.inputMode === 'checkpoint-bound'
    ? resolveCheckpointSourcePaths(parsed.dataRoot)
    : resolveStandaloneSourcePaths(config)
  const serviceHost = environment.HOST || config.server?.host || '127.0.0.1'
  const servicePort = Number(environment.PORT) || config.server?.port || 5679
  await assertServiceStopped({ serviceHost, servicePort })

  let maintenanceGuard
  let primaryError = null
  try {
    maintenanceGuard = acquireServiceMaintenanceLockSync({
      databasePath: sourcePaths.databasePath,
      storagePath: sourcePaths.storagePath,
      storySourcesPath: sourcePaths.storySourcesPath,
    })
    await drillMain({
      externalMaintenanceLease: createExternalMaintenanceLease(maintenanceGuard),
    })
  } catch (error) {
    primaryError = error
  } finally {
    if (maintenanceGuard) {
      try {
        maintenanceGuard.release()
      } catch (cleanupError) {
        primaryError = recordLauncherCleanupFailure(primaryError, cleanupError)
      }
    }
  }
  if (primaryError) throw primaryError
}

async function main() {
  const drillArguments = process.argv.slice(2)
  const parsed = parseDrillArguments(drillArguments)
  if (process.platform === 'win32') {
    await runWindowsRollback({ parsed })
    return
  }
  assert.equal(process.platform, 'linux', 'Rollback drill launcher supports Windows directly and Linux through Docker')
  const sourceCommit = assertHostSourceRevision()
  const config = loadConfig()
  const sourcePaths = parsed.inputMode === 'checkpoint-bound'
    ? resolveCheckpointSourcePaths(parsed.dataRoot)
    : resolveStandaloneSourcePaths(config)
  const dataRoot = sourcePaths.dataRoot
  const artifactDirectory = ensureDiagnosticDirectory(root)
  const environment = { ...process.env }
  const configPath = selectedConfigPath()
  if (!environment.LOCALMINIDRAMA_CONFIG_PATH) environment.LOCALMINIDRAMA_CONFIG_PATH = configPath
  const serviceHost = environment.HOST || config.server?.host || '127.0.0.1'
  const servicePort = Number(environment.PORT) || config.server?.port || 5679
  await assertServiceStopped({ serviceHost, servicePort })

  let maintenanceGuard
  let management
  let interruptionController
  let primaryError = null
  let childResult = null
  let dockerCliExitProven = false
  let containerLaunchAttempted = false
  let containerCleanupProven = false
  try {
    try {
      maintenanceGuard = acquireServiceMaintenanceLockSync({
        databasePath: sourcePaths.databasePath,
        storagePath: sourcePaths.storagePath,
        storySourcesPath: sourcePaths.storySourcesPath,
      })
      management = createContainerManagement(environment)
      const invocation = buildLinuxRollbackContainerInvocation({
        repoRoot: root,
        dataRoot,
        archivePath: parsed.inputMode === 'checkpoint-bound' ? parsed.archivePath : null,
        artifactDirectory,
        drillArguments,
        environment,
        externalMaintenanceLease: createExternalMaintenanceLease(maintenanceGuard),
        cidFile: management.cidFile,
        containerLabel: management.containerLabel,
        containerName: management.containerName,
        sourceCommit,
        uid: process.getuid(),
        gid: process.getgid(),
      })
      interruptionController = createInterruptionController()
      containerLaunchAttempted = true
      try {
        childResult = await runManagedChild(invocation.command, invocation.args, interruptionController)
        dockerCliExitProven = !childResult.signal && !interruptionController.signal
        if (childResult.signal) {
          const error = new Error(`Rollback drill launcher was terminated by ${childResult.signal}.`)
          error.dockerCliExitUnproven = true
          throw error
        }
        assert.equal(
          Number.isInteger(childResult.status) || Boolean(interruptionController.signal),
          true,
          'Rollback drill launcher did not return an exit code',
        )
      } catch (error) {
        dockerCliExitProven = error?.dockerCliExitUnproven !== true
        primaryError = error
      }
      try {
        cleanupOwnedContainer(management)
        containerCleanupProven = dockerCliExitProven
      } catch (cleanupError) {
        primaryError = recordLauncherCleanupFailure(primaryError, cleanupError)
      }
      if (containerCleanupProven && maintenanceGuard) {
        try {
          createExternalMaintenanceLease(maintenanceGuard)
        } catch (cleanupError) {
          primaryError = recordLauncherCleanupFailure(primaryError, cleanupError)
        }
      }
      if (!primaryError && childResult.status === 0 && !interruptionController.signal) {
        assertHostSourceRevision(sourceCommit)
      }
    } catch (error) {
      primaryError = recordLauncherCleanupFailure(primaryError, error)
    }
    if (interruptionController?.signal === 'SIGINT') process.exitCode = 130
    else if (interruptionController?.signal === 'SIGTERM') process.exitCode = 143
    else if (Number.isInteger(childResult?.status)) process.exitCode = childResult.status
  } finally {
    try {
      interruptionController?.dispose()
    } catch (cleanupError) {
      primaryError = recordLauncherCleanupFailure(primaryError, cleanupError)
    }
    if (maintenanceGuard) {
      try {
        if (containerLaunchAttempted && !containerCleanupProven) maintenanceGuard.abandon()
        else maintenanceGuard.release()
      } catch (cleanupError) {
        primaryError = recordLauncherCleanupFailure(primaryError, cleanupError)
      }
    }
    if (management && (!containerLaunchAttempted || containerCleanupProven)) {
      try {
        cleanupContainerManagement(management)
      } catch (cleanupError) {
        primaryError = recordLauncherCleanupFailure(primaryError, cleanupError)
      }
    }
  }
  if (primaryError) throw primaryError
}

module.exports = {
  ROLLBACK_NODE_IMAGE,
  assertDiagnosticDirectory,
  assertHostSourceRevision,
  assertPrivateCleanupBoundary,
  buildLinuxRollbackContainerInvocation,
  cleanupOwnedContainer,
  createContainerManagement,
  decodeExternalMaintenanceLease,
  ensureDiagnosticDirectory,
  inspectOwnedContainer,
  main,
  renderLauncherError,
  runWindowsRollback,
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${renderLauncherError(error)}\n`)
    if (!process.exitCode) process.exitCode = 1
  })
}
