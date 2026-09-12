const response = require('../response');
const { sendCaughtRouteError, logCaughtRouteError, publicErrorMessage } = require('./serviceFailure');
const videoMergeService = require('../services/videoMergeService');
const { isBoundaryError } = require('../services/dramaWriteGuard');

function sendBoundaryError(res, error) {
  if (!isBoundaryError(error)) return false;
  const fallback = error.code === 'DRAMA_NOT_FOUND' || error.code === 'RESOURCE_NOT_FOUND'
    ? '项目或成片记录不可访问'
    : '当前项目不可用';
  response.error(
    res,
    error.statusCode || (error.code === 'DRAMA_NOT_FOUND' || error.code === 'RESOURCE_NOT_FOUND' ? 404 : 409),
    error.code,
    publicErrorMessage(error, fallback),
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
        logCaughtRouteError(log, 'video-merges list', err, { fallback: '成片记录操作失败，请稍后重试' });
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
        logCaughtRouteError(log, 'video-merges get', err, { fallback: '成片记录操作失败，请稍后重试' });
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
        logCaughtRouteError(log, 'video-merges delete', err, { fallback: '成片记录操作失败，请稍后重试' });
        sendCaughtRouteError(res, err, '成片记录操作失败，请稍后重试');
      }
    },
  };
}

module.exports = routes;
