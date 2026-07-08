const response = require('../response');
const workflowService = require('../services/workflowService');

function badRequestOrInternal(res, err) {
  if (err && err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
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

    startNovel2Anime(req, res) {
      try {
        const run = workflowService.startNovel2AnimeWorkflow(db, log, req.body || {});
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
