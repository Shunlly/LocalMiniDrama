const response = require('../response');
const videoService = require('../services/videoService');

function routes(db, log) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const { items, total, page, pageSize } = videoService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('videos list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    create: (req, res) => {
      try {
        response.created(res, videoService.createVideoGeneration(db, log, req.body || {}));
      } catch (err) {
        log.error('videos create', { error: err.message });
        if (err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
        response.internalError(res, err.message);
      }
    },
    get: (req, res) => {
      try {
        const item = videoService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('videos get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: async (req, res) => {
      try {
        const ok = await videoService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('videos delete', { error: err.message });
      if ([
        'REMOTE_CANCEL_FAILED',
        'REMOTE_CANCEL_UNCERTAIN',
        'TASK_SCOPE_CONFLICT',
      ].includes(err.code)) {
          return response.error(res, 409, err.code, err.message);
        }
        response.internalError(res, err.message);
      }
    },
    fromImage: (_req, res) => response.error(
      res,
      501,
      'LEGACY_ENDPOINT_DISABLED',
      'Use POST /api/v1/videos with storyboard_id and frame references.'
    ),
    episodeBatch: (_req, res) => response.error(
      res,
      501,
      'LEGACY_ENDPOINT_DISABLED',
      'Submit POST /api/v1/videos once for each storyboard.'
    ),
  };
}

module.exports = routes;
