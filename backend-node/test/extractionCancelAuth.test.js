const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requestBounded } = require('../src/services/sourceMediaExtractionService');
const { ocrImageWithFallback } = require('../src/services/sourceMediaExtractionOcr');
const { transcribeAudio } = require('../src/services/sourceMediaExtractionTranscribe');
const { isExtractionCancelled, isExtractionTimeout } = require('../src/services/sourceMediaExtractionErrors');
const audioRoutes = require('../src/routes/audio');
const ttsService = require('../src/services/ttsService');
const LEAK = /HTTP\s*404|Invalid Authorization|Not Found|AUTH_DENIED|ListAssetGroups/i;

function hangingFetch() {
  return (url, init) => new Promise((_, reject) => {
    const fail = () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    if (init?.signal?.aborted) {
      fail();
      return;
    }
    init?.signal?.addEventListener('abort', fail, { once: true });
  });
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    writableEnded: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); return this; },
  };
}

function capturingLog() {
  const events = [];
  return {
    events,
    error(message, metadata) { events.push({ level: 'error', message, metadata }); },
    warn(message, metadata) { events.push({ level: 'warn', message, metadata }); },
    operation(event) { events.push({ level: 'operation', event }); },
  };
}

describe('OCR / 转写取消不得收成超时，认证失败不泄漏 HTTP 原文', () => {
  it('父级 abort 是取消，不是超时', async () => {
    const controller = new AbortController();
    const pending = requestBounded('http://127.0.0.1:9/ocr', { method: 'POST' }, {
      timeoutMs: 5000,
      label: '图片识别',
      signal: controller.signal,
      fetchImpl: hangingFetch(),
    });
    controller.abort(Object.assign(new Error('用户取消抽取'), { name: 'AbortError', code: 'ERR_CANCELED' }));
    await assert.rejects(pending, (error) => {
      assert.equal(isExtractionCancelled(error), true);
      assert.equal(isExtractionTimeout(error), false);
      assert.match(error.message, /取消/);
      assert.doesNotMatch(error.message, /超时|成功|HTTP\s*404|aborted/i);
      assert.equal(error.code, 'OPERATION_CANCELLED');
      return true;
    });
  });

  it('内部超时仍是超时，不得记成取消', async () => {
    await assert.rejects(
      requestBounded('http://127.0.0.1:9/ocr', { method: 'POST' }, {
        timeoutMs: 20,
        label: '图片识别',
        fetchImpl: hangingFetch(),
      }),
      (error) => {
        assert.equal(isExtractionTimeout(error), true);
        assert.equal(isExtractionCancelled(error), false);
        assert.match(error.message, /超时/);
        assert.doesNotMatch(error.message, /取消/);
        return true;
      }
    );
  });

  it('HTTP 404 Invalid Authorization 走认证失败，不回传状态或英文错误码', async () => {
    await assert.rejects(
      requestBounded('http://127.0.0.1:9/ocr', { method: 'POST' }, {
        timeoutMs: 1000,
        label: '图片识别',
        fetchImpl: async () => ({
          ok: false,
          status: 404,
          headers: { get: () => 'application/json' },
          body: {
            getReader() {
              const chunk = Buffer.from(JSON.stringify({ error: 'Invalid Authorization', code: 'AUTH_DENIED' }));
              let done = false;
              return {
                read: async () => {
                  if (done) return { done: true, value: undefined };
                  done = true;
                  return { done: false, value: chunk };
                },
                cancel: async () => {},
                releaseLock() {},
              };
            },
            cancel: async () => {},
          },
        }),
      }),
      (error) => {
        assert.match(error.message, /图片识别认证失败/);
        assert.doesNotMatch(error.message, LEAK);
        assert.doesNotMatch(error.message, /无法处理的响应/);
        return true;
      }
    );
  });

  it('OCR 取消后不回退 Tesseract，也不记成超时', async () => {
    let tesseractCalled = false;
    const controller = new AbortController();
    controller.abort(Object.assign(new Error('用户取消抽取'), { name: 'AbortError', code: 'ERR_CANCELED' }));
    const db = {
      prepare() {
        return {
          get() {
            return {
              id: 1,
              service_type: 'ocr',
              base_url: 'http://127.0.0.1:9/v1',
              api_key: 'unit-test-token-not-a-real-key',
              model: JSON.stringify(['ocr-test']),
              settings: JSON.stringify({ timeout_ms: 5000 }),
              is_active: 1,
              is_default: 1,
            };
          },
        };
      },
    };
    await assert.rejects(
      ocrImageWithFallback(db, { buffer: Buffer.from('x'), mime: 'image/png' }, {
        signal: controller.signal,
        fetchImpl: hangingFetch(),
        runProcess: async () => {
          tesseractCalled = true;
          throw new Error('tesseract should not run');
        },
      }),
      (error) => {
        assert.equal(isExtractionCancelled(error), true);
        assert.match(error.message, /取消/);
        assert.doesNotMatch(error.message, /超时|成功/);
        return true;
      }
    );
    assert.equal(tesseractCalled, false);
  });

  it('OCR 认证失败不回退 Tesseract，也不泄漏 HTTP 原文', async () => {
    let tesseractCalled = false;
    const db = {
      prepare() {
        return {
          get() {
            return {
              id: 1,
              service_type: 'ocr',
              base_url: 'http://127.0.0.1:9/v1',
              api_key: 'unit-test-token-not-a-real-key',
              model: JSON.stringify(['ocr-test']),
              settings: JSON.stringify({ timeout_ms: 5000 }),
              is_active: 1,
              is_default: 1,
            };
          },
        };
      },
    };
    await assert.rejects(
      ocrImageWithFallback(db, { buffer: Buffer.from('x'), mime: 'image/png' }, {
        fetchImpl: async () => ({
          ok: false,
          status: 404,
          headers: { get: () => 'application/json' },
          body: {
            getReader() {
              const chunk = Buffer.from(JSON.stringify({ error: 'Invalid Authorization', code: 'AUTH_DENIED' }));
              let done = false;
              return {
                read: async () => {
                  if (done) return { done: true, value: undefined };
                  done = true;
                  return { done: false, value: chunk };
                },
                cancel: async () => {},
                releaseLock() {},
              };
            },
            cancel: async () => {},
          },
        }),
        runProcess: async () => {
          tesseractCalled = true;
          throw new Error('tesseract should not run');
        },
      }),
      (error) => {
        assert.match(error.message, /认证失败/);
        assert.doesNotMatch(error.message, LEAK);
        return true;
      }
    );
    assert.equal(tesseractCalled, false);
  });

  it('转写取消不得收成超时或成功', async () => {
    const controller = new AbortController();
    const db = {
      prepare() {
        return {
          get() {
            return {
              id: 2,
              service_type: 'transcription',
              base_url: 'http://127.0.0.1:9/v1',
              api_key: 'unit-test-token-not-a-real-key',
              model: JSON.stringify(['transcription-test-model']),
              settings: JSON.stringify({ timeout_ms: 5000 }),
              is_active: 1,
              is_default: 1,
            };
          },
        };
      },
    };
    const pending = transcribeAudio(db, {
      buffer: Buffer.from('RIFF'),
      mime: 'audio/wav',
      filename: 'clip.wav',
    }, {
      signal: controller.signal,
      fetchImpl: hangingFetch(),
    });
    controller.abort(Object.assign(new Error('用户取消转写'), { name: 'AbortError', code: 'ERR_CANCELED' }));
    await assert.rejects(pending, (error) => {
      assert.equal(isExtractionCancelled(error), true);
      assert.match(error.message, /取消/);
      assert.doesNotMatch(error.message, /超时|成功|HTTP\s*404/i);
      return true;
    });
  });

  it('TTS 路由取消返回中文取消，日志 phase 为 cancel，且不记成功', async () => {
    const original = ttsService.synthesize;
    ttsService.synthesize = async (_db, _log, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      const error = Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
        code: 'OPERATION_CANCELLED',
      });
      throw error;
    };
    const log = capturingLog();
    const db = {
      prepare() {
        return { get() { return { dialogue: '你好' }; }, run() { throw new Error('cancel must not persist'); } };
      },
    };
    try {
      const res = mockRes();
      await audioRoutes(db, log, { storage: { local_path: './data/storage' } }).extract(
        { body: { storyboard_id: 9, text: '你好' } },
        res,
      );
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error.message, /取消/);
      assert.doesNotMatch(res.body.error.message, /超时|成功|aborted/i);
      const op = log.events.find((item) => item.level === 'operation');
      assert.ok(op);
      assert.equal(op.event.phase, 'cancel');
      assert.notEqual(op.event.phase, 'success');
      assert.notEqual(op.event.phase, 'error');
    } finally {
      ttsService.synthesize = original;
    }
  });
});
