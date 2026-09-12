const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const audioRoutes = require('../src/routes/audio');
const ttsService = require('../src/services/ttsService');

function hasCjk(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

function mockDb(row) {
  return {
    prepare() {
      return {
        get() { return row; },
        run() { return { changes: 1 }; },
      };
    },
  };
}

describe('音频路由对用户返回中文错误', () => {
  const originalSynthesize = ttsService.synthesize;
  afterEach(() => {
    ttsService.synthesize = originalSynthesize;
  });

  it('extract 把英文厂商错误映射为中文，不回传密钥和 HTTP 原文', async () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    ttsService.synthesize = async () => {
      const error = new Error('Unauthorized: Invalid API key sk-provider-secret-123456');
      error.status = 401;
      throw error;
    };
    const res = mockRes();
    const routes = audioRoutes(mockDb({ dialogue: '你好' }), { error() {} }, { storage: { local_path: './data/storage' } });
    await routes.extract({ body: { storyboard_id: 9, text: '你好' } }, res);
    process.env.NODE_ENV = previousEnv;
    assert.equal(res.statusCode, 401);
    assert.equal(hasCjk(res.body.error.message), true);
    assert.doesNotMatch(res.body.error.message, /Unauthorized|Invalid API key|sk-provider-secret|HTTP\s*401/i);
  });

  it('extractBatch 单项失败也只回中文', async () => {
    ttsService.synthesize = async () => {
      const error = new Error('OpenAI TTS request failed');
      error.status = 500;
      throw error;
    };
    const res = mockRes();
    const routes = audioRoutes(mockDb({ id: 9, dialogue: '对白' }), { error() {} }, { storage: { local_path: './data/storage' } });
    await routes.extractBatch({ body: { storyboard_ids: [9] } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    const item = res.body.data[0];
    assert.equal(hasCjk(item.error), true);
    assert.doesNotMatch(item.error, /OpenAI TTS|request failed/i);
  });
});
