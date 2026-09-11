const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const assetService = require('../src/services/assetService');
const paths = require('../src/services/assetServicePaths');
const storageLayout = require('../src/services/storageLayout');

const DRAMA_ACTIVE = 11;
const DRAMA_OTHER = 22;
const ASSET_ACTIVE = 1101;
const LIBRARY_DRAMA = 9909;

test('跨模块 ID 在路径用例里互不相等，避免碰巧同值假通过', () => {
  const ids = [DRAMA_ACTIVE, DRAMA_OTHER, ASSET_ACTIVE, LIBRARY_DRAMA];
  assert.equal(new Set(ids).size, ids.length);
});

test('服务文件已抽出路径规范化，公开 API 不暴露路径辅助函数', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/assetService.js'), 'utf8');
  for (const name of [
    'function normalizeLocalReference',
    'function normalizeLocalPath',
    'function localPathReferenceKey',
    'function physicalPathKey',
    'function isWithinRoot',
    'function configuredStorageRoot',
    'function controlledUploadReference',
    'function resolveControlledUploadPath',
    'function isAllowedProjectPath',
    'function assertProjectPathScope',
  ]) {
    assert.equal(src.includes(name), false, name);
  }
  assert.equal(src.includes('function create'), true);
  assert.equal(src.includes('function update'), true);
  assert.equal(src.includes('function deleteById'), true);
  assert.equal(typeof assetService.normalizeLocalReference, 'undefined');
  assert.equal(typeof assetService.isAllowedProjectPath, 'undefined');
  assert.equal(typeof assetService.resolveControlledUploadPath, 'undefined');
});

test('normalizeLocalReference 接受 /static 前缀并拒绝不安全引用', () => {
  assert.equal(paths.normalizeLocalReference(undefined, 'local_path'), null);
  assert.equal(paths.normalizeLocalReference('', 'local_path'), null);
  assert.equal(
    paths.normalizeLocalReference('/static/library/uploads/a.png', 'local_path'),
    'library/uploads/a.png',
  );
  assert.throws(
    () => paths.normalizeLocalReference(123, 'local_path'),
    (error) => error.code === 'BAD_REQUEST' && error.message === '本地路径 必须为安全的本地媒体引用',
  );
  assert.throws(
    () => paths.normalizeLocalReference('../outside/uploads/a.png', 'url'),
    (error) => error.code === 'BAD_REQUEST' && error.message === '媒体地址 必须为安全的本地媒体引用',
  );
});

test('项目路径作用域只认当前项目前缀、历史 dramas/{id} 和公共库', () => {
  const drama = {
    id: DRAMA_ACTIVE,
    title: '夜雨',
    created_at: '2026-07-27T00:00:00.000Z',
    metadata: null,
  };
  const currentPrefix = storageLayout.buildProjectRelativeDir(drama);
  const otherDrama = {
    id: DRAMA_OTHER,
    title: '另一部',
    created_at: '2026-07-27T00:00:00.000Z',
    metadata: null,
  };
  assert.notEqual(currentPrefix, storageLayout.buildProjectRelativeDir(otherDrama));
  assert.equal(paths.isAllowedProjectPath(drama, `${currentPrefix}/uploads/a.png`), true);
  assert.equal(paths.isAllowedProjectPath(drama, `dramas/${DRAMA_ACTIVE}/uploads/a.png`), true);
  assert.equal(paths.isAllowedProjectPath(drama, 'library/uploads/a.png'), true);
  assert.equal(paths.isAllowedProjectPath(drama, `dramas/${DRAMA_OTHER}/uploads/a.png`), false);
  assert.equal(paths.isAllowedProjectPath(drama, 'uploads/a.png'), false);
  assert.equal(paths.isAllowedProjectPath(null, 'uploads/a.png'), true);
  assert.equal(paths.isAllowedProjectPath(null, 'library/uploads/a.png'), true);
  assert.throws(
    () => paths.assertProjectPathScope(drama, `dramas/${DRAMA_OTHER}/uploads/a.png`, '媒体路径'),
    (error) => error.code === 'BAD_REQUEST' && error.message === '媒体路径 不属于当前项目或公共素材库',
  );
  assert.equal(paths.assertProjectPathScope(drama, 'library/uploads/a.png', '媒体路径'), 'library/uploads/a.png');
});

test('受控上传引用只接受 uploads 目录下的真实文件，且不得逃出存储根', () => {
  assert.equal(paths.controlledUploadReference('library/uploads/a.png'), 'library/uploads/a.png');
  assert.equal(paths.controlledUploadReference('library/images/a.png'), null);
  assert.equal(paths.controlledUploadReference('library/uploads'), null);

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-asset-paths-'));
  const storageRoot = path.join(parent, 'storage');
  const localPath = 'library/uploads/keep.png';
  const absolutePath = path.join(storageRoot, ...localPath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, 'media');
  const outside = path.join(parent, 'outside', 'uploads', 'keep.png');
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, 'keep');
  try {
    const resolved = paths.resolveControlledUploadPath(storageRoot, localPath);
    assert.equal(resolved.normalizedPath, localPath);
    assert.equal(fs.existsSync(resolved.absolutePath), true);
    assert.equal(paths.resolveControlledUploadPath(storageRoot, 'library/uploads/missing.png'), null);
    assert.equal(paths.isWithinRoot(storageRoot, storageRoot), false);
    assert.equal(paths.isWithinRoot(storageRoot, absolutePath), true);
    assert.equal(paths.isWithinRoot(storageRoot, outside), false);
    assert.equal(paths.configuredStorageRoot({ storageRoot }), path.resolve(storageRoot));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
