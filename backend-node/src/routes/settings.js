const settingsService = require('../services/settingsService');
const response = require('../response');
const { loadConfig } = require('../config');
const { resolveVideoGenerationTimeoutMinutes } = require('../config/videoGeneration');
const backupSettingsService = require('../services/backupSettingsService');

function getLanguage(cfg) {
  return (req, res) => {
    const language = settingsService.getLanguage(cfg);
    response.success(res, { language });
  };
}

function updateLanguage(cfg, log) {
  return (req, res) => {
    const lang = req.body?.language;
    if (lang !== 'zh' && lang !== 'en') {
      return response.badRequest(res, '语言参数错误，只支持 zh 或 en');
    }
    try {
      const out = settingsService.updateLanguage(cfg, log, lang);
      if (!out.ok) return response.badRequest(res, out.error);
      log?.operation?.({
        operation: 'settings_language_update',
        phase: 'success',
        language: lang,
      });
      const message = lang === 'en' ? 'Language switched to English' : '语言已切换为中文';
      response.success(res, { message, language: lang });
    } catch (err) {
      log?.operation?.({
        operation: 'settings_language_update',
        phase: 'error',
        error: err.message,
      });
      const permissionDenied = ['EACCES', 'EPERM', 'EROFS', 'CONFIG_FILE_NOT_FOUND'].includes(String(err.code || ''));
      if (permissionDenied) {
        return response.error(
          res,
          503,
          err.code === 'CONFIG_FILE_NOT_FOUND' ? 'CONFIG_FILE_NOT_FOUND' : 'PERMISSION_DENIED',
          '语言设置未能写入配置文件，请检查配置路径和写权限'
        );
      }
      return response.internalError(res, '语言设置保存失败');
    }
  };
}

/** GET /settings/generation — 获取生成相关全局设置 */
function getGenerationSettings(db) {
  return (req, res) => {
    const concurrency = settingsService.getGlobalSetting(db, 'pipeline_concurrency', 3);
    const video_concurrency = settingsService.getGlobalSetting(db, 'pipeline_video_concurrency', 3);
    const video_generation_timeout_minutes = resolveVideoGenerationTimeoutMinutes(loadConfig());
    response.success(res, { concurrency, video_concurrency, video_generation_timeout_minutes });
  };
}

/** PUT /settings/generation — 更新生成相关全局设置 */
function updateGenerationSettings(db) {
  return (req, res) => {
    const { concurrency, video_concurrency } = req.body || {};
    let concurrencyValue;
    let videoConcurrencyValue;

    if (concurrency !== undefined) {
      const n = Number(concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return response.badRequest(res, '图片并发数需为 1-20 之间的整数');
      }
      concurrencyValue = n;
    }
    if (video_concurrency !== undefined) {
      const n = Number(video_concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return response.badRequest(res, '视频并发数需为 1-20 之间的整数');
      }
      videoConcurrencyValue = n;
    }

    const updates = {};
    if (concurrencyValue !== undefined) {
      updates.pipeline_concurrency = concurrencyValue;
    }
    if (videoConcurrencyValue !== undefined) {
      updates.pipeline_video_concurrency = videoConcurrencyValue;
    }
    const video_generation_timeout_minutes = resolveVideoGenerationTimeoutMinutes(loadConfig());
    settingsService.setGlobalSettings(db, updates);

    const saved = settingsService.getGlobalSetting(db, 'pipeline_concurrency', 3);
    const saved_video = settingsService.getGlobalSetting(db, 'pipeline_video_concurrency', 3);
    response.success(res, {
      concurrency: saved,
      video_concurrency: saved_video,
      video_generation_timeout_minutes,
    });
  };
}

function sendBackupError(res, error, log, operation) {
  const mapped = backupSettingsService.describeBackupHttpError(error);
  log?.operation?.({
    operation,
    phase: 'error',
    code: mapped.code,
    error: error?.message,
  });
  return response.error(res, mapped.status, mapped.code, mapped.message);
}

function listBackups(cfg, log) {
  return async (req, res) => {
    try {
      const data = await backupSettingsService.listBackups(
        backupSettingsService.resolveRuntimeDataPaths(cfg),
      );
      log?.operation?.({ operation: 'backup_list', phase: 'success', count: data.items.length });
      return response.success(res, data);
    } catch (error) {
      return sendBackupError(res, error, log, 'backup_list');
    }
  };
}

function createBackup(cfg, log) {
  return async (req, res) => {
    try {
      const data = await backupSettingsService.createBackup(
        backupSettingsService.resolveRuntimeDataPaths(cfg),
        { log, signal: req.signal },
      );
      log?.operation?.({ operation: 'backup_create', phase: 'success', name: data.name });
      return response.created(res, data);
    } catch (error) {
      return sendBackupError(res, error, log, 'backup_create');
    }
  };
}

function restoreBackup(cfg, log) {
  return async (req, res) => {
    try {
      const uploadedName = req.file?.originalname || '';
      const uploadedPath = req.file?.path;
      const bodyName = req.body?.name;
      const confirmed = req.body?.confirmed === true || req.body?.confirmed === 'true';
      const paths = backupSettingsService.resolveRuntimeDataPaths(cfg);
      let name = bodyName;
      if (uploadedPath) {
        const backupDir = backupSettingsService.resolveBackupDir(paths);
        await require('node:fs/promises').mkdir(backupDir, { recursive: true });
        const safeName = backupSettingsService.buildBackupFileName();
        const dest = require('node:path').join(backupDir, safeName);
        await require('node:fs/promises').rename(uploadedPath, dest);
        name = safeName;
        log?.operation?.({
          operation: 'backup_restore_upload',
          phase: 'success',
          originalName: uploadedName,
          name: safeName,
        });
      }
      const data = await backupSettingsService.stagePendingRestore(paths, { name, confirmed });
      log?.operation?.({ operation: 'backup_restore', phase: 'success', name: data.name });
      return response.success(res, data);
    } catch (error) {
      if (req.file?.path) {
        await require('node:fs/promises').rm(req.file.path, { force: true }).catch(() => {});
      }
      return sendBackupError(res, error, log, 'backup_restore');
    }
  };
}

module.exports = function settingsRoutes(db, cfg, log) {
  return {
    getLanguage: getLanguage(cfg),
    updateLanguage: updateLanguage(cfg, log),
    getGenerationSettings: getGenerationSettings(db),
    updateGenerationSettings: updateGenerationSettings(db),
    listBackups: listBackups(cfg, log),
    createBackup: createBackup(cfg, log),
    restoreBackup: restoreBackup(cfg, log),
  };
};
