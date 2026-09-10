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
const { buildProviderErrorMessage, toSafeProviderErrorMessage } = require('../src/services/providerErrorSanitizer');

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
  'ModelArk 返回缺少资产 Id',
  '填写 Token',
  '缺少分镜 id',
  'image_prompt / action / dialogue',
  '该分镜暂无可优化的内容（image_prompt / action / dialogue 均为空）',
  '请改为调用 POST /api/v1/scenes/generate-image，并传入 scene_id',
  '请改为调用 POST /api/v1/videos，并传入 storyboard_id 与帧参考',
  '请改为调用 POST /api/v1/episodes/:episode_id/finalize 启动 FFmpeg 合成',
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

test('图片和视频幂等冲突返回不含英文字段名的中文', () => {
  const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');
  assert.equal(isTrustedChineseUserError('该幂等键属于其他项目或分镜'), true);
  assert.equal(isTrustedChineseUserError('该幂等键指向已删除的视频记录，请使用新的幂等键'), true);
  assert.equal(isTrustedChineseUserError('该幂等键指向已删除的图片记录，请使用新的幂等键'), true);
  assert.equal(isTrustedChineseUserError('参考图列表必须是数组'), true);
  assert.equal(isTrustedChineseUserError('项目文件格式不正确：缺少剧名'), true);
  const trustedImportMessages = [
    '自由画布导入数据必须为对象',
    '自由画布导入清单版本不受支持',
    '自由画布导入剧集列表无法映射',
    '自由画布导入分镜列表无法映射',
    '自由画布导入源项目与画布项目引用不一致',
    '自由画布导入媒体包含重复归档路径',
    '自由画布导入媒体哈希校验失败',
    '旧版 ZIP 自由画布包含无法验证的引用，缺少导入清单',
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
  for (const message of trustedImportMessages) {
    assert.equal(importSource.includes(message), true, message);
  }
});

test('videoClient 用户错误不再是问号乱码', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/videoClient.js'), 'utf8');
  const pollSource = fs.readFileSync(path.join(__dirname, '../src/services/videoGateway/pollDispatch.js'), 'utf8');
  const userFacing = [source, pollSource].join('\n')
    .split('\n')
    .filter((line) => /throw new Error\(|return \{ error:/.test(line))
    .join('\n');
  assert.equal(userFacing.includes('??????'), false);
  assert.match(source, /请先在 AI 配置中添加并启用视频服务/);
  assert.match(pollSource, /Vidu 任务完成但未返回视频地址/);
  assert.match(pollSource, /Gemini 任务完成但未返回视频地址/);
  assert.match(source, /视频生成超时，请稍后重试/);
  assert.match(source, /视频任务已取消/);
  assert.equal(source.includes('throw signal.reason'), false);
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
    '该分镜暂无可优化的内容（image_prompt / action / dialogue 均为空）',
    'episode_id 必填',
    '缺少resource_id参数',
    '请改为调用 POST /api/v1/episodes/:episode_id/finalize 启动 FFmpeg 合成',
    '请改为调用 POST /api/v1/videos，并传入 storyboard_id 与帧参考',
  ];
  const files = [
    'routes/audio.js', 'routes/characters.js', 'routes/drama.js', 'routes/images.js',
    'routes/index.js', 'routes/prop.js', 'routes/sceneModelMap.js', 'routes/scenes.js',
    'routes/storyboards.js', 'routes/task.js', 'routes/videoMerges.js', 'routes/videos.js',
  ];
  for (const name of files) {
    const source = fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
    for (const phrase of leftoverMixedFieldErrors) {
      assert.equal(source.includes(phrase), false, `${name} 仍包含：${phrase}`);
    }
  }

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
});
