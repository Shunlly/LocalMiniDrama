'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const imageClient = require('../src/services/imageClient');
const videoClient = require('../src/services/videoClient');
const sizeAdapters = require('../src/services/imageGateway/sizeAdapters');
const referenceUtils = require('../src/services/imageGateway/referenceUtils');
const proxyCache = require('../src/services/imageGateway/proxyCache');
const helpers = require('../src/services/videoGateway/helpers');
const pollParse = require('../src/services/videoGateway/pollParse');
const mediaRefs = require('../src/services/videoGateway/mediaRefs');
const staticPath = require('../src/services/videoGateway/staticPath');
const videoConfig = require('../src/services/videoGateway/config');
const { assembleImageProtocolRequest } = require('../src/services/imageGateway/requestAssembly');
const { assembleImageApiCall } = require('../src/services/imageGateway/imageApiAssembly');
const { assembleVideoApiCall } = require('../src/services/videoGateway/videoApiAssembly');
const { assembleCompatibleVideoRequest } = require('../src/services/videoGateway/requestAssembly');
const { callJimengAiApiVideo } = require('../src/services/videoGateway/jimengVideoAdapter');
const {
  CONNECTION_TEST_FAILED_MESSAGE,
  CONNECTION_TEST_AUTH_MESSAGE,
} = require('../src/services/aiConfigConnectionProbe');
const { requireCompleteProviderNetworkPolicy } = require('../src/services/providerNetworkPolicy');
const aiConfigService = require('../src/services/aiConfigService');
const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');

const IMAGE_PUBLIC_API = [
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

const VIDEO_PUBLIC_API = [
  'getDefaultVideoConfig',
  'callVideoApi',
  'pollVideoTask',
  'normalizeAspectRatioForApi',
  'isPlausibleHttpVideoUrl',
  'pickProxyVideoUrl',
  'buildAgnesVideoImagePayload',
  'formatVideoPostBodyForLog',
  'resolveVideoProtocol',
  'fetchVideoWithTimeout',
  'createSafeVideoLogger',
  'loadReferenceImageBuffer',
  'resolveJimengApiImageBuffer',
  'validateProviderDispatch',
  'validateProviderRequestUrl',
  'validateVideoMediaReferences',
];

const JIMENG_SYNC_MESSAGE = '即梦视频为同步返回视频地址，不应进入轮询';
const IMAGE_MISSING_CONFIG = '未配置图片模型，请在「AI 配置」中添加图片类型且已启用的配置';
const VIDEO_MISSING_CONFIG = '请先在 AI 配置中添加并启用视频服务';
const NETWORK_POLICY_REQUIRED = '使用凭据前必须提供完整的厂商网络策略。';
const SECRET = 'sk-assembly-secret-123456';

function createCapturingLogger() {
  const entries = [];
  const logger = { entries };
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (message, meta) => entries.push({ level, message, meta });
  }
  return logger;
}

describe('图/视频客户端装配合同', () => {
  it('imageClient / videoClient 导出函数签名不变', () => {
    assert.deepEqual(Object.keys(imageClient).sort(), [...IMAGE_PUBLIC_API].sort());
    assert.deepEqual(Object.keys(videoClient).sort(), [...VIDEO_PUBLIC_API].sort());
    for (const name of IMAGE_PUBLIC_API) {
      assert.equal(typeof imageClient[name], 'function', name);
    }
    for (const name of VIDEO_PUBLIC_API) {
      assert.equal(typeof videoClient[name], 'function', name);
    }
    assert.equal(imageClient.fixAgnesImageSize, sizeAdapters.fixAgnesImageSize);
    assert.equal(imageClient.getStoryboardReferenceLimits, referenceUtils.getStoryboardReferenceLimits);
    assert.equal(imageClient.getProxyCache, proxyCache.getProxyCache);
    assert.equal(videoClient.getDefaultVideoConfig, videoConfig.getDefaultVideoConfig);
    assert.equal(videoClient.pickProxyVideoUrl, helpers.pickProxyVideoUrl);
    assert.equal(helpers.pickProxyVideoUrl, pollParse.pickProxyVideoUrl);
    assert.equal(videoClient.loadReferenceImageBuffer, mediaRefs.loadReferenceImageBuffer);
    assert.equal(mediaRefs.localRefKeyFromRaw, staticPath.localRefKeyFromRaw);
    assert.equal(typeof assembleImageProtocolRequest, 'function');
    assert.equal(typeof assembleImageApiCall, 'function');
    assert.equal(typeof assembleCompatibleVideoRequest, 'function');
  });

  it('未配置图/视频服务时错误文案不变', async (t) => {
    t.mock.method(aiConfigService, 'listConfigs', () => []);
    await assert.rejects(
      () => assembleImageApiCall(null, createCapturingLogger(), { prompt: '夜雨' }),
      (error) => error.message === IMAGE_MISSING_CONFIG && isTrustedChineseUserError(error.message)
    );
    await assert.rejects(
      () => assembleVideoApiCall(null, createCapturingLogger(), { prompt: '夜雨' }),
      (error) => error.message === VIDEO_MISSING_CONFIG && isTrustedChineseUserError(error.message)
    );
  });

  it('Windows 下 /static/ 必须先剥前缀，不能当绝对盘符路径', () => {
    if (process.platform === 'win32') {
      assert.equal(path.win32.isAbsolute('/static/projects/a.png'), true);
    }
    assert.equal(staticPath.relativePathAfterStatic('/static/projects/a.png'), 'projects/a.png');
    assert.equal(staticPath.relativePathAfterStatic('\\static\\projects\\a.png'), 'projects/a.png');
    assert.equal(staticPath.relativePathAfterStatic('http://localhost:3013/static/projects/a.png'), 'projects/a.png');
    assert.equal(staticPath.localRefKeyFromRaw('/static/projects/a.png'), 'projects/a.png');
    assert.equal(staticPath.localRefKeyFromRaw('\\static\\projects\\a.png'), 'projects/a.png');
    assert.equal(mediaRefs.localRefKeyFromRaw('/static/projects/a.png'), 'projects/a.png');
    assert.equal(mediaRefs.localRefKeyFromRaw('\\static\\projects\\a.png'), 'projects/a.png');
  });

  it('即梦同步协议 pollVideoTask 直接返回中文错误，不进轮询', async () => {
    let fetchCalls = 0;
    const result = await videoClient.pollVideoTask(
      null,
      createCapturingLogger(),
      81071,
      'jimeng-sync-81072',
      {
        provider: 'jimeng_ai_api',
        api_protocol: 'jimeng_ai_api',
        base_url: 'https://jimeng.example.com/v1',
        api_key: SECRET,
        provider_dns_lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch_impl: async () => {
          fetchCalls += 1;
          return new Response(JSON.stringify({ status: 'processing' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
      4,
      0
    );
    assert.deepEqual(result, { error: JIMENG_SYNC_MESSAGE });
    assert.equal(isTrustedChineseUserError(JIMENG_SYNC_MESSAGE), true);
    assert.equal(fetchCalls, 0);
  });

  it('即梦缺网络策略返回中文，且日志不含密钥', async () => {
    const log = createCapturingLogger();
    const result = await callJimengAiApiVideo(
      {
        base_url: 'https://jimeng.example.com/v1',
        api_key: SECRET,
        model: ['jimeng-video'],
        default_model: 'jimeng-video',
      },
      log,
      { prompt: '夜雨巷口', model: 'jimeng-video', video_gen_id: 9 }
    );
    assert.equal(typeof result.error, 'string');
    assert.match(result.error, /使用凭据前必须提供完整的厂商网络策略/);
    assert.equal(isTrustedChineseUserError(result.error), true);
    assert.doesNotMatch(result.error, new RegExp(SECRET));
    const serialized = JSON.stringify(log.entries);
    assert.doesNotMatch(serialized, new RegExp(SECRET));
    assert.throws(
      () => requireCompleteProviderNetworkPolicy(null, 'https://jimeng.example.com/v1'),
      (error) => error.code === 'PROVIDER_NETWORK_POLICY_REQUIRED'
        && error.message === NETWORK_POLICY_REQUIRED
    );
  });

  it('连接测试失败文案保持中文且不含密钥', () => {
    assert.equal(CONNECTION_TEST_FAILED_MESSAGE, '连接测试失败，请检查接口地址和密钥');
    assert.equal(CONNECTION_TEST_AUTH_MESSAGE, '认证失败，请检查密钥');
    assert.equal(isTrustedChineseUserError(CONNECTION_TEST_FAILED_MESSAGE), true);
    assert.equal(isTrustedChineseUserError(CONNECTION_TEST_AUTH_MESSAGE), true);
    assert.doesNotMatch(CONNECTION_TEST_FAILED_MESSAGE, /secret|api[_-]?key|Bearer/i);
  });

  it('视频 POST 日志装配会去掉密钥和提示词原文', () => {
    const formatted = videoClient.formatVideoPostBodyForLog({
      model: 'demo',
      extra_body: { api_key: SECRET, Authorization: `Bearer ${SECRET}` },
      content: [{ type: 'text', text: '完整私密提示词不得进日志' }],
    });
    const serialized = JSON.stringify(formatted);
    assert.doesNotMatch(serialized, new RegExp(SECRET));
    assert.doesNotMatch(serialized, /完整私密提示词不得进日志/);
    assert.match(serialized, /REDACTED/);
  });
});
