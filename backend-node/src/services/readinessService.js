const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const aiConfigService = require('./aiConfigService');
const { assertServiceMaintenanceLockActiveSync } = require('./dataBackupService');
const { validateFfmpegTools } = require('../utils/ffmpegPath');

const NOVEL2ANIME_CAPABILITIES = Object.freeze([
  { key: 'text', label: '文本模型', serviceType: 'text', purpose: '素材改编与脚本结构化' },
  { key: 'asset_image', label: '角色 / 场景 / 道具图片', serviceType: 'image', purpose: '建立可用于制作的视觉资产' },
  { key: 'image', label: '分镜图像', serviceType: 'storyboard_image', purpose: '生成正式分镜图片' },
  { key: 'video', label: '视频生成', serviceType: 'video', purpose: '生成正式分镜视频' },
  { key: 'tts', label: '语音合成', serviceType: 'tts', purpose: '生成对白与旁白音频' },
  { key: 'ffmpeg', label: 'FFmpeg / FFprobe', serviceType: '', purpose: '校验媒体并合成成片' },
]);

const MODEL_OPTIONAL_SERVICE_PROTOCOLS = new Set([
  'image:comfyui',
  'storyboard_image:comfyui',
]);

function runDatabaseRollbackProbe(db) {
  const marker = `__localminidrama_ready_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const savepoint = `localminidrama_ready_${randomUUID().replaceAll('-', '')}`;
  let savepointActive = false;
  try {
    const table = db.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'dramas'"
    ).get();
    if (table?.ok !== 1) throw new Error('required database schema is unavailable');

    db.exec(`SAVEPOINT ${savepoint}`);
    savepointActive = true;
    const result = db.prepare(
      'INSERT INTO dramas (title, status, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(marker, 'draft', marker, createdAt, createdAt);
    if (result.changes !== 1) throw new Error('database write probe did not insert one row');
    const inserted = db.prepare(
      'SELECT id FROM dramas WHERE title = ? AND metadata = ?'
    ).get(marker, marker);
    if (!inserted?.id) throw new Error('database write probe could not read its row');

    db.exec(`ROLLBACK TO ${savepoint}`);
    db.exec(`RELEASE ${savepoint}`);
    savepointActive = false;
    const residual = db.prepare(
      'SELECT 1 AS present FROM dramas WHERE title = ? AND metadata = ? LIMIT 1'
    ).get(marker, marker);
    if (residual) throw new Error('database write probe left persistent data');
  } catch (error) {
    if (savepointActive) {
      try { db.exec(`ROLLBACK TO ${savepoint}`); } catch (_) {}
      try { db.exec(`RELEASE ${savepoint}`); } catch (_) {}
    }
    throw error;
  }
}

function runStorageWriteProbe(storageRoot, fileSystem) {
  const probePath = path.join(
    storageRoot,
    `.localminidrama-ready-${process.pid}-${randomUUID()}.tmp`
  );
  const constants = fileSystem.constants || fs.constants;
  const noFollow = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollow;
  const payload = Buffer.from('localminidrama-readiness-probe\n', 'utf8');
  let fd;
  let primaryError = null;
  try {
    fd = fileSystem.openSync(probePath, flags, 0o600);
    let offset = 0;
    while (offset < payload.length) {
      const written = fileSystem.writeSync(fd, payload, offset, payload.length - offset, offset);
      if (!Number.isInteger(written) || written <= 0) throw new Error('storage write probe stopped early');
      offset += written;
    }
    fileSystem.fsyncSync(fd);
  } catch (error) {
    primaryError = error;
  } finally {
    if (fd !== undefined) {
      try { fileSystem.closeSync(fd); } catch (error) { primaryError ||= error; }
    }
    try { fileSystem.unlinkSync(probePath); } catch (error) {
      if (error?.code !== 'ENOENT') primaryError ||= error;
    }
  }
  if (primaryError) throw primaryError;
}

function checkReadiness(db, storageRoot, options = {}) {
  const fileSystem = options.fs || fs;
  const checks = {
    database: { ok: false },
    storage: { ok: false },
    maintenance: { ok: false },
  };

  try {
    const row = db.prepare('SELECT 1 AS ok').get();
    if (row?.ok !== 1) {
      checks.database.error = '数据库查询失败';
    } else {
      runDatabaseRollbackProbe(db);
      checks.database.ok = true;
    }
  } catch (_) {
    checks.database.ok = false;
    checks.database.error = '数据库不可用';
  }

  try {
    const stat = fileSystem.lstatSync(storageRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('not a regular directory');
    fileSystem.accessSync(storageRoot, fileSystem.constants.R_OK | fileSystem.constants.W_OK);
    runStorageWriteProbe(storageRoot, fileSystem);
    checks.storage.ok = true;
  } catch (_) {
    checks.storage.ok = false;
    checks.storage.error = '存储目录不可用';
  }

  try {
    const assertLease = options.assertMaintenanceLease || assertServiceMaintenanceLockActiveSync;
    assertLease(options.maintenanceGuard);
    checks.maintenance.ok = true;
  } catch (_) {
    checks.maintenance.ok = false;
    checks.maintenance.error = '维护租约不可用';
  }

  return {
    ready: checks.database.ok && checks.storage.ok && checks.maintenance.ok,
    checks,
  };
}

function workflowMode(params = {}) {
  return params.qa_mode === 'production' || params.mode === 'production' ? 'production' : 'draft';
}

function configModel(config) {
  if (!config) return '';
  const normalized = aiConfigService.normalizeConfigModels(config);
  return normalized.default_model || normalized.model[0] || '';
}

function configModels(config) {
  if (!config) return [];
  const normalized = aiConfigService.normalizeConfigModels(config);
  return [...normalized.model, normalized.default_model].filter(Boolean);
}

function selectedWorkflowOption(params, key) {
  const workflowOptions = params?.options && typeof params.options === 'object' ? params.options : {};
  return String(workflowOptions[key] ?? params?.[key] ?? '').trim();
}

function matchesWorkflowSelection(config, model, provider) {
  if (!config) return null;
  const selectedProvider = String(provider || '').trim().toLowerCase();
  if (selectedProvider && String(config.provider || '').trim().toLowerCase() !== selectedProvider) return null;
  const selectedModel = String(model || '').trim();
  if (selectedModel && !configModels(config).includes(selectedModel)) return null;
  return config;
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function hasComfyWorkflow(config) {
  const settings = parseObject(config?.settings);
  const nested = parseObject(settings.comfyui);
  const workflow = nested.workflow
    ?? nested.workflow_json
    ?? nested.workflow_template
    ?? settings.workflow
    ?? settings.workflow_json
    ?? settings.workflow_template
    ?? config?.workflow;
  return Object.keys(parseObject(workflow)).length > 0;
}

function isComfyUiImageConfig(config) {
  if (!config) return false;
  const serviceType = String(config.service_type || '').trim().toLowerCase().replace(/-/g, '_');
  const protocol = String(config.api_protocol || config.provider || '').trim().toLowerCase().replace(/-/g, '_');
  return ['image', 'storyboard_image'].includes(serviceType)
    && ['comfyui', 'comfy_ui'].includes(protocol);
}

function isModelOptionalServiceConfig(config) {
  if (!config) return false;
  const serviceType = String(config.service_type || '').trim().toLowerCase().replace(/-/g, '_');
  const protocol = String(config.api_protocol || config.provider || '').trim().toLowerCase().replace(/-/g, '_');
  return MODEL_OPTIONAL_SERVICE_PROTOCOLS.has(`${serviceType}:${protocol}`) && hasComfyWorkflow(config);
}

function serviceConfigReadiness(config) {
  if (!config) {
    return {
      ready: false,
      issue: 'missing_config',
      model: '',
      modelOptional: false,
      credentialOptional: false,
      credentialSet: false,
    };
  }
  const model = configModel(config);
  const normalizedModels = aiConfigService.normalizeConfigModels(config);
  const defaultModelReady = !normalizedModels.default_model
    || normalizedModels.model.includes(normalizedModels.default_model);
  const modelOptional = isModelOptionalServiceConfig(config);
  const credentialOptional = aiConfigService.isApiKeyOptionalConnection(config);
  const credentialSet = aiConfigService.hasStoredCredentials(config);
  const protocolReady = !isComfyUiImageConfig(config) || hasComfyWorkflow(config);
  const modelReady = Boolean(model) || modelOptional;
  const credentialReady = credentialOptional || credentialSet;
  return {
    ready: protocolReady && defaultModelReady && modelReady && credentialReady,
    issue: !protocolReady
      ? 'missing_workflow'
      : (!defaultModelReady
          ? 'invalid_default_model'
          : (!modelReady ? 'missing_model' : (!credentialReady ? 'missing_credentials' : ''))),
    model,
    modelOptional,
    credentialOptional,
    credentialSet,
  };
}

function configSummary(config) {
  if (!config) return null;
  return {
    id: config.id,
    service_type: config.service_type,
    name: String(config.name || '').trim(),
    provider: String(config.provider || '').trim(),
    model: configModel(config),
  };
}

function resolveActiveServiceConfig(db, serviceType, selectedModel, selectedProvider, fallbackServiceType = '') {
  let configs = aiConfigService.listConfigs(db, serviceType);
  if (configs.length === 0 && fallbackServiceType) {
    configs = aiConfigService.listConfigs(db, fallbackServiceType);
  }
  configs = configs.filter((config) => config.is_active);
  if (selectedProvider) {
    const normalizedProvider = String(selectedProvider).trim().toLowerCase();
    configs = configs.filter((config) => (
      String(config.provider || '').trim().toLowerCase() === normalizedProvider
    ));
  }
  if (selectedModel) {
    const normalizedModel = String(selectedModel).trim();
    return configs.find((config) => configModels(config).includes(normalizedModel)) || null;
  }
  return configs.find((config) => config.is_default) || configs[0] || null;
}

function getActiveTtsConfig(db, params = {}) {
  return resolveActiveServiceConfig(
    db,
    'tts',
    selectedWorkflowOption(params, 'tts_model'),
    selectedWorkflowOption(params, 'tts_provider'),
  );
}

function resolveWorkflowConfigs(db, params, options) {
  const textModel = selectedWorkflowOption(params, 'text_model');
  const textProvider = selectedWorkflowOption(params, 'text_provider');
  const imageModel = selectedWorkflowOption(params, 'image_model');
  const imageProvider = selectedWorkflowOption(params, 'image_provider');
  const assetImageModel = selectedWorkflowOption(params, 'asset_image_model');
  const assetImageProvider = selectedWorkflowOption(params, 'asset_image_provider');
  const videoModel = selectedWorkflowOption(params, 'video_model');
  const videoProvider = selectedWorkflowOption(params, 'video_provider');
  const ttsModel = selectedWorkflowOption(params, 'tts_model');
  const ttsProvider = selectedWorkflowOption(params, 'tts_provider');
  const resolveTextConfig = options.resolveTextConfig || ((database) => (
    resolveActiveServiceConfig(database, 'text', textModel, textProvider)
  ));
  const resolveImageConfig = options.resolveImageConfig || ((database) => (
    resolveActiveServiceConfig(database, 'storyboard_image', imageModel, imageProvider, 'image')
  ));
  const resolveAssetImageConfig = options.resolveAssetImageConfig || ((database) => (
    resolveActiveServiceConfig(database, 'image', assetImageModel, assetImageProvider)
  ));
  const resolveVideoConfig = options.resolveVideoConfig || ((database) => (
    resolveActiveServiceConfig(database, 'video', videoModel, videoProvider)
  ));
  const resolveTtsConfig = options.resolveTtsConfig || getActiveTtsConfig;

  return {
    text: matchesWorkflowSelection(resolveTextConfig(db, params), textModel, textProvider),
    asset_image: matchesWorkflowSelection(resolveAssetImageConfig(db, params), assetImageModel, assetImageProvider),
    image: matchesWorkflowSelection(resolveImageConfig(db, params), imageModel, imageProvider),
    video: matchesWorkflowSelection(resolveVideoConfig(db, params), videoModel, videoProvider),
    tts: matchesWorkflowSelection(resolveTtsConfig(db, params), ttsModel, ttsProvider),
  };
}

function assertDramaExists(db, params) {
  const dramaId = Number(params.drama_id || params.dramaId);
  if (!Number.isSafeInteger(dramaId) || dramaId <= 0) {
    const error = new Error('drama_id 必填，且必须指向未删除的项目');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  const drama = db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
  if (!drama) {
    const error = new Error('drama_id 必填，且必须指向未删除的项目');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  return dramaId;
}

function checkNovel2AnimeReadiness(db, params = {}, options = {}) {
  const dramaId = assertDramaExists(db, params);
  const qaMode = workflowMode(params);
  const production = qaMode === 'production';
  const configs = resolveWorkflowConfigs(db, params, options);
  const validateMediaTools = options.validateMediaTools || validateFfmpegTools;
  const mediaTools = validateMediaTools();

  const capabilities = NOVEL2ANIME_CAPABILITIES.map((definition) => {
    const required = production;
    if (definition.key === 'ffmpeg') {
      const ready = Boolean(mediaTools?.ok);
      return {
        key: definition.key,
        label: definition.label,
        service_type: definition.serviceType,
        purpose: definition.purpose,
        required,
        ready,
        issue: ready ? '' : 'missing_media_tools',
        detail: ready
          ? 'FFmpeg 与 FFprobe 可用'
          : '未检测到可用的 FFmpeg 与 FFprobe',
        tools: {
          ffmpeg: Boolean(mediaTools?.ffmpeg?.ok),
          ffprobe: Boolean(mediaTools?.ffprobe?.ok),
        },
      };
    }

    const config = configs[definition.key] || null;
    const configReadiness = serviceConfigReadiness(config);
    const ready = configReadiness.ready;
    const summary = configSummary(config);
    const selected = [summary?.name || summary?.provider, summary?.model].filter(Boolean).join(' / ');
    return {
      key: definition.key,
      label: definition.label,
      service_type: definition.serviceType,
      purpose: definition.purpose,
      required,
      ready,
      issue: configReadiness.issue,
      detail: ready
        ? configReadiness.modelOptional
          ? '已配置无需单独模型字段的协议工作流'
          : `已选择 ${selected}`
        : configReadiness.issue === 'missing_model'
          ? `${definition.label}配置存在，但未选择可用模型`
          : configReadiness.issue === 'invalid_default_model'
            ? `${definition.label}配置的默认模型不在可用模型列表中，请在 AI 配置中重新选择默认模型`
          : configReadiness.issue === 'missing_workflow'
            ? `${definition.label}配置缺少 ComfyUI workflow 模板`
          : configReadiness.issue === 'missing_credentials'
            ? `${definition.label}配置缺少生产凭据`
            : `缺少启用的${definition.label}配置`,
      config: summary,
    };
  });
  const missingCapabilities = capabilities
    .filter((capability) => capability.required && !capability.ready)
    .map((capability) => ({
      key: capability.key,
      label: capability.label,
      service_type: capability.service_type,
      issue: capability.issue,
      detail: capability.detail,
    }));

  return {
    workflow_type: 'novel2anime',
    drama_id: dramaId,
    qa_mode: qaMode,
    ready: missingCapabilities.length === 0,
    capabilities,
    missing_capabilities: missingCapabilities,
    checked_at: new Date().toISOString(),
  };
}

function assertNovel2AnimeReadiness(db, params = {}, options = {}) {
  const readiness = checkNovel2AnimeReadiness(db, params, options);
  if (readiness.ready) return readiness;
  const labels = readiness.missing_capabilities.map((item) => item.label).join('、');
  const error = new Error(`Production 启动条件未满足：${labels}`);
  error.code = 'WORKFLOW_NOT_READY';
  error.status = 409;
  error.details = readiness;
  throw error;
}

module.exports = {
  checkReadiness,
  checkNovel2AnimeReadiness,
  assertNovel2AnimeReadiness,
  isModelOptionalServiceConfig,
  isComfyUiImageConfig,
  serviceConfigReadiness,
};
