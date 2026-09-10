const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backgroundExtractionService = require('../src/services/backgroundExtractionService');
const propExtractionService = require('../src/services/propExtractionService');
const { copyStoredAudioToTemp } = require('../src/services/mergedEpisodePostProcess');
const providerSdkService = require('../src/services/providerSdkService');
const timelineService = require('../src/services/timelineService');

const silentLog = { info() {}, warn() {}, error() {} };

function mockDb(row) {
  return {
    prepare() {
      return {
        get() { return row; },
        all() { return []; },
        run() { return { changes: 0, lastInsertRowid: 0 }; },
      };
    },
  };
}

function track(id, type, items, extra = {}) {
  return {
    id,
    type,
    name: type,
    sort_order: id,
    status: extra.status || 'pending',
    metadata: extra.metadata || {},
    items,
  };
}

function item(id, storyboardId, startSec, endSec, sourcePath) {
  return {
    id,
    storyboard_id: storyboardId,
    start_sec: startSec,
    end_sec: endSec,
    source_path: sourcePath,
    storyboard: storyboardId ? { id: storyboardId } : null,
    metadata: {},
  };
}

function validTimeline() {
  return {
    tracks: [
      track(1, 'video', [item(11, 101, 0, 5, 'videos/a.mp4')]),
      track(2, 'subtitle', [item(12, 101, 0, 5, '旁白字幕')]),
      track(3, 'voice', [item(13, 101, 0, 5, 'audio/a.mp3')]),
      track(4, 'dialogue', []),
      track(5, 'effect', [], { status: 'unused', metadata: { optional: true, usage: 'unused' } }),
      track(6, 'bgm', [], { status: 'unused', metadata: { optional: true, usage: 'unused' } }),
      track(7, 'transition', [], { status: 'unused', metadata: { optional: true, usage: 'unused' } }),
    ],
  };
}

test('userFacingGeneration messages 抽取/生成/合成错误为可操作简体中文', async (t) => {
  assert.throws(
    () => backgroundExtractionService.extractBackgroundsForEpisode(mockDb(undefined), {}, silentLog, 1),
    (error) => error.message === '剧集不存在，无法提取场景'
  );
  assert.throws(
    () => backgroundExtractionService.extractBackgroundsForEpisode(
      mockDb({ id: 1, drama_id: 1, script_content: '   ' }),
      {},
      silentLog,
      1
    ),
    (error) => error.message === '剧集剧本内容为空，无法提取场景'
  );

  assert.throws(
    () => propExtractionService.extractPropsForEpisode(mockDb(undefined), silentLog, 1, {}),
    (error) => error.message === '剧集不存在，无法提取道具'
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-user-facing-audio-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = path.join(root, 'storage');
  fs.mkdirSync(path.join(storage, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(storage, 'audio', 'empty.mp3'), Buffer.alloc(0));
  assert.throws(
    () => copyStoredAudioToTemp(storage, 'audio/empty.mp3', path.join(root, 'copied.mp3')),
    (error) => error.message === '本地音频文件为空或超过大小限制，请重新生成配音后再合成'
  );

  await assert.rejects(
    () => providerSdkService.generateAssetBibleImagesProduction(mockDb(undefined), silentLog, { drama_id: 1 }),
    (error) => error.message === '素材图 Provider 不可用，请在「AI 配置」中启用图片模型'
  );

  assert.throws(
    () => providerSdkService.assertProductionReadiness(mockDb(undefined), { drama_id: 1 }),
    (error) => /生产工作流尚未就绪，缺少：/.test(error.message) && /分镜/.test(error.message) && /素材图 Provider/.test(error.message)
  );

  const originalGetEpisodeTimeline = timelineService.getEpisodeTimeline;
  t.after(() => {
    timelineService.getEpisodeTimeline = originalGetEpisodeTimeline;
  });

  timelineService.getEpisodeTimeline = () => null;
  assert.throws(
    () => providerSdkService.buildProductionTimelineCompositePlan(mockDb(undefined), 9),
    (error) => error.code === 'PRODUCTION_TIMELINE_INVALID' && error.message === '第 9 集还没有时间线，请先生成时间线后再合成'
  );

  const noSubtitle = validTimeline();
  noSubtitle.tracks.find((entry) => entry.type === 'subtitle').items = [];
  timelineService.getEpisodeTimeline = () => noSubtitle;
  assert.throws(
    () => providerSdkService.buildProductionTimelineCompositePlan(mockDb(undefined), 9),
    (error) => error.code === 'PRODUCTION_TIMELINE_INVALID' && /字幕时间线不完整/.test(error.message)
  );

  const noVoice = validTimeline();
  noVoice.tracks.find((entry) => entry.type === 'voice').items = [];
  timelineService.getEpisodeTimeline = () => noVoice;
  assert.throws(
    () => providerSdkService.buildProductionTimelineCompositePlan(mockDb(undefined), 9),
    (error) => error.code === 'PRODUCTION_TIMELINE_INVALID' && /需要旁白或对白/.test(error.message)
  );
});

test('userFacingGeneration source 不再包含已列出的英文用户错误', () => {
  const files = [
    'backgroundExtractionService.js',
    'propExtractionService.js',
    'mergedEpisodePostProcess.js',
    'narrationVideoPostProcess.js',
    'providerSdkService.js',
  ];
  const forbidden = [
    'episode not found',
    'episode has no script content',
    'Stored audio file is empty or exceeds the size limit.',
    'Production asset image provider is unavailable',
    'No durable storyboard image is available',
    'TTS output was not persisted locally',
    'Episode is missing one or more durable video clips',
    'Compositor task result was not persisted',
    'Production workflow is not ready',
    'Production asset image generation failed',
    'Production image generation failed',
    'Production video generation failed',
    'Production TTS generation failed',
    'Production episode composite failed for episode',
    'Strict video merge did not complete',
    'timeline was not found',
    'subtitle timeline is incomplete',
    'requires voice or dialogue',
    'Compositor merge did not acquire',
    'Compositor merge no longer owns',
    'e.message || String(e)',
  ];
  for (const name of files) {
    const source = fs.readFileSync(path.join(__dirname, '../src/services', name), 'utf8');
    for (const phrase of forbidden) {
      assert.equal(source.includes(phrase), false, `${name} 仍包含：${phrase}`);
    }
  }
});

test('providerNetworkPolicy 与 serviceFailure 用户错误为简体中文', () => {
  const { requireCompleteProviderNetworkPolicy } = require('../src/services/providerNetworkPolicy');
  const { sendMappedServiceFailure } = require('../src/routes/serviceFailure');

  assert.throws(
    () => requireCompleteProviderNetworkPolicy(null),
    (error) => error.code === 'PROVIDER_NETWORK_POLICY_REQUIRED'
      && /[\u4e00-\u9fff]/.test(error.message)
      && !/complete provider network policy/i.test(error.message)
  );
  assert.throws(
    () => requireCompleteProviderNetworkPolicy({
      requireHttpsForPublic: true,
      trustedOrigins: ['https://ok.example'],
      allowPrivateOrigins: 'nope',
    }),
    (error) => error.code === 'PROVIDER_NETWORK_POLICY_INVALID'
      && /[\u4e00-\u9fff]/.test(error.message)
      && !/The provider network policy/i.test(error.message)
  );
  assert.throws(
    () => requireCompleteProviderNetworkPolicy({
      requireHttpsForPublic: true,
      trustedOrigins: ['https://ok.example'],
      allowPrivateOrigins: [],
    }, 'https://other.example/v1'),
    (error) => error.code === 'PROVIDER_NETWORK_AUTHORITY_MISMATCH'
      && /[\u4e00-\u9fff]/.test(error.message)
      && !/not authorized/i.test(error.message)
  );

  const policySource = fs.readFileSync(path.join(__dirname, '../src/services/providerNetworkPolicy.js'), 'utf8');
  for (const phrase of [
    'A complete provider network policy is required',
    'The provider network policy is incomplete or invalid.',
    'The provider endpoint is not authorized',
    'Private provider origins must also be trusted provider origins.',
  ]) {
    assert.equal(policySource.includes(phrase), false, phrase);
  }

  function mockRes() {
    return {
      statusCode: 0,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      setHeader() { return this; },
      getHeader() {},
    };
  }
  const missing = mockRes();
  assert.equal(sendMappedServiceFailure(missing, { ok: false, error: 'character not found' }), true);
  assert.equal(missing.statusCode, 404);
  assert.match(missing.body.error.message, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(missing.body.error.message, /character not found/i);

  const aborted = mockRes();
  assert.equal(sendMappedServiceFailure(aborted, { ok: false, error: 'The operation was aborted.' }), true);
  assert.equal(aborted.statusCode, 400);
  assert.match(aborted.body.error.message, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(aborted.body.error.message, /aborted/i);

  const english = mockRes();
  assert.equal(sendMappedServiceFailure(english, { ok: false, error: 'ENOENT: no such file or directory' }), true);
  assert.equal(english.statusCode, 400);
  assert.match(english.body.error.message, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(english.body.error.message, /ENOENT|no such file/i);
});

test('角色/场景/道具路由与 AI 客户端不再把英文超时或密钥回给前端', async (t) => {
  const Database = require('better-sqlite3');
  const { runMigrationsAndEnsure } = require('../src/db/migrate');
  const aiClient = require('../src/services/aiClient');
  const characterGenerationService = require('../src/services/characterGenerationService');
  const dramaService = require('../src/services/dramaService');
  const { getLegacyAsyncSchedulerState } = require('../src/services/legacyAsyncSchedulerService');
  const taskService = require('../src/services/taskService');
  const sceneRoutes = require('../src/routes/scenes');
  const characterRoutes = require('../src/routes/characters');
  const propRoutes = require('../src/routes/prop');
  const propService = require('../src/services/propService');
  const {
    createProviderHttpError,
    toSafeProviderErrorMessage,
    toUserFacingProcessError,
  } = require('../src/services/providerErrorSanitizer');

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

  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => {
    process.env.NODE_ENV = previousEnv;
  });

  const timeout = Object.assign(new Error('Vision request timeout after 120000ms'), { name: 'TimeoutError' });
  assert.equal(toUserFacingProcessError(timeout, '处理失败'), '请求超时，请稍后重试');
  assert.match(toSafeProviderErrorMessage(timeout, { provider: 'AI 服务', operation: '视觉请求' }), /超时/);
  assert.doesNotMatch(toSafeProviderErrorMessage(timeout, { provider: 'AI 服务', operation: '视觉请求' }), /timeout after/i);

  const secret = new Error('Invalid API key sk-test-not-a-real-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(toUserFacingProcessError(secret, '操作失败，请稍后重试'), '操作失败，请稍后重试');
  assert.doesNotMatch(toUserFacingProcessError(secret, '操作失败，请稍后重试'), /sk-/);

  const provider = createProviderHttpError({
    provider: 'AI 服务',
    operation: '视觉请求',
    status: 401,
    responseBody: JSON.stringify({ error: 'Bearer sk-provider-secret' }),
  });
  const providerMessage = toUserFacingProcessError(provider, '操作失败，请稍后重试');
  assert.match(providerMessage, /认证失败|失败/);
  assert.doesNotMatch(providerMessage, /sk-provider-secret|Bearer /i);

  const sceneService = require('../src/services/sceneService');
  const characterLibraryService = require('../src/services/characterLibraryService');
  const originalListScenes = sceneService.listByDramaId;
  const originalGenerateCharacterPrompt = characterLibraryService.generateCharacterPromptOnly;
  t.after(() => {
    sceneService.listByDramaId = originalListScenes;
    characterLibraryService.generateCharacterPromptOnly = originalGenerateCharacterPrompt;
  });
  sceneService.listByDramaId = () => {
    throw new Error('Vision request timeout after 15000ms');
  };
  const sceneRes = mockRes();
  sceneRoutes({}, silentLog, {}).list({ params: { id: '1' } }, sceneRes);
  assert.equal(sceneRes.statusCode, 500);
  assert.equal(hasCjk(sceneRes.body.error.message), true);
  assert.doesNotMatch(sceneRes.body.error.message, /timeout after|Vision request/i);

  characterLibraryService.generateCharacterPromptOnly = async () => {
    throw new Error('Invalid API key sk-provider-secret');
  };

  const originalGeneratePrompt = propService.generatePropPromptOnly;
  t.after(() => {
    propService.generatePropPromptOnly = originalGeneratePrompt;
  });
  propService.generatePropPromptOnly = async () => {
    throw new Error('Invalid API key sk-provider-secret');
  };
  const routeDb = new Database(':memory:');
  runMigrationsAndEnsure(routeDb);
  const now = new Date().toISOString();
  routeDb.prepare(
    "INSERT INTO dramas (id, title, status, created_at, updated_at, deleted_at, trash_state, recycle_phase) VALUES (11, '主项目', 'draft', ?, ?, NULL, NULL, NULL)"
  ).run(now, now);
  routeDb.prepare(
    "INSERT INTO characters (id, drama_id, name, appearance, created_at, updated_at, deleted_at) VALUES (55, 11, '林夏', '黑发', ?, ?, NULL)"
  ).run(now, now);
  const characterRes = mockRes();
  await characterRoutes(routeDb, {}, silentLog, {}).generatePrompt({ params: { id: '55' }, body: {} }, characterRes);
  assert.equal(characterRes.statusCode, 500);
  assert.equal(hasCjk(characterRes.body.error.message), true);
  assert.doesNotMatch(characterRes.body.error.message, /Invalid API key|sk-provider-secret/i);
  routeDb.close();

  const propRes = mockRes();
  await propRoutes({}, silentLog, {}).generatePropPrompt({ params: { id: '8' }, body: {} }, propRes);
  assert.equal(propRes.statusCode, 500);
  assert.equal(hasCjk(propRes.body.error.message), true);
  assert.doesNotMatch(propRes.body.error.message, /Invalid API key|sk-provider-secret/i);

  const files = [
    path.join(__dirname, '../src/routes/characters.js'),
    path.join(__dirname, '../src/routes/scenes.js'),
    path.join(__dirname, '../src/routes/prop.js'),
    path.join(__dirname, '../src/services/aiClient.js'),
    path.join(__dirname, '../src/services/characterGenerationService.js'),
    path.join(__dirname, '../src/services/providerErrorSanitizer.js'),
  ];
  const forbidden = [
    'AI request was aborted.',
    'Vision request timeout after',
    'Image generation HTTP timeout after',
    'AI stream silence timeout after',
    'episode_id must belong to drama_id',
    'Vision reference image is required.',
    'Vision reference image exceeds the size limit.',
    'AI request body exceeds the size limit.',
    'stream failed',
    "response.internalError(res, err.message)",
    "'AI生成失败: ' + err.message",
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const phrase of forbidden) {
      assert.equal(source.includes(phrase), false, `${path.basename(file)} 仍包含：${phrase}`);
    }
  }

  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const drama = dramaService.createDrama(db, silentLog, { title: '失败任务中文' });
  const originalGenerateText = aiClient.generateText;
  aiClient.generateText = async () => {
    throw new Error('Invalid API key sk-test-not-a-real-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  };
  t.after(async () => {
    aiClient.generateText = originalGenerateText;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && getLegacyAsyncSchedulerState().active !== 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    db.close();
  });
  const taskId = characterGenerationService.generateCharacters(db, {}, silentLog, {
    drama_id: drama.id,
    outline: '生成一个角色',
  });
  const deadline = Date.now() + 3000;
  let task;
  while (Date.now() < deadline) {
    task = taskService.getTask(db, taskId);
    if (task?.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(task?.status, 'failed');
  assert.equal(hasCjk(task.message), true);
  assert.doesNotMatch(String(task.message || ''), /sk-|Invalid API key/i);
});
