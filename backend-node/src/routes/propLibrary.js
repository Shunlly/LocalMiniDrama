const response = require('../response');
const { sendMappedServiceFailure } = require('./serviceFailure');

function sendLibraryFailure(res, err, fallback) {
  sendMappedServiceFailure(res, { ok: false, error: err && err.message }, { fallback });
}

const propLibraryService = require('../services/propLibraryService');

function routes(db, cfg, log) {
  return {
    list: (req, res) => {
      try {
        const query = { page: req.query.page, page_size: req.query.page_size, drama_id: req.query.drama_id, global: req.query.global, category: req.query.category, source_type: req.query.source_type, source_id: req.query.source_id, source_ids: req.query.source_ids, keyword: req.query.keyword };
        const { items, total, page, pageSize } = propLibraryService.listLibraryItems(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('prop-library list', { error: err.message });
        sendLibraryFailure(res, err, '道具库操作失败，请稍后重试');
      }
    },
    create: (req, res) => {
      try {
        const item = propLibraryService.createLibraryItem(db, log, req.body || {});
        response.created(res, item);
      } catch (err) {
        log.error('prop-library create', { error: err.message });
        sendLibraryFailure(res, err, '道具库操作失败，请稍后重试');
      }
    },
    get: (req, res) => {
      try {
        const item = propLibraryService.getLibraryItem(db, req.params.id);
        if (!item) return response.notFound(res, '道具库项不存在');
        response.success(res, item);
      } catch (err) {
        log.error('prop-library get', { error: err.message });
        sendLibraryFailure(res, err, '道具库操作失败，请稍后重试');
      }
    },
    update: (req, res) => {
      try {
        const item = propLibraryService.updateLibraryItem(db, log, req.params.id, req.body || {});
        if (!item) return response.notFound(res, '道具库项不存在');
        response.success(res, item);
      } catch (err) {
        log.error('prop-library update', { error: err.message });
        sendLibraryFailure(res, err, '道具库操作失败，请稍后重试');
      }
    },
    delete: (req, res) => {
      try {
        const ok = propLibraryService.deleteLibraryItem(db, log, req.params.id);
        if (!ok) return response.notFound(res, '道具库项不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('prop-library delete', { error: err.message });
        sendLibraryFailure(res, err, '道具库操作失败，请稍后重试');
      }
    },
  };
}

module.exports = routes;
