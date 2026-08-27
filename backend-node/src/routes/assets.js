const response = require('../response');
const assetService = require('../services/assetService');

function handleError(res, log, operation, err) {
  if (err?.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
  if (Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 600) {
    return response.error(res, err.statusCode, err.code || 'NETWORK_MEDIA_ERROR', err.message);
  }
  log.error(operation, { error: err?.message });
  return response.internalError(res);
}

function routes(db, log) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const { items, total, page, pageSize } = assetService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        handleError(res, log, 'assets list', err);
      }
    },
    create: (req, res) => {
      try {
        const item = assetService.create(db, log, req.body || {}, { strictDramaId: true });
        response.created(res, item);
      } catch (err) {
        handleError(res, log, 'assets create', err);
      }
    },
    networkSearch: async (req, res) => {
      try {
        const result = await assetService.searchNetwork(req.query || {});
        response.success(res, result);
      } catch (err) {
        handleError(res, log, 'assets network search', err);
      }
    },
    networkImport: async (req, res) => {
      try {
        const item = await assetService.importFromNetwork(db, log, req.body || {});
        response.created(res, item);
      } catch (err) {
        handleError(res, log, 'assets network import', err);
      }
    },
    get: (req, res) => {
      try {
        const item = assetService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '资源不存在');
        response.success(res, item);
      } catch (err) {
        handleError(res, log, 'assets get', err);
      }
    },
    update: (req, res) => {
      try {
        const item = assetService.update(db, log, req.params.id, req.body || {});
        if (!item) return response.notFound(res, '资源不存在');
        response.success(res, item);
      } catch (err) {
        handleError(res, log, 'assets update', err);
      }
    },
    delete: (req, res) => {
      try {
        const ok = assetService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '资源不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        if (err.code === 'ASSET_IN_USE') {
          return response.error(res, 409, err.code, err.message, err.details);
        }
        handleError(res, log, 'assets delete', err);
      }
    },
    importImage: (req, res) => {
      try {
        const item = assetService.importFromImage(db, log, req.params.image_gen_id);
        if (!item) return response.notFound(res, '图片生成记录不存在');
        response.created(res, item);
      } catch (err) {
        handleError(res, log, 'assets import image', err);
      }
    },
    importVideo: (req, res) => {
      try {
        const item = assetService.importFromVideo(db, log, req.params.video_gen_id);
        if (!item) return response.notFound(res, '视频生成记录不存在');
        response.created(res, item);
      } catch (err) {
        handleError(res, log, 'assets import video', err);
      }
    },
  };
}

module.exports = routes;
