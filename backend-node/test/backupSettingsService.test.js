const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const { setupRouter } = require('../src/routes')
const {
  applyPendingRestore,
  applyPendingRestoreSync,
  createBackup,
  listBackups,
  resolveRuntimeDataPaths,
  stagePendingRestore,
} = require('../src/services/backupSettingsService')
const { DataBackupError } = require('../src/services/dataBackupService')

async function makeWorkspace(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-backup-settings-'))
  t.after(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })
  const databasePath = path.join(root, 'live', 'drama.db')
  const storagePath = path.join(root, 'live', 'storage')
  const storySourcesPath = path.join(root, 'live', 'story_sources')
  await fsp.mkdir(path.dirname(databasePath), { recursive: true })
  await fsp.mkdir(storagePath, { recursive: true })
  await fsp.mkdir(storySourcesPath, { recursive: true })
  const db = new Database(databasePath)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT INTO records (value) VALUES (?)').run('before-backup')
  db.close()
  await fsp.writeFile(path.join(storagePath, 'cover.txt'), 'cover-before')
  return { root, databasePath, storagePath, storySourcesPath }
}

function readValue(databasePath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    return db.prepare('SELECT value FROM records ORDER BY id').get().value
  } finally {
    db.close()
  }
}

test('创建备份时跳过停服检查，列表只返回安全 zip 名', async (t) => {
  const workspace = await makeWorkspace(t)
  const created = await createBackup(workspace)
  assert.match(created.name, /^localminidrama-\d{8}T\d{6}Z\.zip$/)
  assert.ok(created.bytes > 0)
  await fsp.writeFile(path.join(path.dirname(workspace.databasePath), 'backups', 'ignore.txt'), 'no')
  const listed = await listBackups(workspace)
  assert.equal(listed.items.length, 1)
  assert.equal(listed.items[0].name, created.name)
})

test('恢复未确认会失败，确认后只登记下次启动恢复', async (t) => {
  const workspace = await makeWorkspace(t)
  const created = await createBackup(workspace)
  await assert.rejects(
    () => stagePendingRestore(workspace, { name: created.name, confirmed: false }),
    (error) => error instanceof DataBackupError && error.code === 'CONFIRMATION_REQUIRED',
  )
  const staged = await stagePendingRestore(workspace, { name: created.name, confirmed: true })
  assert.equal(staged.pending_restart, true)
  assert.match(staged.message, /重启/)
  assert.equal(readValue(workspace.databasePath), 'before-backup')
})

test('启动恢复会覆盖当前数据，且 drama 路径不会把备份写进素材目录', async (t) => {
  const workspace = await makeWorkspace(t)
  const created = await createBackup(workspace)
  const db = new Database(workspace.databasePath)
  db.prepare('DELETE FROM records').run()
  db.prepare('INSERT INTO records (value) VALUES (?)').run('changed-after-backup')
  db.close()
  await stagePendingRestore(workspace, { name: created.name, confirmed: true })
  const applied = await applyPendingRestore(workspace)
  assert.equal(applied.applied, true)
  assert.equal(readValue(workspace.databasePath), 'before-backup')
  const second = await applyPendingRestore(workspace)
  assert.equal(second.applied, false)
})

test('同步启动恢复可在打开数据库前覆盖数据', async (t) => {
  const workspace = await makeWorkspace(t)
  const created = await createBackup(workspace)
  const db = new Database(workspace.databasePath)
  db.prepare('DELETE FROM records').run()
  db.prepare('INSERT INTO records (value) VALUES (?)').run('changed-after-backup')
  db.close()
  await stagePendingRestore(workspace, { name: created.name, confirmed: true })
  const applied = applyPendingRestoreSync(workspace)
  assert.equal(applied.applied, true)
  assert.equal(readValue(workspace.databasePath), 'before-backup')
})

test('HTTP 列表和创建走真实备份目录，恢复返回待重启', async (t) => {
  const workspace = await makeWorkspace(t)
  const cfg = {
    database: { path: workspace.databasePath },
    storage: {
      local_path: workspace.storagePath,
      story_sources_path: workspace.storySourcesPath,
    },
    server: {},
  }
  const db = new Database(workspace.databasePath)
  const app = express()
  app.use(express.json())
  app.use('/api/v1', setupRouter(cfg, db, { info() {}, warn() {}, error() {}, operation() {} }))
  const server = app.listen(0, '127.0.0.1')
  t.after(async () => {
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/settings/backups`
  const empty = await fetch(baseUrl)
  const emptyBody = await empty.json()
  assert.equal(empty.status, 200)
  assert.deepEqual(emptyBody.data.items, [])

  const created = await fetch(baseUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  const createdBody = await created.json()
  assert.equal(created.status, 201)
  assert.match(createdBody.data.name, /\.zip$/)

  const listed = await fetch(baseUrl)
  const listedBody = await listed.json()
  assert.equal(listedBody.data.items.length, 1)

  const unconfirmed = await fetch(`${baseUrl}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: createdBody.data.name, confirmed: false }),
  })
  const unconfirmedBody = await unconfirmed.json()
  assert.equal(unconfirmed.status, 400)
  assert.equal(unconfirmedBody.error.code, 'CONFIRMATION_REQUIRED')

  const restored = await fetch(`${baseUrl}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: createdBody.data.name, confirmed: true }),
  })
  const restoredBody = await restored.json()
  assert.equal(restored.status, 200)
  assert.equal(restoredBody.data.pending_restart, true)
  assert.equal(readValue(workspace.databasePath), 'before-backup')
  db.close()
})

test('resolveRuntimeDataPaths 不会把备份目录放到素材目录里', () => {
  const cwd = 'D:/tmp/lmd-root'
  const paths = resolveRuntimeDataPaths({
    database: { path: 'D:/tmp/lmd-root/data/drama_generator.db' },
    storage: { local_path: 'D:/tmp/lmd-root/data/storage' },
  }, cwd)
  assert.equal(paths.databasePath.includes('storage'), false)
  const backupDir = require('../src/services/backupSettingsService').resolveBackupDir(paths)
  assert.equal(backupDir.replace(/\\/g, '/').endsWith('/data/backups'), true)
  assert.equal(backupDir.includes(`${path.sep}storage${path.sep}`), false)
})
