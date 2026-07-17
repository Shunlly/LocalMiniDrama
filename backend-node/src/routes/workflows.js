const response = require('../response');
const workflowService = require('../services/workflowService');
const readinessService = require('../services/readinessService');

function badRequestOrInternal(res, err) {
  if (err && err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
  if (err && err.code === 'WORKFLOW_NOT_READY') {
    return response.error(res, 409, err.code, err.message, err.details);
  }
  return response.internalError(res, err.message || 'Workflow operation failed');
}

module.exports = function workflowRoutes(db, log) {
  return {
    list(req, res) {
      try {
        const runs = workflowService.listWorkflowRuns(db, req.query || {});
        response.success(res, runs);
      } catch (err) {
        log.error('workflows list', { error: err.message });
        badRequestOrInternal(res, err);
      }
    },

    get(req, res) {
      try {
        const run = workflowService.getWorkflowRunDetail(db, req.params.run_id);
        if (!run) return response.notFound(res, 'Workflow run not found');
        response.success(res, run);
      } catch (err) {
        log.error('workflows get', { error: err.message, run_id: req.params.run_id });
        badRequestOrInternal(res, err);
      }
    },

    novel2AnimeReadiness(req, res) {
      try {
        const readiness = readinessService.checkNovel2AnimeReadiness(db, req.body || {});
        response.success(res, readiness);
      } catch (err) {
        log.error('workflows novel2anime readiness', { error: err.message });
        badRequestOrInternal(res, err);
      }
    },

    startNovel2Anime(req, res) {
      try {
        const params = req.body || {};
        if (params.qa_mode === 'production' || params.mode === 'production') {
          readinessService.assertNovel2AnimeReadiness(db, params);
        }
        const run = workflowService.startNovel2AnimeWorkflow(db, log, params);
        response.created(res, run);
      } catch (err) {
        log.error('workflows novel2anime start', { error: err.message });
        badRequestOrInternal(res, err);
      }
    },

    retry(req, res) {
      try {
        const run = workflowService.retryWorkflowRun(db, log, req.params.run_id, req.body || {});
        if (!run) return response.notFound(res, 'Workflow run not found');
        response.success(res, run);
      } catch (err) {
        log.error('workflows retry', { error: err.message, run_id: req.params.run_id });
        badRequestOrInternal(res, err);
      }
    },

    cancel(req, res) {
      try {
        const run = workflowService.cancelWorkflowRun(db, log, req.params.run_id, req.body?.reason);
        if (!run) return response.notFound(res, 'Workflow run not found');
        response.success(res, run);
      } catch (err) {
        log.error('workflows cancel', { error: err.message, run_id: req.params.run_id });
        badRequestOrInternal(res, err);
      }
    },

    pause(req, res) {
      try {
        const run = workflowService.pauseWorkflowRun(db, log, req.params.run_id, req.body?.reason);
        if (!run) return response.notFound(res, 'Workflow run not found');
        response.success(res, run);
      } catch (err) {
        log.error('workflows pause', { error: err.message, run_id: req.params.run_id });
        badRequestOrInternal(res, err);
      }
    },

    resume(req, res) {
      try {
        const run = workflowService.resumeWorkflowRun(db, log, req.params.run_id);
        if (!run) return response.notFound(res, 'Workflow run not found');
        response.success(res, run);
      } catch (err) {
        log.error('workflows resume', { error: err.message, run_id: req.params.run_id });
        badRequestOrInternal(res, err);
      }
    },
  };
};
