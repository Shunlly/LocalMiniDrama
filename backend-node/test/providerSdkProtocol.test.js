const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const configModule = require('../src/config');
const {
  isProductionMode,
  isMockValue,
  isMockProvider,
  resolveLocalMediaPath,
  localMediaExists,
  firstLocalAsset,
} = require('../src/services/providerSdkProtocol');

describe('providerSdkProtocol 生产协议探测', () => {
  it('生产模式只认 mode 或 qa_mode 为 production', () => {
    assert.equal(isProductionMode({ mode: 'production' }), true);
    assert.equal(isProductionMode({ qa_mode: 'production' }), true);
    assert.equal(isProductionMode({ mode: 'draft', qa_mode: 'production' }), true);
    assert.equal(isProductionMode({ mode: 'draft' }), false);
    assert.equal(isProductionMode({}), false);
    assert.equal(isProductionMode(null), false);
  });

  it('占位协议与 mock 供应商不会被当成真实落盘', () => {
    assert.equal(isMockValue('mock://dramas/1/a.png'), true);
    assert.equal(isMockValue('placeholder://char'), true);
    assert.equal(isMockValue('  MOCK://x '), true);
    assert.equal(isMockValue('projects/a.png'), false);
    assert.equal(isMockValue(''), false);
    assert.equal(isMockProvider(''), true);
    assert.equal(isMockProvider('mock'), true);
    assert.equal(isMockProvider('mock-compositor'), true);
    assert.equal(isMockProvider('mock-tts'), true);
    assert.equal(isMockProvider('ffmpeg'), false);
    assert.equal(isMockProvider('openai'), false);
  });

  it('绝对路径只承认普通文件，目录和缺失路径都算未落盘', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-provider-sdk-protocol-'));
    const filePath = path.join(root, 'clip.mp4');
    const dirPath = path.join(root, 'nested');
    fs.writeFileSync(filePath, 'ok');
    fs.mkdirSync(dirPath);
    try {
      assert.equal(resolveLocalMediaPath(filePath), filePath);
      assert.equal(localMediaExists(filePath), true);
      assert.equal(localMediaExists(dirPath), false);
      assert.equal(localMediaExists(path.join(root, 'missing.mp4')), false);
      assert.equal(localMediaExists('mock://clip.mp4'), false);
      assert.equal(resolveLocalMediaPath(''), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('相对路径不会逃出存储根，也不会把目录当媒体', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-provider-sdk-storage-'));
    const storage = path.join(root, 'storage');
    const outside = path.join(root, 'secret.bin');
    fs.mkdirSync(path.join(storage, 'videos'), { recursive: true });
    fs.writeFileSync(path.join(storage, 'videos', 'a.mp4'), 'media');
    fs.writeFileSync(outside, 'secret');
    const originalLoadConfig = configModule.loadConfig;
    configModule.loadConfig = () => ({ app: { name: 'test' }, storage: { local_path: storage } });
    try {
      assert.equal(localMediaExists('videos/a.mp4'), true);
      assert.equal(localMediaExists('/static/videos/a.mp4'), true);
      assert.equal(resolveLocalMediaPath('/static/videos/a.mp4'), path.join(storage, 'videos', 'a.mp4'));
      assert.notEqual(resolveLocalMediaPath('/static/videos/a.mp4'), '/static/videos/a.mp4');
      assert.equal(resolveLocalMediaPath('../secret.bin'), null);
      assert.equal(localMediaExists('../secret.bin'), false);
      assert.equal(localMediaExists(path.join('videos', '..', '..', 'secret.bin')), false);
    } finally {
      configModule.loadConfig = originalLoadConfig;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });


  it('Windows 盘符绝对路径仍按文件系统路径处理', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-provider-sdk-abs-'));
    const filePath = path.join(root, 'clip.mp4');
    fs.writeFileSync(filePath, 'ok');
    try {
      assert.equal(resolveLocalMediaPath(filePath), filePath);
      assert.equal(localMediaExists(filePath), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it('首个真实本地素材不会被 mock 或缺文件字段抢走', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-provider-sdk-asset-'));
    const realPath = path.join(root, 'real.png');
    fs.writeFileSync(realPath, 'img');
    try {
      const row = {
        image_url: 'mock://missing.png',
        ref_image: path.join(root, 'missing.png'),
        local_path: realPath,
      };
      assert.equal(firstLocalAsset(row, ['image_url', 'ref_image', 'local_path']), realPath);
      assert.equal(firstLocalAsset(row, ['image_url', 'ref_image']), null);
      assert.equal(firstLocalAsset(null, ['local_path']), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});