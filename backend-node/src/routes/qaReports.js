const response = require('../response');
const qaService = require('../services/qaService');

function badRequestOrInternal(res, err) {
  if (err && err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
  if (err && err.code === 'WORKFLOW_NOT_READY') {
    return response.error(res, 409, err.code, err.message, err.details);
  }
  return response.internalError(res, err.message || 'QA operation failed');
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
        if (!report) return response.notFound(res, 'QA report not found');
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
        if (!result) return response.notFound(res, 'QA report not found');
        response.success(res, result);
      } catch (err) {
        log.error('qa reports remediate', { error: err.message, report_id: req.params.report_id });
        badRequestOrInternal(res, err);
      }
    },
  };
};
