const response = require('../response');
const qaService = require('../services/qaService');

function toUserMessage(err, fallback) {
  const message = String(err && err.message || '').trim();
  if (message && /[\u4e00-\u9fff]/.test(message)) return message;
  return fallback;
}

function badRequestOrInternal(res, err) {
  if (err && err.code === 'BAD_REQUEST') {
    return response.badRequest(res, toUserMessage(err, '请求参数无效，请检查项目、分集或报告 ID 后重试'));
  }
  if (err && err.code === 'WORKFLOW_NOT_READY') {
    return response.error(
      res,
      409,
      err.code,
      toUserMessage(err, '当前制作流程尚未就绪，请先完成必要配置后再执行 QA 修复'),
      err.details
    );
  }
  return response.internalError(res, toUserMessage(err, 'QA 操作失败，请稍后重试'));
}

module.exports = function qaReportRoutes(db, log) {
  return {
    list(req, res) {
      try {
        const reports = qaService.listQaReports(db, req.query || {});
        response.success(res, reports);
      } catch (err) {
        log.error('qa reports list', { error: err.message });
        badRequestOrInternal(res, err);
      }
    },

    get(req, res) {
      try {
        const report = qaService.getQaReportById(db, req.params.report_id);
        if (!report) return response.notFound(res, '未找到该 QA 报告，请确认报告 ID 是否正确，或先重新执行 QA 审计');
        response.success(res, report);
      } catch (err) {
        log.error('qa reports get', { error: err.message, report_id: req.params.report_id });
        badRequestOrInternal(res, err);
      }
    },

    audit(req, res) {
      try {
        const report = qaService.auditDrama(db, log, req.body || {});
        response.created(res, report);
      } catch (err) {
        log.error('qa reports audit', { error: err.message });
        badRequestOrInternal(res, err);
      }
    },

    remediate(req, res) {
      try {
        const result = qaService.remediateQaReport(db, log, req.params.report_id, req.body || {});
        if (!result) return response.notFound(res, '未找到该 QA 报告，请确认报告 ID 是否正确，或先重新执行 QA 审计');
        response.success(res, result);
      } catch (err) {
        log.error('qa reports remediate', { error: err.message, report_id: req.params.report_id });
        badRequestOrInternal(res, err);
      }
    },
  };
};
