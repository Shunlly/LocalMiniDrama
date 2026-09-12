const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const dataBackupService = require('../src/services/dataBackupService');
const { DataBackupError } = require('../src/services/dataBackupErrors');
const {
  existingAncestor,
  lstatIfExists,
  lstatIfExistsSync,
  makeSiblingPath,
  randomSuffix,
  resolveDataRoot,
  resolveStorySourcesPath,
} = require('../src/services/dataBackupPaths');

function expectCode(code) {
  return (error) => error instanceof DataBackupError && error.code === code;
}

async function makeTempRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'lmd-backup-paths-'));
  t.after(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('dataBackupService 仍导出同一 resolveDataRoot', () => {
  assert.equal(dataBackupService.resolveDataRoot, resolveDataRoot);
});

test('resolveDataRoot 拒绝相对路径、空值和文件系统根', () => {
  assert.throws(() => resolveDataRoot('relative-data-root'), expectCode('INVALID_DATA_ROOT'));
  assert.throws(() => resolveDataRoot(''), expectCode('INVALID_DATA_ROOT'));
  assert.throws(() => resolveDataRoot('   '), expectCode('INVALID_DATA_ROOT'));
  assert.throws(() => resolveDataRoot(null), expectCode('INVALID_DATA_ROOT'));
  assert.throws(() => resolveDataRoot(path.parse(process.cwd()).root), expectCode('INVALID_DATA_ROOT'));
});

test('resolveDataRoot 拒绝文件、缺失路径和符号链接，接受真实目录', async (t) => {
  const root = await makeTempRoot(t);
  const realRoot = path.join(root, 'real');
  const missing = path.join(root, 'missing');
  const filePath = path.join(root, 'not-a-dir.txt');
  await fsp.mkdir(realRoot);
  await fsp.writeFile(filePath, 'x');
  const accepted = resolveDataRoot('  ' + realRoot + '  ');
  assert.equal(accepted, path.resolve(fs.realpathSync(realRoot)));
  assert.throws(() => resolveDataRoot(filePath), expectCode('INVALID_DATA_ROOT'));
  assert.throws(() => resolveDataRoot(missing), expectCode('INVALID_DATA_ROOT'));

  const linkedRoot = path.join(root, 'linked');
  try {
    await fsp.symlink(realRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return;
    throw error;
  }
  assert.throws(() => resolveDataRoot(linkedRoot), expectCode('INVALID_DATA_ROOT'));
});

test('resolveStorySourcesPath 默认落到当前工作目录下的 data/story_sources，也可显式覆盖', async (t) => {
  assert.equal(
    resolveStorySourcesPath(),
    path.resolve(process.cwd(), 'data', 'story_sources'),
  );
  const root = await makeTempRoot(t);
  const custom = path.join(root, 'custom-sources');
  assert.equal(resolveStorySourcesPath({ storySourcesPath: custom }), path.resolve(custom));
  assert.equal(
    resolveStorySourcesPath({ storySourcesPath: '' }),
    path.resolve(process.cwd(), 'data', 'story_sources'),
  );
});

test('makeSiblingPath 在目标旁生成带标签的临时路径，且两次调用不重复', async (t) => {
  const root = await makeTempRoot(t);
  const target = path.join(root, 'drama.db');
  const first = makeSiblingPath(target, 'restore-incoming');
  const second = makeSiblingPath(target, 'restore-incoming');
  const prefix = '.' + path.basename(target) + '.restore-incoming.';
  assert.equal(path.dirname(first), path.dirname(target));
  assert.equal(path.basename(first).startsWith(prefix), true);
  assert.match(path.basename(first), /\.[0-9a-f]{16}$/);
  assert.notEqual(first, second);
});

test('randomSuffix 返回 16 位十六进制', () => {
  const first = randomSuffix();
  const second = randomSuffix();
  assert.match(first, /^[0-9a-f]{16}$/);
  assert.match(second, /^[0-9a-f]{16}$/);
  assert.notEqual(first, second);
});

test('lstatIfExists 对存在的路径返回 stat，缺失时返回 null', async (t) => {
  const root = await makeTempRoot(t);
  const filePath = path.join(root, 'present.txt');
  await fsp.writeFile(filePath, 'ok');
  const stat = await lstatIfExists(filePath);
  assert.equal(stat.isFile(), true);
  assert.equal(await lstatIfExists(path.join(root, 'absent.txt')), null);
  const syncStat = lstatIfExistsSync(filePath);
  assert.equal(syncStat.isFile(), true);
  assert.equal(lstatIfExistsSync(path.join(root, 'absent.txt')), null);
});

test('existingAncestor 从缺失路径回退到已存在的父目录', async (t) => {
  const root = await makeTempRoot(t);
  const missing = path.join(root, 'a', 'b', 'c.txt');
  assert.equal(await existingAncestor(missing), path.resolve(root));
  assert.equal(await existingAncestor(root), path.resolve(root));
});

