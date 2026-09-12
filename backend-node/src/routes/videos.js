const response = require('../response');
const { sendCaughtRouteError } = require('./serviceFailure');
const { isTrustedChineseUserError } = require('../services/providerErrorSanitizer');
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
        sendCaughtRouteError(res, err, '视频操作失败，请稍后重试');
      }
    },
    create: (req, res) => {
      try {
        response.created(res, videoService.createVideoGeneration(db, log, req.body || {}));
      } catch (err) {
        log.error('videos create', { error: err.message });
        sendCaughtRouteError(res, err, '视频操作失败，请稍后重试');
      }
    },
    get: (req, res) => {
      try {
        const item = videoService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('videos get', { error: err.message });
        sendCaughtRouteError(res, err, '视频操作失败，请稍后重试');
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
          const raw = String(err.message || '');
          return response.error(res, 409, err.code, isTrustedChineseUserError(raw) ? raw : '无法取消远程任务，请稍后重试');
        }
        sendCaughtRouteError(res, err, '视频操作失败，请稍后重试');
      }
    },
    fromImage: (_req, res) => response.error(
      res,
      501,
      'LEGACY_ENDPOINT_DISABLED',
      '请改用视频生成接口，并传入分镜 ID 与帧参考'
    ),
    episodeBatch: (_req, res) => response.error(
      res,
      501,
      'LEGACY_ENDPOINT_DISABLED',
      '请改为对每个分镜单独调用视频生成接口'
    ),
  };
}

module.exports = routes;
