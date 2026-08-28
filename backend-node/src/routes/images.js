const response = require('../response');
const imageService = require('../services/imageService');
const backgroundExtractionService = require('../services/backgroundExtractionService');

function routes(db, cfg, log) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const { items, total, page, pageSize } = imageService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('images list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    create: (req, res) => {
      try {
        const body = req.body || {};
        const rec = imageService.create(db, log, body);
        response.created(res, rec);
      } catch (err) {
        log.error('images create', { error: err.message });
        if (err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
        response.internalError(res, err.message);
      }
    },
    get: (req, res) => {
      try {
        const item = imageService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('images get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = imageService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('images delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    scene: (_req, res) => response.error(
      res,
      501,
      'LEGACY_ENDPOINT_DISABLED',
      'Use POST /api/v1/scenes/generate-image with scene_id.'
    ),
    episodeBackgrounds: (req, res) => {
      try {
        const list = imageService.getBackgroundsForEpisode(db, req.params.episode_id);
        response.success(res, list);
      } catch (err) {
        log.error('images episode backgrounds', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeBackgroundsExtract: (req, res) => {
      try {
        const body = req.body || {};
        const taskId = backgroundExtractionService.extractBackgroundsForEpisode(
          db,
          cfg,
          log,
          req.params.episode_id,
          body.model,
          body.style,
          body.language
        );
        response.success(res, { task_id: taskId, status: 'pending', message: '场景提取任务已创建，正在后台处理...' });
      } catch (err) {
        log.error('images episode backgrounds extract', { error: err.message });
        if (err.message && (err.message.includes('script content') || err.message.includes('not found') || err.message.includes('剧本内容为空') || err.message.includes('剧集不存在'))) {
          return response.badRequest(res, err.message);
        }
        response.internalError(res, err.message || '任务创建失败');
      }
    },
    episodeBatch: (_req, res) => response.error(
      res,
      501,
      'LEGACY_ENDPOINT_DISABLED',
      '请改为对每个分镜单独调用 POST /api/v1/images'
    ),
    upload: (req, res) => {
      try {
        const body = req.body || {};
        const item = imageService.upload(db, log, body);
        response.created(res, item);
      } catch (err) {
        log.error('images upload', { error: err.message });
        if (err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
