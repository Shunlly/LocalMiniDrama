const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const {
  DataBackupError,
  createDataBackup,
  createExternalMaintenanceLease,
  getRuntimeServiceMaintenanceLock,
  restoreDataBackup,
} = require('./dataBackupService')
const { isTrustedChineseUserError, isTimeoutLikeError } = require('./providerErrorSanitizer')
const BACKUP_PUBLIC_MESSAGES = require('./backupPublicMessages')

const PENDING_RESTORE_SCHEMA = 'localminidrama.pending-restore.v1'
const PENDING_RESTORE_FILE = '.restore-pending.json'
const SAFE_BACKUP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.zip$/i
const PENDING_RESTORE_MESSAGE = '已安排在下次启动时恢复，请重启应用。'

const HTTP_BACKUP_MESSAGES = BACKUP_PUBLIC_MESSAGES
const ENGLISH_CLAIM_OR_LEASE_RE = /\b(?:claim(?:ed|s|ing)?|leases?)\b/i

function isTrustedBackupUserMessage(text) {
  // 含英文 claim/lease 原文的混合句不能当作可信用户文案。
  return isTrustedChineseUserError(text) && !ENGLISH_CLAIM_OR_LEASE_RE.test(text)
}

function backupError(code, message) {
  const error = new DataBackupError(code, message)
  return error
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveRuntimeDataPaths(cfg = {}, cwd = process.cwd()) {
  const databasePath = path.isAbsolute(cfg.database?.path || '')
    ? cfg.database.path
    : path.resolve(cwd, cfg.database?.path || './data/drama_generator.db')
  const storagePath = cfg.storage?.local_path
    ? (path.isAbsolute(cfg.storage.local_path)
      ? cfg.storage.local_path
      : path.join(cwd, cfg.storage.local_path))
    : path.join(cwd, 'data', 'storage')
  const storySourcesPath = cfg.storage?.story_sources_path
    ? (path.isAbsolute(cfg.storage.story_sources_path)
      ? cfg.storage.story_sources_path
      : path.join(cwd, cfg.storage.story_sources_path))
    : path.join(cwd, 'data', 'story_sources')
  return {
    databasePath: path.resolve(databasePath),
    storagePath: path.resolve(storagePath),
    storySourcesPath: path.resolve(storySourcesPath),
  }
}

function resolveBackupDir(paths) {
  const sibling = path.join(path.dirname(paths.databasePath), 'backups')
  if (
    sibling === paths.databasePath
    || isInside(paths.storagePath, sibling)
    || isInside(paths.storySourcesPath, sibling)
  ) {
    return path.resolve(path.dirname(paths.storagePath), 'localminidrama-backups')
  }
  return path.resolve(sibling)
}

function assertSafeBackupName(name) {
  const value = String(name || '').trim()
  if (!value) throw backupError('BACKUP_FILE_REQUIRED', HTTP_BACKUP_MESSAGES.BACKUP_FILE_REQUIRED)
  if (value.includes('\\') || value.includes('/') || value.includes('..') || !SAFE_BACKUP_NAME_RE.test(value)) {
    throw backupError('BACKUP_FILE_INVALID_NAME', HTTP_BACKUP_MESSAGES.BACKUP_FILE_INVALID_NAME)
  }
  return value
}

function backupFilePath(backupDir, name) {
  const safeName = assertSafeBackupName(name)
  const resolvedDir = path.resolve(backupDir)
  const resolved = path.resolve(resolvedDir, safeName)
  if (path.dirname(resolved) !== resolvedDir) {
    throw backupError('BACKUP_FILE_INVALID_NAME', HTTP_BACKUP_MESSAGES.BACKUP_FILE_INVALID_NAME)
  }
  return resolved
}

function pendingRestorePath(backupDir) {
  return path.join(path.resolve(backupDir), PENDING_RESTORE_FILE)
}

function buildBackupFileName(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\./g, '').replace(/Z$/, 'Z')
  const entropy = crypto.randomBytes(4).toString('hex')
  return `localminidrama-${stamp}-${entropy}.zip`
}

async function ensureBackupDir(backupDir) {
  await fsp.mkdir(backupDir, { recursive: true })
  return backupDir
}

async function placeBackupFile(sourcePath, destPath) {
  const source = path.resolve(sourcePath)
  const dest = path.resolve(destPath)
  if (source === dest) return dest
  try {
    await fsp.rename(source, dest)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    await fsp.copyFile(source, dest, fs.constants.COPYFILE_EXCL)
    await fsp.rm(source, { force: true })
  }
  return dest
}

async function storeUploadedBackup(paths, uploadedPath) {
  if (!uploadedPath) throw backupError('BACKUP_FILE_REQUIRED', HTTP_BACKUP_MESSAGES.BACKUP_FILE_REQUIRED)
  const backupDir = await ensureBackupDir(resolveBackupDir(paths))
  const name = buildBackupFileName()
  const dest = backupFilePath(backupDir, name)
  await placeBackupFile(uploadedPath, dest)
  return name
}

function pendingRestoreResult(name) {
  return {
    pending_restart: true,
    name,
    message: PENDING_RESTORE_MESSAGE,
  }
}

async function readPendingRestore(backupDir) {
  const pendingPath = pendingRestorePath(backupDir)
  let raw
  try {
    raw = await fsp.readFile(pendingPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { pendingPath, exists: false }
    throw error
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.format !== PENDING_RESTORE_SCHEMA || parsed?.confirmed === false || !parsed?.archiveName) {
      return { pendingPath, exists: true, invalid: true }
    }
    return { pendingPath, exists: true, parsed }
  } catch (_) {
    return { pendingPath, exists: true, invalid: true }
  }
}

async function listBackups(paths) {
  const backupDir = resolveBackupDir(paths)
  await ensureBackupDir(backupDir)
  const names = await fsp.readdir(backupDir)
  const items = []
  for (const name of names) {
    if (!SAFE_BACKUP_NAME_RE.test(name)) continue
    const filePath = path.join(backupDir, name)
    let stat
    try {
      stat = await fsp.lstat(filePath)
    } catch (_) {
      continue
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue
    items.push({
      id: name,
      name,
      created_at: new Date(stat.mtimeMs).toISOString(),
      bytes: Number(stat.size) || 0,
    })
  }
  items.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
  return { items }
}

function resolveCreateLease(paths, options = {}) {
  if (options.externalMaintenanceLease != null) return options.externalMaintenanceLease
  const guard = getRuntimeServiceMaintenanceLock(paths.databasePath)
  return guard ? createExternalMaintenanceLease(guard) : undefined
}

async function createBackupOnce(paths, outputPath, options = {}) {
  const result = await createDataBackup({
    databasePath: paths.databasePath,
    storagePath: paths.storagePath,
    storySourcesPath: paths.storySourcesPath,
    outputPath,
    skipServiceCheck: options.skipServiceCheck !== false,
    externalMaintenanceLease: resolveCreateLease(paths, options),
    log: options.log,
    signal: options.signal,
  })
  const fileName = path.basename(result.outputPath || outputPath)
  return {
    id: fileName,
    name: fileName,
    created_at: result.manifest?.createdAt || new Date().toISOString(),
    bytes: Number(result.archiveBytes) || 0,
  }
}

async function createBackup(paths, options = {}) {
  const backupDir = await ensureBackupDir(resolveBackupDir(paths))
  const maxAttempts = options.name ? 1 : 2
  let lastError
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const name = options.name || buildBackupFileName(options.now)
    const outputPath = backupFilePath(backupDir, name)
    try {
      return await createBackupOnce(paths, outputPath, options)
    } catch (error) {
      lastError = error
      if (error?.code !== 'OUTPUT_EXISTS' || attempt === maxAttempts - 1) throw error
    }
  }
  throw lastError
}

async function stagePendingRestore(paths, { name, confirmed } = {}) {
  if (confirmed !== true) {
    throw backupError('CONFIRMATION_REQUIRED', HTTP_BACKUP_MESSAGES.CONFIRMATION_REQUIRED)
  }
  const backupDir = await ensureBackupDir(resolveBackupDir(paths))
  const safeName = assertSafeBackupName(name)
  const archivePath = backupFilePath(backupDir, safeName)
  try {
    const stat = await fsp.lstat(archivePath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw backupError('NOT_FOUND', HTTP_BACKUP_MESSAGES.NOT_FOUND)
    }
  } catch (error) {
    if (error instanceof DataBackupError) throw error
    if (error?.code === 'ENOENT') throw backupError('NOT_FOUND', HTTP_BACKUP_MESSAGES.NOT_FOUND)
    throw error
  }
  const existing = await readPendingRestore(backupDir)
  if (existing.exists && !existing.invalid && existing.parsed.archiveName === safeName) {
    return pendingRestoreResult(safeName)
  }
  const payload = JSON.stringify({
    format: PENDING_RESTORE_SCHEMA,
    archiveName: safeName,
    confirmed: true,
    createdAt: new Date().toISOString(),
  }, null, 2) + '\n'
  const tempPath = existing.pendingPath + '.tmp'
  await fsp.writeFile(tempPath, payload, { encoding: 'utf8', flag: 'w' })
  await fsp.rename(tempPath, existing.pendingPath)
  return pendingRestoreResult(safeName)
}

async function applyPendingRestore(paths, options = {}) {
  const backupDir = resolveBackupDir(paths)
  const pendingPath = pendingRestorePath(backupDir)
  let raw
  try {
    raw = await fsp.readFile(pendingPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { applied: false }
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (_) {
    throw backupError('PENDING_RESTORE_INVALID', HTTP_BACKUP_MESSAGES.PENDING_RESTORE_INVALID)
  }
  if (parsed?.format !== PENDING_RESTORE_SCHEMA || parsed?.confirmed === false) {
    throw backupError('PENDING_RESTORE_INVALID', HTTP_BACKUP_MESSAGES.PENDING_RESTORE_INVALID)
  }
  const archivePath = backupFilePath(backupDir, parsed.archiveName)
  await restoreDataBackup({
    archivePath,
    databasePath: paths.databasePath,
    storagePath: paths.storagePath,
    storySourcesPath: paths.storySourcesPath,
    confirmed: true,
    skipServiceCheck: true,
    log: options.log,
  })
  await fsp.rm(pendingPath, { force: true })
  return { applied: true, name: parsed.archiveName }
}

function applyPendingRestoreSync(paths, options = {}) {
  const backupDir = resolveBackupDir(paths)
  const pendingPath = pendingRestorePath(backupDir)
  if (!fs.existsSync(pendingPath)) return { applied: false, skipped: true }
  const script = path.join(__dirname, 'runPendingRestore.js')
  const result = spawnSync(process.execPath, [script], {
    cwd: options.cwd || process.cwd(),
    env: {
      ...process.env,
      LOCALMINIDRAMA_RESTORE_DATABASE_PATH: paths.databasePath,
      LOCALMINIDRAMA_RESTORE_STORAGE_PATH: paths.storagePath,
      LOCALMINIDRAMA_RESTORE_STORY_SOURCES_PATH: paths.storySourcesPath,
    },
    encoding: 'utf8',
    timeout: options.timeoutMs || 10 * 60 * 1000,
  })
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim()
    const message = isTrustedBackupUserMessage(detail)
      ? detail
      : HTTP_BACKUP_MESSAGES.RESTORE_FAILED
    throw backupError('RESTORE_FAILED', message)
  }
  return { applied: true }
}

async function applyPendingRestoreFromConfig(cfg, options = {}) {
  const paths = resolveRuntimeDataPaths(cfg, options.cwd)
  return applyPendingRestore(paths, options)
}

function describeBackupHttpError(error) {
  let code = String(error?.code || '')
  if (isTimeoutLikeError(error)) {
    // 超时不得收成取消/中断
  } else if (error?.name === 'AbortError' || ['ABORT_ERR', 'ERR_CANCELED', 'OPERATION_CANCELLED'].includes(code)) {
    code = 'OPERATION_ABORTED'
  }
  if (['EACCES', 'EPERM', 'EROFS'].includes(code)) code = 'PERMISSION_DENIED'
  if (code === 'ENOENT') code = 'NOT_FOUND'
  if (!code || code === 'Error') code = 'BACKUP_FAILED'
  const publicMessage = error instanceof DataBackupError
    ? String(error.publicMessage || '')
    : String(error?.message || '')
  const mappedMessage = HTTP_BACKUP_MESSAGES[code] || HTTP_BACKUP_MESSAGES.BACKUP_FAILED
  const message = isTrustedBackupUserMessage(publicMessage) ? publicMessage : mappedMessage
  let status = 500
  if (['CONFIRMATION_REQUIRED', 'INVALID_ARGUMENT', 'BACKUP_FILE_REQUIRED', 'BACKUP_FILE_TYPE', 'BACKUP_FILE_INVALID_NAME', 'PENDING_RESTORE_INVALID'].includes(code)) {
    status = 400
  } else if (code === 'NOT_FOUND') {
    status = 404
  } else if (['SERVICE_RUNNING', 'OUTPUT_EXISTS', 'MAINTENANCE_ACTIVE', 'MAINTENANCE_LOCKED', 'MAINTENANCE_LEASE_INVALID', 'DATABASE_BUSY', 'OPERATION_ABORTED'].includes(code)) {
    status = 409
  } else if (code === 'PERMISSION_DENIED') {
    status = 503
  }
  return { status, code, message }
}

function formatBackupCliError(error) {
  const mapped = describeBackupHttpError(error)
  return `[${mapped.code}] ${mapped.message}`
}

module.exports = {
  HTTP_BACKUP_MESSAGES,
  SAFE_BACKUP_NAME_RE,
  applyPendingRestore,
  applyPendingRestoreSync,
  applyPendingRestoreFromConfig,
  buildBackupFileName,
  createBackup,
  describeBackupHttpError,
  formatBackupCliError,
  listBackups,
  placeBackupFile,
  resolveBackupDir,
  resolveRuntimeDataPaths,
  stagePendingRestore,
  storeUploadedBackup,
}
