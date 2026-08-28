const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  DataBackupError,
  createDataBackup,
  restoreDataBackup,
} = require('./dataBackupService')

const PENDING_RESTORE_SCHEMA = 'localminidrama.pending-restore.v1'
const PENDING_RESTORE_FILE = '.restore-pending.json'
const SAFE_BACKUP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.zip$/i

const HTTP_BACKUP_MESSAGES = Object.freeze({
  CONFIRMATION_REQUIRED: '恢复需要明确确认，当前数据不会被覆盖。',
  INVALID_ARGUMENT: '备份参数不完整，请重新选择备份文件后再试。',
  SERVICE_RUNNING: '请先停止本地短剧助手服务，再执行全量恢复。',
  OUTPUT_EXISTS: '目标备份文件已存在，请更换输出位置后再试。',
  BACKUP_FAILED: '数据备份未能完成。',
  RESTORE_FAILED: '数据恢复未能完成，原有数据应仍可用。',
  BACKUP_FILE_REQUIRED: '请先选择备份文件。',
  BACKUP_FILE_TYPE: '请选择 .zip 格式的备份文件。',
  BACKUP_FILE_INVALID_NAME: '备份文件名无效，请重新选择。',
  NOT_FOUND: '找不到该备份文件。',
  PENDING_RESTORE_INVALID: '待恢复登记无效，请重新确认恢复。',
})

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
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return `localminidrama-${stamp}.zip`
}

async function ensureBackupDir(backupDir) {
  await fsp.mkdir(backupDir, { recursive: true })
  return backupDir
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

async function createBackup(paths, options = {}) {
  const backupDir = await ensureBackupDir(resolveBackupDir(paths))
  const name = options.name || buildBackupFileName(options.now)
  const outputPath = backupFilePath(backupDir, name)
  const result = await createDataBackup({
    databasePath: paths.databasePath,
    storagePath: paths.storagePath,
    storySourcesPath: paths.storySourcesPath,
    outputPath,
    skipServiceCheck: options.skipServiceCheck !== false,
    log: options.log,
    signal: options.signal,
  })
  return {
    name: path.basename(result.outputPath || outputPath),
    created_at: result.manifest?.createdAt || new Date().toISOString(),
    bytes: Number(result.archiveBytes) || 0,
  }
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
  const pendingPath = pendingRestorePath(backupDir)
  const payload = `${JSON.stringify({
    format: PENDING_RESTORE_SCHEMA,
    archiveName: safeName,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`
  const tempPath = `${pendingPath}.${process.pid}.tmp`
  await fsp.writeFile(tempPath, payload, { encoding: 'utf8', flag: 'w' })
  await fsp.rename(tempPath, pendingPath)
  return {
    pending_restart: true,
    name: safeName,
    message: '已安排在下次启动时恢复，请重启应用。',
  }
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
    throw new Error(detail || '待恢复备份未能在启动前应用')
  }
  return { applied: true }
}

async function applyPendingRestoreFromConfig(cfg, options = {}) {
  const paths = resolveRuntimeDataPaths(cfg, options.cwd)
  return applyPendingRestore(paths, options)
}

function describeBackupHttpError(error) {
  const code = String(error?.code || 'BACKUP_FAILED')
  const message = HTTP_BACKUP_MESSAGES[code]
    || (error instanceof DataBackupError ? error.publicMessage : '')
    || HTTP_BACKUP_MESSAGES.BACKUP_FAILED
  let status = 500
  if (['CONFIRMATION_REQUIRED', 'INVALID_ARGUMENT', 'BACKUP_FILE_REQUIRED', 'BACKUP_FILE_TYPE', 'BACKUP_FILE_INVALID_NAME', 'PENDING_RESTORE_INVALID'].includes(code)) {
    status = 400
  } else if (code === 'NOT_FOUND') {
    status = 404
  } else if (['SERVICE_RUNNING', 'OUTPUT_EXISTS', 'MAINTENANCE_ACTIVE', 'MAINTENANCE_LOCKED'].includes(code)) {
    status = 409
  } else if (code === 'PERMISSION_DENIED') {
    status = 503
  }
  return { status, code, message }
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
  listBackups,
  resolveBackupDir,
  resolveRuntimeDataPaths,
  stagePendingRestore,
}
