'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const videoClient = require('../src/services/videoClient');
const helpers = require('../src/services/videoGateway/helpers');
const mediaRefs = require('../src/services/videoGateway/mediaRefs');
const volcengine = require('../src/services/videoGateway/volcengineVideoAdapter');
const kling = require('../src/services/videoGateway/klingVideoAdapter');
const dashscope = require('../src/services/videoGateway/dashscopeVideoAdapter');
const gemini = require('../src/services/videoGateway/geminiVideoAdapter');
const vidu = require('../src/services/videoGateway/viduVideoAdapter');
const veo3 = require('../src/services/videoGateway/veo3VideoAdapter');
const agnes = require('../src/services/videoGateway/agnesVideoAdapter');
const jimeng = require('../src/services/videoGateway/jimengVideoAdapter');
const xai = require('../src/services/videoGateway/xaiVideoAdapter');
const sora = require('../src/services/videoGateway/openAiSoraAdapter');
const aiConfigService = require('../src/services/aiConfigService');

const VIDEO_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '../src/services/videoClient.js'), 'utf8');
const GATEWAY_DIR = path.join(__dirname, '../src/services/videoGateway');
const PUBLIC_API = [
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
const MOVED_FNS = [
  'callVolcengineOmniVideoApi',
  'callKlingOmniVideoApi',
  'callKlingVideoApi',
  'callDashScopeVideoApi',
  'callGeminiVideoApi',
  'callViduVideoApi',
  'callVeo3VideoApi',
  'callAgnesVideoApi',
  'callSoraVideoApi',
  'callJimengAiApiVideo',
  'callXaiVideoApi',
];
const providerDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function createCapturingLogger() {
  const entries = [];
  const logger = { entries };
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (message, meta) => entries.push({ level, message, meta });
  }
  return logger;
}

describe('videoGateway 客户端拆分', () => {
  it('保持 videoClient 公开 API 不变', () => {
    assert.deepEqual(Object.keys(videoClient).sort(), [...PUBLIC_API].sort());
    for (const name of PUBLIC_API) {
      assert.equal(typeof videoClient[name], 'function', name);
    }
    assert.equal(videoClient.normalizeAspectRatioForApi, helpers.normalizeAspectRatioForApi);
    assert.equal(videoClient.pickProxyVideoUrl, helpers.pickProxyVideoUrl);
    assert.equal(videoClient.formatVideoPostBodyForLog, helpers.formatVideoPostBodyForLog);
    assert.equal(videoClient.buildAgnesVideoImagePayload, agnes.buildAgnesVideoImagePayload);
    assert.equal(videoClient.loadReferenceImageBuffer, mediaRefs.loadReferenceImageBuffer);
    assert.equal(videoClient.resolveJimengApiImageBuffer, jimeng.resolveJimengApiImageBuffer);
  });

  it('把厂商创建函数从 videoClient 挪到各自 adapter', () => {
    for (const name of MOVED_FNS) {
      assert.doesNotMatch(VIDEO_CLIENT_SRC, new RegExp(`(?:async )?function ${name}\\s*\\(`));
    }
    assert.match(VIDEO_CLIENT_SRC, /createSoraVideo/);
    assert.match(VIDEO_CLIENT_SRC, /createMinimaxVideo/);
    assert.equal(typeof volcengine.callVolcengineOmniVideoApi, 'function');
    assert.equal(typeof kling.callKlingOmniVideoApi, 'function');
    assert.equal(typeof kling.callKlingVideoApi, 'function');
    assert.equal(typeof dashscope.callDashScopeVideoApi, 'function');
    assert.equal(typeof gemini.callGeminiVideoApi, 'function');
    assert.equal(typeof vidu.callViduVideoApi, 'function');
    assert.equal(typeof veo3.callVeo3VideoApi, 'function');
    assert.equal(typeof agnes.callAgnesVideoApi, 'function');
    assert.equal(typeof jimeng.callJimengAiApiVideo, 'function');
    assert.equal(typeof xai.callXaiVideoApi, 'function');
    assert.equal(typeof sora.createSoraVideo, 'function');
    assert.equal(typeof sora.pollSoraVideo, 'function');
  });

  it('不复制第二套 Sora adapter，创建路径复用 openAiSoraAdapter', () => {
    const files = fs.readdirSync(GATEWAY_DIR).filter((name) => name.endsWith('.js')).sort();
    assert.deepEqual(files, [
      'agnesVideoAdapter.js',
      'dashscopeVideoAdapter.js',
      'geminiVideoAdapter.js',
      'helpers.js',
      'jimengVideoAdapter.js',
      'klingVideoAdapter.js',
      'mediaRefs.js',
      'minimaxVideoAdapter.js',
      'openAiSoraAdapter.js',
      'providerRuntime.js',
      'requestError.js',
      'veo3VideoAdapter.js',
      'viduVideoAdapter.js',
      'volcengineVideoAdapter.js',
      'xaiVideoAdapter.js',
    ]);
    assert.ok(!files.includes('soraVideoAdapter.js'));
    assert.doesNotMatch(VIDEO_CLIENT_SRC, /async function callSoraVideoApi/);
    assert.match(VIDEO_CLIENT_SRC, /require\('\.\/videoGateway\/openAiSoraAdapter'\)/);
  });

  it('本地参考图/音频不支持时返回简体中文错误', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-video-split-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'note.txt'), 'not-an-image');
    fs.writeFileSync(path.join(root, 'voice.flac'), 'not-an-audio');

    await assert.rejects(
      () => videoClient.loadReferenceImageBuffer('note.txt', root),
      (error) => {
        assert.match(String(error.message), /不支持该本地参考图片格式/);
        assert.doesNotMatch(String(error.message), /Local reference image type is not supported/);
        return true;
      }
    );

    await assert.rejects(
      () => volcengine.callVolcengineOmniVideoApi(
        { provider: 'volcengine', base_url: 'https://ark.example/api/v3', api_key: 'k', model: ['doubao-seedance-2-0-260128'], default_model: 'doubao-seedance-2-0-260128' },
        createCapturingLogger(),
        { prompt: 'x', model: 'doubao-seedance-2-0-260128', storage_local_path: root, voice_reference_url: 'voice.flac', video_gen_id: 1 }
      ),
      (error) => {
        assert.equal(error && error.name, 'UnsafeMediaReferenceError');
        assert.match(String(error.message), /不支持该本地参考音频格式/);
        assert.doesNotMatch(String(error.message), /Local reference audio type is not supported/);
        return true;
      }
    );
  });

  it('Kling 创建请求仍走原路径并由拆出的 adapter 发出', async (t) => {
    const config = {
      provider: 'kling',
      api_protocol: 'kling',
      base_url: 'https://api.klingai.example',
      api_key: 'kling-key',
      is_active: 1,
      is_default: 1,
      model: ['kling-video'],
      default_model: 'kling-video',
    };
    t.mock.method(aiConfigService, 'listConfigs', () => [config]);
    const calls = [];
    const result = await videoClient.callVideoApi(null, createCapturingLogger(), {
      prompt: 'split smoke',
      model: 'kling-video',
      duration: 5,
      aspect_ratio: '16:9',
      provider_dns_lookup: providerDnsLookup,
      fetch_impl: async (url, options) => {
        calls.push({ url, method: options.method, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ code: 0, data: { task_id: 'k1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.deepEqual(result, { task_id: 't2v:k1', status: 'submitted' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.klingai.example/v1/videos/text2video');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].body.model, 'kling-video');
    assert.equal(calls[0].body.aspect_ratio, '16:9');
    assert.equal(calls[0].body.duration, '5');
  });
});