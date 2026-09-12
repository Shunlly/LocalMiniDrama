const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');

const { DataBackupError } = require('../src/services/dataBackupErrors');
const { digestBackupCollectionSha256 } = require('../src/services/dataBackupManifest');
const { DEFAULT_LIMITS } = require('../src/services/dataBackupValidation');
const {
  collectStorageFiles,
  collectStorySourceFiles,
  hashCollectedFiles,
  hashStorageFiles,
  hashStorySourceFiles,
  sha256CollectedFile,
  sha256File,
} = require('../src/services/dataBackupCollection');

function expectCode(code) {
  return (error) => error instanceof DataBackupError && error.code === code;
}

async function makeTempRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'lmd-backup-collection-'));
  t.after(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });
  return root;
}

async function trySymlink(target, linkPath, type) {
  try {
    await fsp.symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return false;
    throw error;
  }
}

test('缺失或空目录收集为空集合', async (t) => {
  const root = await makeTempRoot(t);
  const missing = path.join(root, 'missing');
  const empty = path.join(root, 'empty');
  await fsp.mkdir(empty);
  await fsp.mkdir(path.join(empty, 'nested-empty'), { recursive: true });
  assert.deepEqual(await collectStorageFiles(missing, DEFAULT_LIMITS), { files: [], totalBytes: 0 });
  const collected = await collectStorageFiles(empty, DEFAULT_LIMITS);
  assert.deepEqual(collected, { files: [], totalBytes: 0 });
  const hashed = await hashStorageFiles(collected);
  assert.equal(hashed.sha256, digestBackupCollectionSha256([]));
});

test('嵌套文件按 archiveName 排序，并使用 storage 与 story_sources 前缀', async (t) => {
  const root = await makeTempRoot(t);
  const storagePath = path.join(root, 'storage');
  const storySourcesPath = path.join(root, 'story_sources');
  await fsp.mkdir(path.join(storagePath, 'images', 'nested'), { recursive: true });
  await fsp.mkdir(path.join(storySourcesPath, '10'), { recursive: true });
  await fsp.writeFile(path.join(storagePath, 'images', 'cover.txt'), 'cover');
  await fsp.writeFile(path.join(storagePath, 'images', 'nested', 'clip.bin'), Buffer.from([0, 1, 2]));
  await fsp.writeFile(path.join(storySourcesPath, '10', 'source.txt'), 'source');

  const storage = await collectStorageFiles(storagePath, DEFAULT_LIMITS);
  const storySources = await collectStorySourceFiles(storySourcesPath, DEFAULT_LIMITS);
  assert.deepEqual(storage.files.map((file) => file.archiveName), [
    'storage/images/cover.txt',
    'storage/images/nested/clip.bin',
  ]);
  assert.equal(storage.totalBytes, 5 + 3);
  assert.deepEqual(storySources.files.map((file) => file.archiveName), [
    'story_sources/10/source.txt',
  ]);
  assert.equal(storySources.totalBytes, 6);
  assert.equal(storage.files[0].absolute, path.join(storagePath, 'images', 'cover.txt'));
});

test('文件数、单文件大小和总字节超出上限时失败', async (t) => {
  const root = await makeTempRoot(t);
  const storagePath = path.join(root, 'storage');
  await fsp.mkdir(storagePath);
  await fsp.writeFile(path.join(storagePath, 'a.txt'), 'aaaaa');
  await fsp.writeFile(path.join(storagePath, 'b.txt'), 'bbbbb');
  await assert.rejects(
    collectStorageFiles(storagePath, { ...DEFAULT_LIMITS, maxFiles: 1 }),
    expectCode('FILE_LIMIT_EXCEEDED'),
  );
  await assert.rejects(
    collectStorageFiles(storagePath, { ...DEFAULT_LIMITS, maxFileBytes: 4 }),
    expectCode('FILE_LIMIT_EXCEEDED'),
  );
  await assert.rejects(
    collectStorageFiles(storagePath, { ...DEFAULT_LIMITS, maxTotalBytes: 9 }),
    expectCode('SIZE_LIMIT_EXCEEDED'),
  );
  const ok = await collectStorageFiles(storagePath, { ...DEFAULT_LIMITS, maxFiles: 2, maxFileBytes: 5, maxTotalBytes: 10 });
  assert.equal(ok.files.length, 2);
  assert.equal(ok.totalBytes, 10);
});

test('根路径不是普通目录时拒绝', async (t) => {
  const root = await makeTempRoot(t);
  const filePath = path.join(root, 'not-a-dir.txt');
  await fsp.writeFile(filePath, 'x');
  await assert.rejects(collectStorageFiles(filePath, DEFAULT_LIMITS), expectCode('UNSAFE_STORAGE'));
});

test('符号链接根目录和符号链接文件分别拒绝', async (t) => {
  const root = await makeTempRoot(t);
  const realDir = path.join(root, 'real');
  const linkedDir = path.join(root, 'linked');
  const storagePath = path.join(root, 'storage');
  await fsp.mkdir(realDir);
  await fsp.mkdir(storagePath);
  await fsp.writeFile(path.join(realDir, 'cover.txt'), 'cover');
  const linkedRoot = await trySymlink(realDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
  if (linkedRoot) {
    await assert.rejects(collectStorageFiles(linkedDir, DEFAULT_LIMITS), expectCode('UNSAFE_STORAGE'));
  }
  const fileLink = path.join(storagePath, 'link.txt');
  const linkedFile = await trySymlink(path.join(realDir, 'cover.txt'), fileLink, 'file');
  if (linkedFile) {
    await assert.rejects(collectStorageFiles(storagePath, DEFAULT_LIMITS), expectCode('SYMLINK_REJECTED'));
  }
});

test('特殊文件在支持的平台上被拒绝', async (t) => {
  if (process.platform === 'win32') return;
  const root = await makeTempRoot(t);
  const storagePath = path.join(root, 'storage');
  await fsp.mkdir(storagePath);
  const socketPath = path.join(storagePath, 'sock');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(collectStorageFiles(storagePath, DEFAULT_LIMITS), expectCode('SPECIAL_FILE_REJECTED'));
});

test('集合哈希与文件内容一致，并在内容变化或文件消失时失败', async (t) => {
  const root = await makeTempRoot(t);
  const storagePath = path.join(root, 'storage');
  const storySourcesPath = path.join(root, 'story_sources');
  await fsp.mkdir(storagePath);
  await fsp.mkdir(path.join(storySourcesPath, '1'), { recursive: true });
  const filePath = path.join(storagePath, 'cover.txt');
  await fsp.writeFile(filePath, 'cover-data');
  await fsp.writeFile(path.join(storySourcesPath, '1', 'a.txt'), 'source');

  const storage = await hashStorageFiles(await collectStorageFiles(storagePath, DEFAULT_LIMITS));
  const storySources = await hashStorySourceFiles(await collectStorySourceFiles(storySourcesPath, DEFAULT_LIMITS));
  assert.equal(storage.files[0].sha256, crypto.createHash('sha256').update('cover-data').digest('hex'));
  assert.equal(storage.sha256, digestBackupCollectionSha256(storage.files));
  assert.equal(storySources.files[0].sha256, crypto.createHash('sha256').update('source').digest('hex'));
  assert.equal(await sha256CollectedFile(storage.files[0]), storage.files[0].sha256);

  const collectedBeforeChange = await collectStorageFiles(storagePath, DEFAULT_LIMITS);
  await fsp.writeFile(filePath, 'cover-data-changed');
  await assert.rejects(hashCollectedFiles(collectedBeforeChange), expectCode('BACKUP_DATA_CHANGED'));

  const stale = await collectStorageFiles(storagePath, DEFAULT_LIMITS);
  await fsp.rm(filePath);
  await assert.rejects(sha256CollectedFile(stale.files[0]), expectCode('BACKUP_DATA_READ_FAILED'));
});

test('sha256File 对已知内容给出稳定摘要', async (t) => {
  const root = await makeTempRoot(t);
  const filePath = path.join(root, 'payload.bin');
  await fsp.writeFile(filePath, 'abc');
  assert.equal(await sha256File(filePath), crypto.createHash('sha256').update('abc').digest('hex'));
});

test('非法文件名在可创建时拒绝', async (t) => {
  if (process.platform === 'win32') return;
  const root = await makeTempRoot(t);
  const storagePath = path.join(root, 'storage');
  await fsp.mkdir(storagePath);
  await fsp.writeFile(path.join(storagePath, 'bad:name.txt'), 'x');
  await assert.rejects(collectStorageFiles(storagePath, DEFAULT_LIMITS), expectCode('UNSAFE_ARCHIVE_PATH'));
});

