const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const imageRoutes = require('../src/routes/images');
const storySourceRoutes = require('../src/routes/storySources');
const characterRoutes = require('../src/routes/characters');
const sceneRoutes = require('../src/routes/scenes');
const storyboardRoutes = require('../src/routes/storyboards');
const uploadService = require('../src/services/uploadService');
const ttsService = require('../src/services/ttsService');
const sourceIntakeService = require('../src/services/sourceIntakeService');
const sceneService = require('../src/services/sceneService');
const { buildProviderErrorMessage, toSafeProviderErrorMessage, isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');
const klingJwt = require('../src/services/klingJwt');
const aiConfigRoutes = require('../src/routes/aiConfig');

const silentLog = { info() {}, warn() {}, error() {}, errorw() {} };

const DRAMA_ID = 11;
const OTHER_DRAMA_ID = 22;
const EPISODE_ID = 1101;
const STORYBOARD_ID = 3301;
const OTHER_STORYBOARD_ID = 4401;
const CHARACTER_ID = 5501;
const SCENE_ID = 6601;

const leftoverEnglish = [
  'Media URL must be credential-free HTTP(S).',
  'This story source has no retained original.',
  'No TTS provider is configured',
  'text cannot be empty',
  'storyboard_id must belong to drama_id',
  'idempotency_key belongs to another drama or storyboard',
  'idempotency_key 属于其他 drama 或 storyboard',
  'idempotency_key 引用了已删除的视频记录，请使用新 key',
  'idempotency_key 引用了已删除的图片记录，请使用新 key',
  'reference_image_urls 必须是数组',
  '缺少 drama.title 字段',
  'storyboards 导入列数不匹配',
  'cols=',
  'vals=',
  'free_canvas_import ${field}',
  'free_canvas_import 必须为对象',
  '项目导入关联 episode_characters 超出安全整数范围',
  '素材导入 source_ref 无效或重复',
  '缺少 project.json',
  'project.json 字段',
  'project.json 条目',
  'project.json 根节点',
  'project.json 格式错误',
  '逃逸 storage',
  '逃逸 staging',
  'staging 目录不完整',
  'storage 根目录不是普通目录',
  'SHA-256 无效',
  'MIME 类型无效',
  '素材导入原始文件 ${entry.source_ref}',
  'free_canvas_import ',
  '${field} is invalid',
  'Image generation did not complete',
  '图片持久化失败: ${saveErr.message}',
  'Video generation did not complete',
  'source text is required',
  'unsafe scene source image',
  'scene source image required',
  'Production QA failed with score',
  'Video merge task no longer accepts completion',
  'Static storage path is not allowed',
  'stream failed',
  'provider reported an error; check provider configuration and retry',
  'Unsafe media reference.',
  'Vision reference image is required.',
  'imageUrl 必须是 http URL 或 base64 data URL',
  'Vision reference image exceeds the size limit.',
  'AI request body exceeds the size limit.',
  'episode_id must belong to drama_id',
  'Remote URL is invalid.',
  'Public provider endpoints must use HTTPS.',
  'Remote response exceeds the size limit.',
  'required database schema is unavailable',
  'database write probe did not insert one row',
  'database write probe could not read its row',
  'database write probe left persistent data',
  'storage write probe stopped early',
  'not a regular directory',
  'The data backup could not be completed.',
  'The data restore could not be completed.',
  'Stop the LocalMiniDrama backend before data backup or restore.',
  'The archive contains an unsafe or non-portable file name.',
  'The private claim directory identity changed.',
  'The archive uses unsupported numeric sizes or offsets.',
  'The descriptor-backed archive size is unsupported.',
  'The external maintenance lease changed before it was read.',
  'The external maintenance lease changed while it was read.',
  'The external maintenance lease could not be read consistently.',
  'The failed backup output could not be claimed without touching a replacement.',
  'The claimed failed backup output could not be removed.',
  'The claimed maintenance recovery lease could not be removed.',
  'The claimed service maintenance lock could not be removed.',
  'The private claim is not a directory.',
  'HTTPS requests cannot redirect to HTTP.',
  'Cross-origin redirects cannot replay request bodies.',
  'HTTP provider endpoints must remain on an explicitly allowed private origin.',
  'The provider network policy is incomplete or invalid.',
  'The provider endpoint is not authorized by the saved network policy.',
  'Private provider origins must also be trusted provider origins.',
  'The backup publication result exceeded',
  'could not be written',
  'was not committed before the deadline',
  'requires a value.',
  'Duplicate option',
  'Unknown option',
  'project.json field',
  'Project import ',
  'Source Intake manifest',
  'Source Intake original',
  'Imported source',
  'image pixel limit exceeded',
  'Sharp could not decode image metadata',
  'Unknown library table',
  'Unknown or templated skill not found',
  'Skill is disabled or missing',
  'Electron image validation requires an application entry',
  'media validation failed',
  'ffprobe is unavailable',
  'character not found',
  'scene not found',
  'prop not found',
  'library item not found',
  "error: 'unauthorized'",
  'Language switched to English',
  'config at index',
  'config file must be a JSON array',
  '缺少 base_url',
  '缺少 action',
  '不支持的 http_method',
  '缺少 asset id',
  'character_ids 不能为空',
  'base_url 必填',
  'model 必填',
  'base_url 必须是合法',
  'base_url 仅支持',
  'base_url 不得包含',
  'url 必须为安全的媒体 URL',
  'category 包含保留的网络素材来源元数据',
  '网页请求失败：',
  'free_canvas 必须为对象',
  'free_canvas version 不受支持',
  'storyboardId 和 storyboard_ref',
  '请先填写网关 URL 与 Token',
  '填写网关 URL 与 Token',
  '网关 URL + Token',
  'ModelArk 返回缺少资产 Id',
  '填写 Token',
  '当前 Token（',
  '勿带 Bearer 前缀',
  'curl 测试',
  '资产组 Id',
  'base_url 或 api_key',
  'base_url 或 AK/SK',
  'asset_group_id（默认资产组 Id）',
  '缺少分镜 id',
  'image_prompt / action / dialogue',
  '该分镜暂无可优化的内容（image_prompt / action / dialogue 均为空）',
  '请改为调用 POST /api/v1/scenes/generate-image，并传入 scene_id',
  '请改为调用 POST /api/v1/scenes/generate-image，并传入场景 ID',
  '请改为调用 POST /api/v1/videos，并传入 storyboard_id 与帧参考',
  '请改为调用 POST /api/v1/videos，并传入分镜 ID 与帧参考',
  '请改为调用 POST /api/v1/episodes/:episode_id/finalize 启动 FFmpeg 合成',
  '请改为对每个分镜单独调用 POST /api/v1/images',
  '请改为对每个分镜单独调用 POST /api/v1/videos',
  'Provider 任务 ID',
  '补偿取消迟到的 Provider 任务',
  'Provider 已返回任务 ID',
  'Provider 协议',
  '厂商任务 ID',
  '素材图 Provider',
  '分镜图 Provider',
  '视频 Provider',
  'TTS Provider',
  'Provider 请求失败',
  'Provider 不可用',
  'Provider 控制台',
  '本地 Provider 模式',
  'stale after adaptation overwrite',
  '无效的分镜 id',
  'Sora 当前不支持尾帧参考，请移除 last_frame_url',
  'ComfyUI 任务提交未返回 prompt_id',
  'ComfyUI settings 不是有效的 JSON',
  'ComfyUI Base URL',
  'ComfyUI 参考图 data URL',
  'ComfyUI workflow',
  '当前 Node.js 环境不支持 fetch',
  'workflow 执行失败',
  '视觉参考图 data URL',
  'http/https URL',
  '不允许导入 localhost 或本地域名',
  'NODE_TLS_REJECT_UNAUTHORIZED=0 会关闭',
  'server.insecure_tls 会关闭',
  '无效的配置ID',
  'AK/SK 签名',
  '必须是受控的相对 URL 路径',
  '不得包含 URL 片段',
  '包含无效的 URL 编码',
  '请提供新的 API Key',
  '条配置的 API Key',
  'AccessKey 与 SecretKey 不能为空',
  'SecretKey 按 Base64 解码后为空',
  '请填写「API Key」（中转 Bearer）',
  '未返回资产 Id（响应字段：',
  '未返回素材 id（响应字段：',
  '素材库未返回素材 id',
  'Sora 视频任务 ID 无效',
  'MiniMax 视频任务 ID 无效',
  'MiniMax 视频文件 ID 无效',
  'Access Key ID 与 Secret Access Key',
  'Query 中带 Action',
  '请提供 canvas_layout、free_canvas 或 workflow_groups',
  'canvas_layout 必须为对象',
  'workflow_groups 必须为数组',
  '未返回 task_id 或 video_url',
  '视频本地路径必须位于 storage 内',
  '视频路径必须是 storage 内的相对路径',
  '音频路径必须指向 storage 内已存在的普通文件',
  '参考媒体本地路径必须位于 storage 内',
  '视频引用必须位于 storage 目录内',
  '张参考图不在 storage 内',
  '将 storage.base_url 配置为 Agnes',
  '未配置 storage.base_url',
  'storage.local_path 下文件存在',
  'image_proxy 配置可用',
  'DNS_ERROR',
  '未知的工作流步骤：${step.step_key}',
  'workflow queue operation(s) failed',
  'invalid audio file',
  'persistImageFailure(db, row, err.message)',
  'persistVideoFailure(db, row, err.message)',
];

function leftoverScanText(source, phrase) {
  // 内部赋值 data.free_canvas_import 不是用户错误，只扫描 throw 文案里的旧前缀。
  if (phrase !== 'free_canvas_import ') return source;
  return source
    .split('\n')
    .filter((line) => /\bthrow\b/.test(line))
    .join('\n');
}

function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function mockResponse() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
    },
  };
}

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at, deleted_at, trash_state, recycle_phase)
     VALUES (?, ?, 'draft', ?, ?, NULL, NULL, NULL)`
  ).run(DRAMA_ID, '\u4e3b\u9879\u76ee', now, now);
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at, deleted_at, trash_state, recycle_phase)
     VALUES (?, ?, 'draft', ?, ?, NULL, NULL, NULL)`
  ).run(OTHER_DRAMA_ID, '\u53e6\u4e00\u4e2a\u9879\u76ee', now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at, deleted_at)
     VALUES (?, ?, 1, '\u7b2c\u4e00\u96c6', ?, ?, NULL)`
  ).run(EPISODE_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at, deleted_at)
     VALUES (?, ?, 1, '\u53e6\u4e00\u96c6', ?, ?, NULL)`
  ).run(2201, OTHER_DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, title, created_at, updated_at, deleted_at)
     VALUES (?, ?, '\u4e3b\u5206\u955c', ?, ?, NULL)`
  ).run(STORYBOARD_ID, EPISODE_ID, now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, title, created_at, updated_at, deleted_at)
     VALUES (?, ?, '\u53e6\u4e00\u5206\u955c', ?, ?, NULL)`
  ).run(OTHER_STORYBOARD_ID, 2201, now, now);
  db.prepare(
    `INSERT INTO characters (id, drama_id, name, appearance, created_at, updated_at, deleted_at)
     VALUES (?, ?, '\u6797\u590f', '\u9ed1\u53d1', ?, ?, NULL)`
  ).run(CHARACTER_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, status, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, '\u7801\u5934', 'draft', ?, ?, NULL)`
  ).run(SCENE_ID, DRAMA_ID, EPISODE_ID, now, now);
  return db;
}

test('\u5269\u4f59\u7528\u6237\u9519\u8bef\u6e90\u7801\u4e0d\u518d\u5305\u542b\u5df2\u5217\u51fa\u7684\u82f1\u6587\u53e5\u5b50', () => {
  const files = [
    'services/uploadService.js',
    'services/ttsService.js',
    'services/imageService.js',
    'services/videoService.js',
    'services/sourceIntakeService.js',
    'services/sceneService.js',
    'services/dramaWriteGuard.js',
    'services/videoMergeService.js',
    'services/providerErrorSanitizer.js',
    'services/aiClient.js',
    'services/characterGenerationService.js',
    'services/secureHttpFetch.js',
    'services/readinessService.js',
    'services/dataBackupService.js',
    'services/dramaImportService.js',
    'services/dramaExportService.js',
    'services/importImageValidator.js',
    'services/skillRegistryService.js',
    'services/libraryDedup.js',
    'routes/storyboards.js',
    'routes/images.js',
    'routes/videos.js',
    'routes/videoMerges.js',
    'routes/aiConfig.js',
    'app.js',
    'scripts/backup-data.js',
    'scripts/restore-data.js',
    'scripts/recover-maintenance.js',
    'services/characterLibraryService.js',
    'services/sceneLibraryService.js',
    'services/propLibraryService.js',
    'services/propService.js',
    'services/webSourceImportService.js',
    'services/providerSdkService.js',
    'services/modelArkAssetProxyService.js',
    'services/modelArkAssetConfigService.js',
    'services/aiConfigService.js',
    'services/freeCanvasValidation.js',
    'services/assetService.js',
    'services/jimengMaterialHubService.js',
    'routes/settings.js',
    'services/episodeStoryboardService.js',
    'services/videoGateway/protocolDispatch.js',
    'services/comfyUiClient.js',
    'services/klingJwt.js',
    'services/videoGateway/klingVideoAdapter.js',
    'services/videoGateway/openAiSoraAdapter.js',
    'services/videoGateway/minimaxVideoAdapter.js',
    'services/dramaService.js',
    'services/storyboardService.js',
    'services/workflowService.js',
    'services/videoGateway/agnesVideoAdapter.js',
    'services/tlsPolicy.js',
    'services/taskService.js',
    'routes/prop.js',
  ];
  for (const name of files) {
    const sourcePath = name.startsWith('scripts/')
      ? path.join(__dirname, '..', name)
      : path.join(__dirname, '../src', name);
    const source = fs.readFileSync(sourcePath, 'utf8');
    for (const phrase of leftoverEnglish) {
      assert.equal(leftoverScanText(source, phrase).includes(phrase), false, `${name} \u4ecd\u5305\u542b\uff1a${phrase}`);
    }
  }
});

test('\u56fe\u7247\u751f\u6210\u8de8\u9879\u76ee ID \u4e0d\u76f8\u7b49\u65f6\u8fd4\u56de\u4e2d\u6587 BAD_REQUEST', () => {
  assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID);
  assert.notEqual(DRAMA_ID, EPISODE_ID);
  assert.notEqual(DRAMA_ID, STORYBOARD_ID);
  assert.notEqual(EPISODE_ID, STORYBOARD_ID);
  assert.notEqual(STORYBOARD_ID, OTHER_STORYBOARD_ID);

  const db = createDb();
  try {
    const res = mockResponse();
    imageRoutes(db, {}, silentLog).create({
      body: {
        drama_id: DRAMA_ID,
        storyboard_id: OTHER_STORYBOARD_ID,
        prompt: '\u8de8\u9879\u76ee\u63d0\u793a\u8bcd',
      },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /分镜不属于当前项目/);
    assert.doesNotMatch(res.body.error.message, /storyboard_id|drama_id/);
    assert.equal(hasCjk(res.body.error.message), true);

    const invalid = mockResponse();
    imageRoutes(db, {}, silentLog).create({
      body: { drama_id: { nested: EPISODE_ID }, prompt: '\u65e0\u6548\u9879\u76ee ID' },
    }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.error.code, 'BAD_REQUEST');
    assert.match(invalid.body.error.message, /项目 ID.*无效/);
    assert.doesNotMatch(invalid.body.error.message, /drama_id/);
  } finally {
    db.close();
  }
});

test('TTS / \u7d20\u6750\u6e90 / \u573a\u666f\u5168\u666f / \u4e0a\u4f20\u9519\u8bef\u4e3a\u53ef\u64cd\u4f5c\u7b80\u4f53\u4e2d\u6587', async () => {
  const db = createDb();
  try {
    await assert.rejects(
      () => ttsService.synthesize(db, silentLog, { text: '   ', storage_base: '.' }),
      (error) => error.code === 'BAD_REQUEST' && /\u5bf9\u767d\u4e3a\u7a7a/.test(error.message)
    );
    await assert.rejects(
      () => ttsService.synthesize(db, silentLog, { text: '\u65c1\u767d', storage_base: '.' }),
      (error) => error.code === 'BAD_REQUEST' && /\u672a\u914d\u7f6e TTS/.test(error.message)
    );

    assert.throws(
      () => sourceIntakeService.createStorySource(db, silentLog, {
        drama_id: DRAMA_ID,
        episode_id: EPISODE_ID,
        text: '   ',
      }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '\u7d20\u6750\u6587\u672c\u4e0d\u80fd\u4e3a\u7a7a'
    );

    const emptyRoute = mockResponse();
    storySourceRoutes(db, silentLog).createForDrama(
      { params: { id: String(DRAMA_ID) }, body: { text: '', title: '\u7a7a\u6587\u672c' } },
      emptyRoute
    );
    assert.equal(emptyRoute.statusCode, 400);
    assert.equal(emptyRoute.body.error.code, 'BAD_REQUEST');
    assert.equal(emptyRoute.body.error.message, '\u7d20\u6750\u6587\u672c\u4e0d\u80fd\u4e3a\u7a7a');

    const panorama = sceneService.generateScenePanoramaImage(db, silentLog, SCENE_ID);
    assert.equal(panorama.ok, false);
    assert.equal(panorama.error, '\u8bf7\u5148\u4e3a\u573a\u666f\u51c6\u5907\u53ef\u7528\u7684\u4e3b\u56fe\uff0c\u518d\u751f\u6210\u5168\u666f\u56fe');
    const panoramaRes = mockResponse();
    sceneRoutes(db, silentLog, {}).generatePanorama(
      { params: { scene_id: String(SCENE_ID) }, body: {} },
      panoramaRes
    );
    assert.equal(panoramaRes.statusCode, 400);
    assert.equal(panoramaRes.body.error.code, 'BAD_REQUEST');
    assert.equal(panoramaRes.body.error.message, '\u8bf7\u5148\u4e3a\u573a\u666f\u51c6\u5907\u53ef\u7528\u7684\u4e3b\u56fe\uff0c\u518d\u751f\u6210\u5168\u666f\u56fe');

    assert.throws(
      () => uploadService.assertPublicHttpUrlSyntax('http://127.0.0.1/private.png'),
      (error) => error.code === 'UNSAFE_MEDIA_REFERENCE'
        && /公网|HTTP/.test(error.message)
        && hasCjk(error.message)
    );
    assert.throws(
      () => uploadService.assertPublicHttpUrlSyntax('ftp://example.com/a.png'),
      (error) => error.code === 'UNSAFE_MEDIA_REFERENCE'
        && /HTTP\(S\)/.test(error.message)
        && hasCjk(error.message)
    );
  } finally {
    db.close();
  }
});

test('\u89d2\u8272\u672a\u6388\u6743\u4e0d\u518d\u628a\u82f1\u6587 unauthorized \u8fd4\u56de\u7ed9\u524d\u7aef', async () => {
  const db = createDb();
  try {
    assert.notEqual(CHARACTER_ID, DRAMA_ID);
    assert.notEqual(CHARACTER_ID, EPISODE_ID);
    db.prepare('UPDATE dramas SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), DRAMA_ID);
    const res = mockResponse();
    await characterRoutes(db, {}, silentLog, {}).generatePrompt(
      { params: { id: String(CHARACTER_ID) }, body: {} },
      res
    );
    assert.notEqual(res.body?.error?.message, 'unauthorized');
    assert.equal(hasCjk(res.body.error.message), true);
    assert.match(res.body.error.message, /\u4e0d\u5b58\u5728|\u65e0\u6743\u9650|\u4e0d\u53ef\u7528/);
    assert.doesNotMatch(res.body.error.message, /\bunauthorized\b/i);
  } finally {
    db.close();
  }
});

test('Provider \u8131\u654f\u9519\u8bef\u548c\u9759\u6001 404 \u5bf9\u7528\u6237\u4f7f\u7528\u7b80\u4f53\u4e2d\u6587', () => {
  const message = buildProviderErrorMessage({
    provider: 'OpenAI',
    operation: '\u8fde\u63a5\u6d4b\u8bd5',
    status: 401,
  });
  assert.match(message, /OpenAI/);
  assert.match(message, /\u8fde\u63a5\u6d4b\u8bd5/);
  assert.match(message, /\u5931\u8d25/);
  assert.match(message, /\u8ba4\u8bc1\u5931\u8d25/);
  assert.equal(hasCjk(message), true);

  const forged = toSafeProviderErrorMessage(
    new Error('OpenAI \u8fde\u63a5\u6d4b\u8bd5 \u5931\u8d25 (sk-secret)\uff1aProvider \u8fd4\u56de\u9519\u8bef\uff0c\u8bf7\u68c0\u67e5\u914d\u7f6e\u540e\u91cd\u8bd5\u3002'),
    { provider: 'OpenAI', operation: '\u8fde\u63a5\u6d4b\u8bd5' }
  );
  assert.doesNotMatch(forged, /sk-secret/);
  assert.match(forged, /\u5931\u8d25/);

  const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(appSource, /\u672a\u627e\u5230\u8d44\u6e90/);
  assert.match(appSource, /\u8d44\u6e90\u8def\u5f84\u65e0\u6548/);
  assert.equal(appSource.includes("send('Not Found')"), false);
});

test('从图片提取描述时非法地址返回不含英文字段名的中文', async () => {
  const { extractDescriptionFromImage } = require('../src/services/aiClient');
  const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');
  const { sendCaughtRouteError } = require('../src/routes/serviceFailure');
  const message = '请提供可访问的图片地址或本地图片数据';
  assert.equal(isTrustedChineseUserError(message), true);
  await assert.rejects(
    () => extractDescriptionFromImage({}, silentLog, 'character', 'file:///tmp/ref.png', '林夏'),
    (err) => {
      assert.equal(err.message, message);
      assert.doesNotMatch(err.message, /imageUrl|http URL|base64 data URL/);
      assert.equal(isTrustedChineseUserError(err.message), true);
      const res = mockResponse();
      sendCaughtRouteError(res, err, '从图片提取描述失败，请稍后重试');
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.message, message);
      return true;
    }
  );
  const source = fs.readFileSync(path.join(__dirname, '../src/services/aiClient.js'), 'utf8');
  const throws = source
    .split('\n')
    .filter((line) => /\bthrow\b/.test(line))
    .join('\n');
  assert.match(throws, /请提供可访问的图片地址或本地图片数据/);
  assert.equal(throws.includes('imageUrl'), false);
  assert.equal(throws.includes('http URL'), false);
  assert.equal(throws.includes('base64 data URL'), false);
  assert.equal(source.includes('imageUrl 必须是 http URL 或 base64 data URL'), false);
});


test('画布保存缺少布局时返回不含英文字段名的中文', () => {
  const dramaService = require('../src/services/dramaService');
  const dramaRoutes = require('../src/routes/drama');
  const db = createDb();
  try {
    assert.throws(
      () => dramaService.saveCanvasLayout(db, silentLog, DRAMA_ID, {}),
      (error) => {
        assert.equal(error.code, 'BAD_REQUEST');
        assert.equal(error.message, '请提供画布布局、自由画布或工作流组');
        assert.equal(isTrustedChineseUserError(error.message), true);
        assert.doesNotMatch(error.message, /canvas_layout|free_canvas|workflow_groups/);
        return true;
      },
    );
    assert.throws(
      () => dramaService.saveCanvasLayout(db, silentLog, DRAMA_ID, { canvas_layout: [], workflow_groups: [] }),
      (error) => {
        assert.equal(error.message, '画布布局必须为对象');
        assert.equal(isTrustedChineseUserError(error.message), true);
        return true;
      },
    );
    assert.throws(
      () => dramaService.saveCanvasLayout(db, silentLog, DRAMA_ID, { workflow_groups: {} }),
      (error) => {
        assert.equal(error.message, '工作流组必须为数组');
        assert.equal(isTrustedChineseUserError(error.message), true);
        return true;
      },
    );

    const res = mockResponse();
    dramaRoutes(db, {}, silentLog).saveCanvasLayout({ params: { id: String(DRAMA_ID) }, body: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.message, '请提供画布布局、自由画布或工作流组');
    assert.equal(isTrustedChineseUserError(res.body.error.message), true);
  } finally {
    db.close();
  }
});
test('图片和视频幂等冲突返回不含英文字段名的中文', () => {
  const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');
  assert.equal(isTrustedChineseUserError('该幂等键属于其他项目或分镜'), true);
  assert.equal(isTrustedChineseUserError('该幂等键指向已删除的视频记录，请使用新的幂等键'), true);
  assert.equal(isTrustedChineseUserError('该幂等键指向已删除的图片记录，请使用新的幂等键'), true);
  assert.equal(isTrustedChineseUserError('参考图列表必须是数组'), true);
  assert.equal(isTrustedChineseUserError('项目文件格式不正确：缺少剧名'), true);
  assert.equal(isTrustedChineseUserError('foo_bar'), false);
  const trustedImportMessages = [
    '自由画布导入数据必须为对象',
    '自由画布导入清单版本不受支持',
    '自由画布导入剧集列表无法映射',
    '自由画布导入分镜列表无法映射',
    '自由画布导入源项目与画布项目引用不一致',
    '自由画布导入媒体包含重复归档路径',
    '自由画布导入媒体哈希校验失败',
    '旧版 ZIP 自由画布包含无法验证的引用，缺少导入清单',
    '分镜导入数据列数不匹配，请重新导出后再导入',
  ];
  for (const message of trustedImportMessages) {
    assert.equal(isTrustedChineseUserError(message), true, message);
  }
  assert.equal(isTrustedChineseUserError('自由画布导入视频生成状态不受支持'), true);
  const videoSource = fs.readFileSync(path.join(__dirname, '../src/services/videoService.js'), 'utf8');
  const imageSource = fs.readFileSync(path.join(__dirname, '../src/services/imageService.js'), 'utf8');
  const importSource = fs.readFileSync(path.join(__dirname, '../src/services/dramaImportService.js'), 'utf8');
  assert.match(videoSource, /该幂等键属于其他项目或分镜/);
  assert.match(imageSource, /该幂等键属于其他项目或分镜/);
  assert.match(importSource, /项目文件格式不正确：缺少剧名/);
  assert.equal(videoSource.includes('idempotency_key 属于其他 drama 或 storyboard'), false);
  assert.equal(imageSource.includes('idempotency_key 属于其他 drama 或 storyboard'), false);
  assert.equal(importSource.includes('缺少 drama.title 字段'), false);
  const importThrows = leftoverScanText(importSource, 'free_canvas_import ');
  assert.equal(importThrows.includes('free_canvas_import '), false);
  assert.equal(importThrows.includes('storyboards 导入列数不匹配'), false);
  assert.equal(importThrows.includes('cols='), false);
  assert.equal(importThrows.includes('vals='), false);
  for (const message of trustedImportMessages) {
    assert.equal(importSource.includes(message), true, message);
  }
});

test('视频服务供应商任务编号对用户使用中文', () => {
  const videoSource = fs.readFileSync(path.join(__dirname, '../src/services/videoService.js'), 'utf8');
  assert.match(videoSource, /视频任务归属已变化，拒绝写入供应商任务编号/);
  assert.match(videoSource, /供应商任务编号持久化失败/);
  assert.match(videoSource, /补偿取消迟到的供应商任务/);
  assert.match(videoSource, /供应商已返回任务编号，但未注册远端取消函数/);
  assert.match(videoSource, /当前供应商协议 /);
  assert.match(videoSource, /不支持重启后恢复远端取消/);
  assert.match(videoSource, /服务重启后无法恢复轮询（缺少供应商任务编号），请重新生成/);
  assert.equal(videoSource.includes('Provider 任务 ID'), false);
  assert.equal(videoSource.includes('补偿取消迟到的 Provider 任务'), false);
  assert.equal(videoSource.includes('Provider 已返回任务 ID'), false);
  assert.equal(videoSource.includes('Provider 协议'), false);
  assert.equal(videoSource.includes('厂商任务 ID'), false);
  assert.match(videoSource, /未返回任务编号或视频地址/);
  assert.equal(videoSource.includes('未返回 task_id 或 video_url'), false);
  assert.match(videoSource, /参考媒体本地路径必须位于本地存储目录内/);
  assert.equal(videoSource.includes('参考媒体本地路径必须位于 storage 内'), false);
  assert.match(videoSource, /persistVideoFailure\(db, row, err\)/);
  assert.equal(videoSource.includes('persistVideoFailure(db, row, err.message)'), false);
  assert.match(videoSource, /toUserFacingProcessError\(errorMessage, '视频生成失败'\)/);
});

test('图片持久化失败不会把英文系统错误漏给用户', () => {
  const imageSource = fs.readFileSync(path.join(__dirname, '../src/services/imageService.js'), 'utf8');
  const { toUserFacingProcessError } = require('../src/services/providerErrorSanitizer');
  assert.equal(imageSource.includes('图片持久化失败: ${saveErr.message}'), false);
  assert.match(imageSource, /toUserFacingProcessError\(saveErr/);
  assert.match(imageSource, /toUserFacingProcessError\(message, '图片生成失败'\)/);
  assert.match(imageSource, /persistImageFailure\(db, row, err\)/);
  assert.equal(imageSource.includes('persistImageFailure(db, row, err.message)'), false);
  assert.equal(
    toUserFacingProcessError(new Error('ENOENT: no such file or directory'), '图片保存到本地失败，请稍后重试'),
    '图片保存到本地失败，请稍后重试',
  );
  assert.equal(
    toUserFacingProcessError(new Error('Input file is missing'), '图片保存到本地失败，请稍后重试'),
    '图片保存到本地失败，请稍后重试',
  );
  assert.doesNotMatch(
    toUserFacingProcessError(new Error('EACCES: permission denied'), '图片保存到本地失败，请稍后重试'),
    /EACCES|permission denied/i,
  );
  assert.equal(
    toUserFacingProcessError(new Error('图片下载到本地失败'), '图片保存到本地失败，请稍后重试'),
    '图片下载到本地失败',
  );
});

test('videoClient 用户错误不再是问号乱码', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/videoClient.js'), 'utf8');
  const pollSource = fs.readFileSync(path.join(__dirname, '../src/services/videoGateway/pollDispatch.js'), 'utf8');
  const pollControlSource = fs.readFileSync(path.join(__dirname, '../src/services/videoGateway/pollControl.js'), 'utf8');
  const userFacing = [source, pollSource, pollControlSource].join('\n')
    .split('\n')
    .filter((line) => /throw new Error\(|return \{ error:/.test(line))
    .join('\n');
  assert.equal(userFacing.includes('??????'), false);
  assert.match(source, /请先在 AI 配置中添加并启用视频服务/);
  assert.match(pollSource, /Vidu 任务完成但未返回视频地址/);
  assert.match(pollSource, /Gemini 任务完成但未返回视频地址/);
  assert.match(source, /视频生成超时，请稍后重试/);
  assert.match(pollControlSource, /视频任务已取消/);
  assert.equal(source.includes('throw signal.reason'), false);
  assert.equal(pollControlSource.includes('throw signal.reason'), false);
});
test('角色生成在 episode_id 与 drama_id 不相等时返回中文 BAD_REQUEST', () => {
  const characterGenerationService = require('../src/services/characterGenerationService');
  assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID);
  assert.notEqual(EPISODE_ID, 2201);
  const db = createDb();
  try {
    assert.throws(
      () => characterGenerationService.generateCharacters(db, {}, silentLog, {
        drama_id: DRAMA_ID,
        episode_id: 2201,
        outline: '跨项目大纲',
      }),
      (error) => error.code === 'BAD_REQUEST'
        && error.message.includes('剧集不属于当前项目')
        && !/episode_id|drama_id/.test(error.message)
        && hasCjk(error.message)
        && !/must belong/.test(error.message)
    );
  } finally {
    db.close();
  }
});

test('视频后处理异常不会把英文堆栈返回给用户', () => {
  const { toUserFacingProcessError } = require('../src/services/providerErrorSanitizer');
  assert.equal(
    toUserFacingProcessError(new Error('spawn ffmpeg ENOENT'), '视频后处理失败，请确认已安装 ffmpeg 后重试'),
    '视频后处理失败，请确认已安装 ffmpeg 后重试',
  );
  assert.equal(
    toUserFacingProcessError('烧录字幕或混音失败（请确认已安装 ffmpeg 且支持 libx264）', '处理失败'),
    '烧录字幕或混音失败（请确认已安装 ffmpeg 且支持 libx264）',
  );
  const cancelled = new Error('Canceled');
  cancelled.name = 'AbortError';
  cancelled.code = 'OPERATION_CANCELLED';
  assert.equal(toUserFacingProcessError(cancelled, '处理失败'), '操作已取消');
  const chineseCancel = new Error('用户取消后处理');
  chineseCancel.name = 'AbortError';
  chineseCancel.code = 'OPERATION_CANCELLED';
  assert.equal(toUserFacingProcessError(chineseCancel, '处理失败'), '用户取消后处理');
  assert.doesNotMatch(
    toUserFacingProcessError(new Error('Invalid API key sk-secret-value'), '视频后处理失败，请确认已安装 ffmpeg 后重试'),
    /sk-secret/,
  );
});

test('角色库未映射的英文错误不会回给前端', () => {
  const { sendMappedServiceFailure } = require('../src/routes/serviceFailure');
  const res = mockResponse();
  assert.equal(sendMappedServiceFailure(res, { ok: false, error: 'ENOENT: no such file or directory' }), true);
  assert.equal(res.statusCode, 400);
  assert.equal(hasCjk(res.body.error.message), true);
  assert.doesNotMatch(res.body.error.message, /ENOENT|no such file/i);
});

test('备份 HTTP 错误不会把英文 publicMessage 回给前端', () => {
  const { DataBackupError } = require('../src/services/dataBackupService');
  const { describeBackupHttpError } = require('../src/services/backupSettingsService');
  const english = new DataBackupError('INVALID_MANIFEST', 'The backup manifest is not valid JSON.');
  const mapped = describeBackupHttpError(english);
  assert.equal(mapped.code, 'INVALID_MANIFEST');
  assert.match(mapped.message, /备份清单/);
  assert.doesNotMatch(mapped.message, /manifest/i);
  const unknownEnglish = new DataBackupError('WEIRD_CODE', 'The private claim is not a directory.');
  const fallback = describeBackupHttpError(unknownEnglish);
  assert.equal(hasCjk(fallback.message), true);
  assert.doesNotMatch(fallback.message, /private claim/i);
});

test('备份 CLI 错误输出使用简体中文', () => {
  const { formatBackupCliError } = require('../src/services/backupSettingsService');
  const { DataBackupError } = require('../src/services/dataBackupService');
  const english = new DataBackupError('BACKUP_FAILED', 'The data backup could not be completed.');
  const mapped = formatBackupCliError(english);
  assert.match(mapped, /^\[BACKUP_FAILED\] /);
  assert.match(mapped, /数据备份未能完成/);
  assert.doesNotMatch(mapped, /could not be completed/i);

  const backupCli = fs.readFileSync(path.join(__dirname, '../scripts/backup-data.js'), 'utf8');
  const restoreCli = fs.readFileSync(path.join(__dirname, '../scripts/restore-data.js'), 'utf8');
  assert.match(backupCli, /数据备份已完成/);
  assert.match(restoreCli, /数据恢复已完成/);
  assert.equal(backupCli.includes('The data backup could not be completed.'), false);
  assert.equal(restoreCli.includes('The data restore could not be completed.'), false);
  assert.match(backupCli, /formatBackupCliError/);
  assert.match(restoreCli, /formatBackupCliError/);
});

test('备份服务 publicMessage 对已映射错误码使用简体中文', () => {
  const { DataBackupError } = require('../src/services/dataBackupService');
  const BACKUP_PUBLIC_MESSAGES = require('../src/services/backupPublicMessages');
  const { __testing } = require('../src/services/dataBackupService');
  const mapped = __testing.backupError('SERVICE_RUNNING', 'Stop the LocalMiniDrama backend before data backup or restore.');
  assert.equal(hasCjk(mapped.publicMessage), true);
  assert.doesNotMatch(mapped.publicMessage, /Stop the LocalMiniDrama/i);
  assert.equal(mapped.publicMessage, BACKUP_PUBLIC_MESSAGES.SERVICE_RUNNING);

  const createDataBackupSource = fs.readFileSync(
    path.join(__dirname, '../src/services/dataBackupService.js'),
    'utf8',
  );
  assert.match(createDataBackupSource, /BACKUP_PUBLIC_MESSAGES\[code\]/);
  assert.equal(hasCjk(BACKUP_PUBLIC_MESSAGES.SERVICE_RUNNING), true);
  assert.equal(hasCjk(BACKUP_PUBLIC_MESSAGES.UNSAFE_ARCHIVE_PATH), true);
  assert.equal(BACKUP_PUBLIC_MESSAGES.SERVICE_RUNNING, require('../src/services/backupSettingsService').HTTP_BACKUP_MESSAGES.SERVICE_RUNNING);
});

test('剩余路由缺参和空分镜优化返回简体中文用户错误', async () => {
  const leftoverMixedFieldErrors = [
    '请提供 storyboard_id 或 text',
    'storyboard_ids 不能为空',
    'character_ids 不能为空',
    '缺少 library_id',
    'characters 必填且为数组',
    'episodes 必填且为数组',
    'current_step 必填',
    'episode_id不能为空',
    '请改为调用 POST /api/v1/scenes/generate-image，并传入 scene_id',
    '请上传小说文本文件或提供 text 参数',
    'drama_id 和 name 必填',
    '缺少必填字段: key',
    '缺少 drama_id',
    '缺少 scene_id',
    '缺少分镜 id',
    '无效的分镜 id',
    '无效的配置ID',
    '无效的ID',
    '请提供新的 API Key',
    '条配置的 API Key',
    '该分镜暂无可优化的内容（image_prompt / action / dialogue 均为空）',
    'episode_id 必填',
    '缺少resource_id参数',
    '请改为调用 POST /api/v1/episodes/:episode_id/finalize 启动 FFmpeg 合成',
    '请改为调用 POST /api/v1/videos，并传入 storyboard_id 与帧参考',
    '请改为调用 POST /api/v1/scenes/generate-image，并传入场景 ID',
    '请改为调用 POST /api/v1/videos，并传入分镜 ID 与帧参考',
    '请改为对每个分镜单独调用 POST /api/v1/images',
    '请改为对每个分镜单独调用 POST /api/v1/videos',
    'POST /api/v1/',
  ];
  const files = [
    'routes/audio.js', 'routes/characters.js', 'routes/drama.js', 'routes/images.js',
    'routes/index.js', 'routes/prop.js', 'routes/sceneModelMap.js', 'routes/scenes.js',
    'routes/storyboards.js', 'routes/task.js', 'routes/videoMerges.js', 'routes/videos.js',
    'routes/aiConfig.js',
  ];
  for (const name of files) {
    const source = fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
    for (const phrase of leftoverMixedFieldErrors) {
      assert.equal(source.includes(phrase), false, `${name} 仍包含：${phrase}`);
    }
  }

  const imagesSource = fs.readFileSync(path.join(__dirname, '../src/routes/images.js'), 'utf8');
  const videosSource = fs.readFileSync(path.join(__dirname, '../src/routes/videos.js'), 'utf8');
  assert.match(imagesSource, /请改用场景生图接口，并传入场景 ID/);
  assert.match(imagesSource, /请改为对每个分镜单独调用生图接口/);
  assert.match(videosSource, /请改用视频生成接口，并传入分镜 ID 与帧参考/);
  assert.match(videosSource, /请改为对每个分镜单独调用视频生成接口/);
  assert.equal(imagesSource.includes('/api/v1/'), false);
  assert.equal(videosSource.includes('/api/v1/'), false);

  const images = imageRoutes({}, {}, silentLog);
  const videoRoutes = require('../src/routes/videos');
  const videos = videoRoutes({}, silentLog);
  const sceneRes = mockResponse();
  images.scene({ params: { scene_id: String(SCENE_ID) } }, sceneRes);
  assert.equal(sceneRes.statusCode, 501);
  assert.equal(sceneRes.body.error.code, 'LEGACY_ENDPOINT_DISABLED');
  assert.equal(sceneRes.body.error.message, '请改用场景生图接口，并传入场景 ID');
  const imageBatchRes = mockResponse();
  images.episodeBatch({ params: { episode_id: String(EPISODE_ID) }, body: {} }, imageBatchRes);
  assert.equal(imageBatchRes.body.error.message, '请改为对每个分镜单独调用生图接口');
  const fromImageRes = mockResponse();
  videos.fromImage({ params: { image_gen_id: '1' }, body: {} }, fromImageRes);
  assert.equal(fromImageRes.body.error.message, '请改用视频生成接口，并传入分镜 ID 与帧参考');
  const videoBatchRes = mockResponse();
  videos.episodeBatch({ params: { episode_id: String(EPISODE_ID) }, body: {} }, videoBatchRes);
  assert.equal(videoBatchRes.body.error.message, '请改为对每个分镜单独调用视频生成接口');

  assert.notEqual(STORYBOARD_ID, DRAMA_ID);
  assert.notEqual(STORYBOARD_ID, EPISODE_ID);
  const polishDb = {
    prepare() {
      return {
        get() {
          return {
            id: STORYBOARD_ID,
            episode_id: EPISODE_ID,
            image_prompt: null,
            action: null,
            dialogue: null,
          };
        },
      };
    },
  };
  const polish = mockResponse();
  await storyboardRoutes(polishDb, silentLog).polishPrompt({ params: { id: String(STORYBOARD_ID) } }, polish);
  assert.equal(polish.statusCode, 400);
  assert.equal(polish.body.error.message, '该分镜暂无可优化的内容（画面提示词、动作和对白均为空）');
  assert.doesNotMatch(polish.body.error.message, /image_prompt|action|dialogue/);
  assert.equal(hasCjk(polish.body.error.message), true);

  const missingId = mockResponse();
  await storyboardRoutes({}, silentLog).regenerateLayoutDescription({ params: {} }, missingId);
  assert.equal(missingId.statusCode, 400);
  assert.equal(missingId.body.error.message, '缺少分镜 ID');
  assert.equal(missingId.body.error.message.includes('缺少分镜 id'), false);

  const invalidSplit = mockResponse();
  storyboardRoutes({}, silentLog).splitByAudio({ params: { id: '-1' } }, invalidSplit);
  assert.equal(invalidSplit.statusCode, 400);
  assert.equal(invalidSplit.body.error.message, '无效的分镜 ID');
  assert.doesNotMatch(invalidSplit.body.error.message, /分镜 id/);
  assert.equal(isTrustedChineseUserError(invalidSplit.body.error.message), true);

  const lockedBulk = mockResponse();
  aiConfigRoutes({}, silentLog, { vendor_lock: { enabled: true } }).bulkUpdateKey({ body: {} }, lockedBulk);
  assert.equal(lockedBulk.statusCode, 400);
  assert.equal(lockedBulk.body.error.message, '请提供新的密钥');
  assert.doesNotMatch(lockedBulk.body.error.message, /API Key|api_key/);
  assert.equal(isTrustedChineseUserError(lockedBulk.body.error.message), true);

  assert.throws(
    () => klingJwt.signKlingOfficialJwt('', 'secret'),
    (error) => {
      assert.equal(error.message, '可灵官方访问密钥和签名密钥不能为空');
      assert.doesNotMatch(error.message, /AccessKey|SecretKey/);
      assert.equal(isTrustedChineseUserError(error.message), true);
      return true;
    },
  );

  const sourceIntakeSource = fs.readFileSync(path.join(__dirname, '../src/services/sourceIntakeService.js'), 'utf8');
  assert.match(sourceIntakeSource, /改编方案覆盖后，该分镜已过期/);
  assert.equal(sourceIntakeSource.includes('stale after adaptation overwrite'), false);

  const protocolSource = fs.readFileSync(path.join(__dirname, '../src/services/videoGateway/protocolDispatch.js'), 'utf8');
  assert.match(protocolSource, /Sora 当前不支持尾帧参考，请移除尾帧/);
  assert.equal(protocolSource.includes('请移除 last_frame_url'), false);

  const comfySource = fs.readFileSync(path.join(__dirname, '../src/services/comfyUiClient.js'), 'utf8');
  assert.match(comfySource, /ComfyUI 任务提交未返回任务编号/);
  assert.equal(comfySource.includes('未返回 prompt_id'), false);
});
