const response = require('../response');
const { sendCaughtRouteError } = require('./serviceFailure');
const videoMergeService = require('../services/videoMergeService');
const { isBoundaryError } = require('../services/dramaWriteGuard');

function sendBoundaryError(res, error) {
  if (!isBoundaryError(error)) return false;
  response.error(
    res,
    error.statusCode || (error.code === 'DRAMA_NOT_FOUND' || error.code === 'RESOURCE_NOT_FOUND' ? 404 : 409),
    error.code,
    error.message,
    error.details
  );
  return true;
}

function routes(db, log) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const items = videoMergeService.list(db, query);
        response.success(res, items);
      } catch (err) {
        if (sendBoundaryError(res, err)) return;
        log.error('video-merges list', { error: err.message });
        sendCaughtRouteError(res, err, '成片记录操作失败，请稍后重试');
      }
    },
    create: (_req, res) => response.error(
      res,
      501,
      'LEGACY_ENDPOINT_DISABLED',
      '请改为调用剧集成片接口启动 FFmpeg 合成'
    ),
    get: (req, res) => {
      try {
        const item = videoMergeService.getById(db, req.params.merge_id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        if (sendBoundaryError(res, err)) return;
        log.error('video-merges get', { error: err.message });
        sendCaughtRouteError(res, err, '成片记录操作失败，请稍后重试');
      }
    },
    delete: (req, res) => {
      try {
        const ok = videoMergeService.deleteById(db, log, req.params.merge_id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        if (sendBoundaryError(res, err)) return;
        log.error('video-merges delete', { error: err.message });
        sendCaughtRouteError(res, err, '成片记录操作失败，请稍后重试');
      }
    },
  };
}

module.exports = routes;
