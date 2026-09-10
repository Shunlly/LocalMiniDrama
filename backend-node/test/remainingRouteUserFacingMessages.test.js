const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const os = require('node:os');

const promptOverrides = require('../src/routes/promptOverrides');
const { publicErrorMessage, uploadFormErrorMessage } = require('../src/routes/serviceFailure');
const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');
const assetRoutes = require('../src/routes/assets');

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

describe('剩余路由对用户返回中文错误', () => {
  it('源码不再把 err.message 直接交给 internalError', () => {
    const dir = path.join(__dirname, '../src/routes');
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      assert.equal(source.includes('response.internalError(res, err.message)'), false, file);
      assert.equal(source.includes('response.internalError(res, err.message ||'), false, file);
      assert.equal(source.includes('response.badRequest(res, err.message)'), false, file);
      assert.equal(source.includes('response.badRequest(res, err.message ||'), false, file);
      assert.equal(source.includes("writeNd({ type: 'error', message: err.message"), false, file);
      assert.equal(source.includes('response.notFound(res, err.message)'), false, file);
    }
  });

  it('素材列表失败映射为中文，不回传 SQLITE 英文', () => {
    const silent = { error() {} };
    const res = mockRes();
    assetRoutes({
      prepare() { throw new Error('SQLITE_ERROR: no such table: assets'); },
    }, silent).list({ query: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(hasCjk(res.body.error.message), true);
    assert.doesNotMatch(res.body.error.message, /SQLITE_ERROR|no such table/i);
  });

  it('夹杂英文字段名的中文错误不会直接回给用户', () => {
    assert.equal(isTrustedChineseUserError('drama_id 必填'), false);
    assert.equal(isTrustedChineseUserError('prompt 不能为空'), false);
    assert.equal(isTrustedChineseUserError('项目 ID 必填'), true);
    assert.equal(publicErrorMessage({ message: 'drama_id 必填' }, '请求参数无效'), '请求参数无效');
    assert.equal(publicErrorMessage({ message: '项目 ID 必填' }, '请求参数无效'), '项目 ID 必填');
  });

  it('上传表单错误码映射为中文，不回传 multer 英文', () => {
    assert.equal(uploadFormErrorMessage({ code: 'LIMIT_UNEXPECTED_FILE', message: 'Unexpected field' }, '上传失败'), '不支持的上传字段，请按页面提示选择文件');
    assert.equal(uploadFormErrorMessage({ message: 'Unexpected field' }, 'ZIP 上传失败，请更换文件后重试'), 'ZIP 上传失败，请更换文件后重试');
    assert.equal(uploadFormErrorMessage({ message: '请上传 TXT 文本文件' }, '素材导入失败，请更换文件后重试'), '请上传 TXT 文本文件');
  });

  it('提示词覆盖未知 key 和空内容是中文', () => {
    const silent = { error() {}, info() {} };
    const routes = promptOverrides.routes({}, silent);
    const unknown = mockRes();
    routes.update({ params: { key: 'not-a-prompt' }, body: { content: 'x' } }, unknown);
    assert.equal(unknown.statusCode, 400);
    assert.match(unknown.body.error.message, /未知的提示词/);
    assert.doesNotMatch(unknown.body.error.message, /\bkey\b/i);

    const empty = mockRes();
    routes.update({ params: { key: 'story_expansion_system' }, body: { content: '   ' } }, empty);
    assert.equal(empty.statusCode, 400);
    assert.equal(hasCjk(empty.body.error.message), true);
    assert.doesNotMatch(empty.body.error.message, /^content /);
  });

  it('路由校验错误不再夹英文字段名', () => {
    const dir = path.join(__dirname, '../src/routes');
    const leftover = [
      '请提供 storyboard_id 或 text',
      'episode_id不能为空',
      'episode_id 必填',
      'character_ids 不能为空',
      'drama_id 和 name 必填',
      'storyboard_ids 不能为空',
      'characters 必填且为数组',
      'episodes 必填且为数组',
      'current_step 必填',
      '缺少resource_id参数',
      '缺少 drama_id',
      '缺少 scene_id',
      '缺少 library_id',
      '缺少必填字段: key',
      '缺少分镜 id',
      'image_prompt / action / dialogue',
      '该分镜暂无可优化的内容（image_prompt / action / dialogue 均为空）',
      'sharp 模块不可用',
      '批量换Key',
      '请提供新的 API Key',
      '条配置的 API Key',
      '无效的分镜 id',
      '提供 text 参数',
      '请改为调用 POST /api/v1/scenes/generate-image，并传入 scene_id',
      '请改为调用 POST /api/v1/scenes/generate-image，并传入场景 ID',
      '请改为调用 POST /api/v1/videos，并传入 storyboard_id 与帧参考',
      '请改为调用 POST /api/v1/videos，并传入分镜 ID 与帧参考',
      '请改为调用 POST /api/v1/episodes/:episode_id/finalize 启动 FFmpeg 合成',
      '请改为对每个分镜单独调用 POST /api/v1/images',
      '请改为对每个分镜单独调用 POST /api/v1/videos',
      'POST /api/v1/',
    ];
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const needle of leftover) {
        assert.equal(source.includes(needle), false, `${file} 仍包含：${needle}`);
      }
    }
  });

  it('停用的生图和视频快捷接口返回中文说明，不带 REST 路径', () => {
    const imageRoutes = require('../src/routes/images');
    const videoRoutes = require('../src/routes/videos');
    const silent = { error() {}, info() {}, warn() {} };
    const images = imageRoutes({}, {}, silent);
    const videos = videoRoutes({}, silent);
    function assertLegacyCopy(handler, req, message) {
      const res = mockRes();
      handler(req, res);
      assert.equal(res.statusCode, 501);
      assert.equal(res.body.error.code, 'LEGACY_ENDPOINT_DISABLED');
      assert.equal(res.body.error.message, message);
      assert.equal(isTrustedChineseUserError(message), true);
      assert.doesNotMatch(message, /\/api\/v1\/|POST \//);
      assert.doesNotMatch(message, /scene_id|storyboard_id|episode_id/);
    }
    assertLegacyCopy(images.scene, { params: { scene_id: '1' } }, '请改用场景生图接口，并传入场景 ID');
    assertLegacyCopy(images.episodeBatch, { params: { episode_id: '1' }, body: {} }, '请改为对每个分镜单独调用生图接口');
    assertLegacyCopy(videos.fromImage, { params: { image_gen_id: '1' }, body: {} }, '请改用视频生成接口，并传入分镜 ID 与帧参考');
    assertLegacyCopy(videos.episodeBatch, { params: { episode_id: '1' }, body: {} }, '请改为对每个分镜单独调用视频生成接口');
  });

  it('分镜缺 ID 和空内容优化返回简体中文', async () => {
    const silent = { error() {}, info() {}, warn() {} };
    const storyboardRoutes = require('../src/routes/storyboards');
    async function assertMissingStoryboardId(handler) {
      const res = mockRes();
      await handler({ params: {} }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.message, '缺少分镜 ID');
      assert.equal(res.body.error.message.includes('缺少分镜 id'), false);
      assert.equal(isTrustedChineseUserError(res.body.error.message), true);
    }
    const routes = storyboardRoutes({}, silent);
    await assertMissingStoryboardId(routes.regenerateLayoutDescription);
    await assertMissingStoryboardId(routes.rebuildVideoPrompt);
    await assertMissingStoryboardId(routes.splitByAudio);

    const invalidSplit = mockRes();
    routes.splitByAudio({ params: { id: '-1' } }, invalidSplit);
    assert.equal(invalidSplit.statusCode, 400);
    assert.equal(invalidSplit.body.error.message, '无效的分镜 ID');
    assert.doesNotMatch(invalidSplit.body.error.message, /分镜 id|storyboard_id/);
    assert.equal(isTrustedChineseUserError(invalidSplit.body.error.message), true);

    const storyboardId = 3301;
    const episodeId = 1101;
    assert.notEqual(storyboardId, episodeId);
    const polishDb = {
      prepare() {
        return {
          get() {
            return {
              id: storyboardId,
              episode_id: episodeId,
              image_prompt: null,
              action: null,
              dialogue: null,
            };
          },
        };
      },
    };
    const polish = mockRes();
    await storyboardRoutes(polishDb, silent).polishPrompt({ params: { id: String(storyboardId) } }, polish);
    assert.equal(polish.statusCode, 400);
    assert.equal(polish.body.error.message, '该分镜暂无可优化的内容（画面提示词、动作和对白均为空）');
    assert.doesNotMatch(polish.body.error.message, /image_prompt|action|dialogue/);
    assert.equal(isTrustedChineseUserError(polish.body.error.message), true);
  });
});

const Database = require('better-sqlite3');
const { sendMappedServiceFailure, sendCaughtRouteError } = require('../src/routes/serviceFailure');
const settingsRoutes = require('../src/routes/settings');
const aiConfigRoutes = require('../src/routes/aiConfig');
const aiConfigService = require('../src/services/aiConfigService');
const sceneService = require('../src/services/sceneService');
const characterLibraryService = require('../src/services/characterLibraryService');
const { fetchWebSource } = require('../src/services/webSourceImportService');
const { callModelArkAsset } = require('../src/services/modelArkAssetProxyService');
const jimengMaterialHubService = require('../src/services/jimengMaterialHubService');
const { validateFreeCanvas } = require('../src/services/freeCanvasValidation');
const { toUserFacingProcessError } = require('../src/services/providerErrorSanitizer');
const assetService = require('../src/services/assetService');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

function assertUserFacingChinese(message) {
  assert.equal(hasCjk(message), true);
  assert.doesNotMatch(String(message), /SQLITE_|ENOENT|sk-|unauthorized|ECONNREFUSED|ENOTFOUND|character not found|scene not found|prop not found|base_url|free_canvas|http_method/i);
}

describe('剩余服务对用户返回中文错误', () => {
  it('服务层中英文 not-found 都映射为 404 中文，而不会降成 400', () => {
    for (const error of ['character not found', '角色不存在', 'scene not found', '场景不存在', 'prop not found', '道具不存在']) {
      const res = mockRes();
      assert.equal(sendMappedServiceFailure(res, { ok: false, error }), true);
      assert.equal(res.statusCode, 404, error);
      assertUserFacingChinese(res.body.error.message);
    }
    const unauthorized = mockRes();
    assert.equal(sendMappedServiceFailure(unauthorized, { ok: false, error: '无权限' }), true);
    assert.equal(unauthorized.statusCode, 404);
    assert.match(unauthorized.body.error.message, /剧集不存在或无权限|无权限/);
    const forbidden = mockRes();
    assert.equal(sendMappedServiceFailure(forbidden, { ok: false, error: 'unauthorized' }, { unauthorizedAsForbidden: true }), true);
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.body.error.message, '无权限');
  });

  it('跨项目 ID 不相等时场景服务返回中文不存在而不是英文', () => {
    const dramaId = 11;
    const otherDramaId = 22;
    const sceneId = 11002;
    assert.notEqual(dramaId, otherDramaId);
    assert.notEqual(dramaId, sceneId);
    const db = new Database(':memory:');
    try {
      runMigrationsAndEnsure(db);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO dramas (id, title, status, created_at, updated_at, deleted_at)
         VALUES (?, ?, 'draft', ?, ?, NULL)`
      ).run(dramaId, '可写项目', now, now);
      db.prepare(
        `INSERT INTO dramas (id, title, status, created_at, updated_at, deleted_at)
         VALUES (?, ?, 'draft', ?, ?, NULL)`
      ).run(otherDramaId, '其他项目', now, now);
      db.prepare(
        `INSERT INTO scenes (id, drama_id, location, status, created_at, updated_at, deleted_at)
         VALUES (?, ?, '本项目场景', 'draft', ?, ?, NULL)`
      ).run(sceneId, dramaId, now, now);
      const silent = { info() {}, warn() {}, error() {} };
      assert.deepEqual(sceneService.updateScene(db, silent, 999001, { location: '不存在' }), {
        ok: false,
        error: '场景不存在',
      });
      const missingCharacter = characterLibraryService.generateCharacterImage(db, silent, {}, 888001);
      assert.equal(missingCharacter.ok, false);
      assert.equal(missingCharacter.error, '角色不存在');
    } finally {
      db.close();
    }
  });

  it('网页导入不会把 ECONNREFUSED 等英文异常拼进用户错误', async () => {
    await assert.rejects(
      () => fetchWebSource('https://example.com/source', {
        resolver: async () => [{ address: '93.184.216.34' }],
        downloadImpl: async () => {
          const error = new Error('connect ECONNREFUSED 127.0.0.1:80');
          error.code = 'ECONNREFUSED';
          throw error;
        },
      }),
      (error) => {
        assert.equal(error.code, 'BAD_REQUEST');
        assertUserFacingChinese(error.message);
        assert.doesNotMatch(error.message, /ECONNREFUSED|127\.0\.0\.1/i);
        return true;
      },
    );
  });

  it('即梦素材列表失败走 publicErrorMessage，不回传英文原句', async () => {
    const originalGet = aiConfigService.getConfig;
    const originalList = jimengMaterialHubService.listAssets;
    aiConfigService.getConfig = () => ({
      id: 11,
      base_url: 'https://hub.example/v1',
      api_key: 'token-value',
    });
    jimengMaterialHubService.listAssets = async () => ({
      ok: false,
      error: 'connect ECONNREFUSED 10.0.0.1:443',
    });
    try {
      const res = mockRes();
      await aiConfigRoutes({}, { error() {} }).listJimeng2MaterialAssets(
        { body: { id: 11 }, providerNetworkPolicy: { trustedOrigins: ['https://hub.example/v1'] } },
        res,
      );
      assert.equal(res.statusCode, 400);
      assertUserFacingChinese(res.body.error.message);
      assert.doesNotMatch(res.body.error.message, /ECONNREFUSED|token-value|10\.0\.0\.1/i);
    } finally {
      aiConfigService.getConfig = originalGet;
      jimengMaterialHubService.listAssets = originalList;
    }
  });

  it('资产库缺少接口地址和素材 ID 返回可信中文', async () => {
    await assert.rejects(
      () => callModelArkAsset({ action: 'ListAssets' }),
      (error) => {
        assertUserFacingChinese(error.message);
        assert.match(error.message, /接口地址/);
        assert.doesNotMatch(error.message, /base_url|action|http_method/);
        return true;
      },
    );
    await assert.rejects(
      () => callModelArkAsset({ base_url: 'https://ark.example/api/v3', action: 'Nope', api_key: 'k' }),
      (error) => {
        assertUserFacingChinese(error.message);
        assert.match(error.message, /不支持的资产库操作/);
        assert.doesNotMatch(error.message, /\baction\b/);
        return true;
      },
    );
    const missingAsset = await jimengMaterialHubService.getAsset({ baseUrl: 'https://hub.example', token: 't' }, '');
    assert.equal(missingAsset.ok, false);
    assert.equal(missingAsset.error, '缺少素材 ID');
    assert.doesNotMatch(missingAsset.error, /asset id/i);
  });

  it('批量换密钥缺密钥返回中文，不含 API Key 字段名', () => {
    const res = mockRes();
    aiConfigRoutes({}, { error() {} }, { vendor_lock: { enabled: true } }).bulkUpdateKey({ body: { api_key: '  ' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.message, '请提供新的密钥');
    assert.doesNotMatch(res.body.error.message, /API Key|api_key/);
    assert.equal(isTrustedChineseUserError(res.body.error.message), true);
  });

  it('连接测试缺少接口地址或模型返回中文，不含英文字段名', async () => {
    await assert.rejects(
      () => aiConfigService.testConnection({ provider: 'openai' }),
      (error) => {
        assertUserFacingChinese(error.message);
        assert.doesNotMatch(error.message, /base_url|model 必填/);
        return true;
      },
    );
    await assert.rejects(
      () => aiConfigService.testConnection({
        provider: 'gemini',
        base_url: 'https://generativelanguage.googleapis.com',
        api_key: 'test-key',
      }),
      (error) => {
        assert.equal(error.message, '请填写模型名称');
        assertUserFacingChinese(error.message);
        return true;
      },
    );
  });

  it('自由画布校验错误是可操作中文，sendCaughtRouteError 会保留具体原因', () => {
    try {
      validateFreeCanvas(null, 1, null);
      assert.fail('should throw');
    } catch (error) {
      assert.equal(error.code, 'BAD_REQUEST');
      assert.equal(isTrustedChineseUserError(error.message), true);
      assert.match(error.message, /自由画布必须为对象/);
      const res = mockRes();
      sendCaughtRouteError(res, error, '保存画布布局失败');
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.message, '自由画布必须为对象');
    }
  });

  it('素材字段校验不再夹杂 url/category 英文字段名', () => {
    const db = new Database(':memory:');
    try {
      runMigrationsAndEnsure(db);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO dramas (id, title, status, created_at, updated_at, deleted_at)
         VALUES (11, '可写项目', 'draft', ?, ?, NULL)`
      ).run(now, now);
      assert.throws(
        () => assetService.create(db, { warn() {} }, { drama_id: 11, url: 123 }),
        (error) => {
          assert.equal(error.code, 'BAD_REQUEST');
          assertUserFacingChinese(error.message);
          assert.doesNotMatch(error.message, /\burl\b|category/);
          return true;
        },
      );
    } finally {
      db.close();
    }
  });

  it('语言切换成功文案是中文', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-lang-'));
    const configPath = path.join(tmp, 'config.yaml');
    fs.writeFileSync(configPath, 'app:\n  language: zh\n');
    const previous = process.env.LOCALMINIDRAMA_CONFIG_PATH;
    process.env.LOCALMINIDRAMA_CONFIG_PATH = configPath;
    try {
      const res = mockRes();
      settingsRoutes({}, { app: { language: 'zh' } }, { operation() {}, warnw() {}, infow() {} })
        .updateLanguage({ body: { language: 'en' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.message, '语言已切换为英文');
      assert.doesNotMatch(res.body.data.message, /Language switched/i);
    } finally {
      if (previous == null) delete process.env.LOCALMINIDRAMA_CONFIG_PATH;
      else process.env.LOCALMINIDRAMA_CONFIG_PATH = previous;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('生产失败文案会清洗英文异常，不会把 sk- 或 ECONNREFUSED 存进用户错误', () => {
    const wrapped = toUserFacingProcessError(new Error('connect ECONNREFUSED 127.0.0.1:443'), '请检查图片服务配置后重试');
    assert.equal(wrapped, '请检查图片服务配置后重试');
    assert.doesNotMatch(
      toUserFacingProcessError(new Error('Invalid API key sk-secret-value'), '请检查图片服务配置后重试'),
      /sk-secret/,
    );
    const source = fs.readFileSync(path.join(__dirname, '../src/services/providerSdkService.js'), 'utf8');
    assert.match(source, /toUserFacingProcessError\(error/);
    assert.equal(source.includes("error.message || '未知错误'"), false);
  });
});
