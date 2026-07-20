const response = require('../response');
const videoMergeService = require('../services/videoMergeService');

function routes(db, log) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const items = videoMergeService.list(db, query);
        response.success(res, items);
      } catch (err) {
        log.error('video-merges list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    create: (_req, res) => response.error(
      res,
      501,
      'LEGACY_ENDPOINT_DISABLED',
      'Use POST /api/v1/episodes/:episode_id/finalize to start an FFmpeg merge.'
    ),
    get: (req, res) => {
      try {
        const item = videoMergeService.getById(db, req.params.merge_id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('video-merges get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = videoMergeService.deleteById(db, log, req.params.merge_id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('video-merges delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
