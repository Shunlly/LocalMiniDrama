const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const imageClient = require('../src/services/imageClient');
const sizeAdapters = require('../src/services/imageGateway/sizeAdapters');
const referenceUtils = require('../src/services/imageGateway/referenceUtils');
const proxyCache = require('../src/services/imageGateway/proxyCache');
const { callKlingImageApi } = require('../src/services/imageGateway/klingImageAdapter');
const { callNanoBananaImageApi } = require('../src/services/imageGateway/nanoBananaImageAdapter');
const { callDashScopeImageApi, parseDashScopeImageUrl } = require('../src/services/imageGateway/dashScopeImageAdapter');
const { callGeminiImageApi } = require('../src/services/imageGateway/geminiImageAdapter');

const PUBLIC_API = [
  'getDefaultImageConfig',
  'callImageApi',
  'createAndGenerateImage',
  'downloadImageToLocalAbortable',
  'removeDownloadedImage',
  'resolveAssetUserNegativeForApi',
  'getStoryboardReferenceLimits',
  'canAddStoryboardCharacterRef',
  'canAddStoryboardObjectRef',
  'refListHasCanonical',
  'fixAgnesImageSize',
  'isAgnesImageConfig',
  'getProxyCache',
  'getProxyCacheValidated',
  'deleteProxyCache',
  'isProxyUrlAlive',
  'setProxyCache',
];

describe('imageGateway 客户端拆分', () => {
  it('imageClient 公开 API 不变', () => {
    assert.deepEqual(Object.keys(imageClient).sort(), [...PUBLIC_API].sort());
  });

  it('size / 参考图 / 图床缓存由 imageClient 原样再导出', () => {
    assert.equal(imageClient.fixAgnesImageSize, sizeAdapters.fixAgnesImageSize);
    assert.equal(imageClient.isAgnesImageConfig, sizeAdapters.isAgnesImageConfig);
    assert.equal(imageClient.getStoryboardReferenceLimits, referenceUtils.getStoryboardReferenceLimits);
    assert.equal(imageClient.canAddStoryboardCharacterRef, referenceUtils.canAddStoryboardCharacterRef);
    assert.equal(imageClient.canAddStoryboardObjectRef, referenceUtils.canAddStoryboardObjectRef);
    assert.equal(imageClient.refListHasCanonical, referenceUtils.refListHasCanonical);
    assert.equal(imageClient.getProxyCache, proxyCache.getProxyCache);
    assert.equal(imageClient.getProxyCacheValidated, proxyCache.getProxyCacheValidated);
    assert.equal(imageClient.deleteProxyCache, proxyCache.deleteProxyCache);
    assert.equal(imageClient.isProxyUrlAlive, proxyCache.isProxyUrlAlive);
    assert.equal(imageClient.setProxyCache, proxyCache.setProxyCache);
  });

  it('厂商适配器已拆到独立模块', () => {
    assert.equal(typeof callKlingImageApi, 'function');
    assert.equal(typeof callNanoBananaImageApi, 'function');
    assert.equal(typeof callDashScopeImageApi, 'function');
    assert.equal(typeof callGeminiImageApi, 'function');
    const src = fs.readFileSync(path.join(__dirname, '../src/services/imageClient.js'), 'utf8');
    for (const name of [
      'function callKlingImageApi',
      'function callNanoBananaImageApi',
      'function callDashScopeImageApi',
      'function callGeminiImageApi',
      'function fixSeedreamSize',
      'function dashScopeSize',
      'function geminiAspectRatio',
      'function getProxyCache',
      'function resolveImageRef',
    ]) {
      assert.equal(src.includes(name), false, name);
    }
    assert.equal(src.includes("require('./imageGateway/klingImageAdapter')"), true);
    assert.equal(src.includes("require('./imageGateway/nanoBananaImageAdapter')"), true);
    assert.equal(src.includes("require('./imageGateway/dashScopeImageAdapter')"), true);
    assert.equal(src.includes("require('./imageGateway/geminiImageAdapter')"), true);
  });
});

describe('imageGateway sizeAdapters 本地映射', () => {
  it('fixSeedreamSize 把低像素放大到最低 1920x1920', () => {
    assert.equal(sizeAdapters.fixSeedreamSize('1024x1024'), '1920x1920');
    assert.equal(sizeAdapters.fixSeedreamSize('1920x1920'), '1920x1920');
    assert.equal(sizeAdapters.fixSeedreamSize(null), '1920x1920');
  });

  it('dashScopeSize 使用星号分隔且保留合法像素区间', () => {
    assert.equal(sizeAdapters.dashScopeSize('1024x1024'), '1024*1024');
    assert.equal(sizeAdapters.dashScopeSize(null), '1280*1280');
  });

  it('gemini / nanoBanana / kling 宽高比映射保持原语义', () => {
    assert.equal(sizeAdapters.geminiAspectRatio('1440x2560'), '9:16');
    assert.equal(sizeAdapters.geminiAspectRatio('16:9'), '16:9');
    assert.equal(sizeAdapters.nanoBananaAspectRatio(null), 'auto');
    assert.equal(sizeAdapters.nanoBananaAspectRatio('1024x1024'), '1:1');
    assert.equal(sizeAdapters.klingImageAspectRatio(null), '16:9');
    assert.equal(sizeAdapters.klingImageAspectRatio('1440x2560'), '9:16');
  });

  it('Agnes 尺寸映射与配置识别不变', () => {
    assert.equal(imageClient.fixAgnesImageSize('1440x2560'), '1024x1792');
    assert.equal(imageClient.isAgnesImageConfig({
      provider: 'agnes',
      base_url: 'https://apihub.agnes-ai.com/v1',
      api_protocol: 'openai',
    }, 'agnes-image-2.1-flash'), true);
  });

  it('qwen-image 只映射到官方允许的 size', () => {
    assert.equal(sizeAdapters.qwenImageSize('1440x2560'), '928*1664');
    assert.equal(sizeAdapters.isQwenImageProvider({ provider: 'qwen_image' }, 'other'), true);
  });

  it('Gemini 3.x 才带 imageSize，2.5 不传', () => {
    const flash = sizeAdapters.buildGeminiImageConfig('9:16', 'gemini-2.5-flash-image', '1440x2560');
    assert.deepEqual(flash, { aspectRatio: '9:16' });
    const pro = sizeAdapters.buildGeminiImageConfig('9:16', 'gemini-3-pro-image-preview', '1440x2560');
    assert.deepEqual(pro, { aspectRatio: '9:16', imageSize: '2K' });
  });
});

describe('imageGateway referenceUtils', () => {
  it('resolveImageRef 只接受预校验后的 data URL', () => {
    assert.equal(referenceUtils.resolveImageRef('https://example.com/a.png'), null);
    assert.equal(referenceUtils.resolveImageRef('roles/a.png'), null);
    assert.equal(
      referenceUtils.resolveImageRef('data:image/png;base64,abc='),
      'data:image/png;base64,abc='
    );
  });

  it('canonicalRefKey 忽略 URL query，供去重使用', () => {
    const a = 'https://cdn.example/a.png?t=1';
    const b = 'https://cdn.example/a.png?t=2';
    assert.equal(referenceUtils.canonicalRefKey(a), referenceUtils.canonicalRefKey(b));
    assert.equal(imageClient.refListHasCanonical([a], b), true);
    assert.equal(imageClient.refListHasCanonical([a], 'https://cdn.example/b.png'), false);
  });

  it('分镜参考图上限：可灵 1 张，其余 4 张', () => {
    assert.deepEqual(imageClient.getStoryboardReferenceLimits({ provider: 'kling' }), {
      total: 1,
      maxCharacters: 1,
      maxObjects: 1,
    });
    assert.deepEqual(imageClient.getStoryboardReferenceLimits({ api_protocol: 'kling', provider: 'openai' }), {
      total: 1,
      maxCharacters: 1,
      maxObjects: 1,
    });
    assert.deepEqual(imageClient.getStoryboardReferenceLimits({ provider: 'gemini' }), {
      total: 4,
      maxCharacters: 3,
      maxObjects: 4,
    });
    const limits = { total: 4, maxCharacters: 3, maxObjects: 4 };
    assert.equal(imageClient.canAddStoryboardCharacterRef(['character appearance A', 'character appearance B'], limits), true);
    assert.equal(imageClient.canAddStoryboardCharacterRef([
      'character appearance A',
      'character appearance B',
      'character appearance C',
    ], limits), false);
  });
});

describe('imageGateway 厂商适配器请求拼装语义', () => {
  it('DashScope 在非 dashscope base_url 时直接返回原错误文案', async () => {
    const result = await callDashScopeImageApi(
      { base_url: 'https://example.com', api_key: 'x' },
      { info() {}, warn() {}, error() {} },
      { prompt: 'test' }
    );
    assert.equal(result.error, '通义万象 base_url 需为 https://dashscope.aliyuncs.com');
  });

  it('parseDashScopeImageUrl 仍从 output.choices 取第一张图', () => {
    assert.equal(parseDashScopeImageUrl({
      output: { choices: [{ message: { content: [{ type: 'image', image: 'https://img.example/a.png' }] } }] },
    }), 'https://img.example/a.png');
    assert.equal(parseDashScopeImageUrl({ output: {} }), null);
  });
});
