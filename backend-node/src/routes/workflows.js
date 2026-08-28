const response = require('../response');
const workflowService = require('../services/workflowService');
const readinessService = require('../services/readinessService');
const { canReadDrama } = require('../services/dramaWriteGuard');

function badRequestOrInternal(res, err) {
  if (err && err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
  if (err && err.code === 'WORKFLOW_NOT_READY') {
    return response.error(res, 409, err.code, err.message, err.details);
  }
  return response.internalError(res, err.message || '工作流操作失败');
}

function positiveInteger(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isWorkflowRunReadable(db, run) {
  const dramaId = positiveInteger(run?.drama_id);
  if (!dramaId || !canReadDrama(db, dramaId)) return false;
  if (run.episode_id == null) return true;

  const episodeId = positiveInteger(run.episode_id);
  if (!episodeId) return false;
  const episode = db.prepare(
    'SELECT drama_id, deleted_at FROM episodes WHERE id = ?'
  ).get(episodeId);
  return Boolean(
    episode
    && episode.deleted_at == null
    && positiveInteger(episode.drama_id) === dramaId
  );
}

function getReadableWorkflowRun(db, runId) {
  const run = workflowService.getWorkflowRun(db, runId);
  return run && isWorkflowRunReadable(db, run) ? run : null;
}

function listReadableWorkflowRuns(db, query) {
  let sql = `SELECT run.*
    FROM workflow_runs run
    JOIN dramas drama ON drama.id = run.drama_id
    LEFT JOIN episodes episode ON episode.id = run.episode_id
   WHERE run.deleted_at IS NULL
     AND drama.deleted_at IS NULL
     AND LOWER(TRIM(COALESCE(drama.status, ''))) NOT IN ('trash', 'deleted', 'recycling', 'manual_intervention')
     AND TRIM(COALESCE(drama.trash_state, '')) = ''
     AND TRIM(COALESCE(drama.recycle_phase, '')) = ''
     AND (run.episode_id IS NULL OR (
       episode.id IS NOT NULL
       AND episode.deleted_at IS NULL
       AND episode.drama_id = run.drama_id
     ))`;
  const params = [];
  if (query.drama_id != null) {
    sql += ' AND run.drama_id = ?';
    params.push(Number(query.drama_id));
  }
  if (query.type) {
    sql = workflowService.applyWorkflowTypeFilter(sql, params, query.type, 'run.type');
  }
  if (query.status) {
    sql += ' AND run.status = ?';
    params.push(String(query.status));
  }
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  sql += ' ORDER BY run.created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(workflowService.rowToRun);
}

module.exports = function workflowRoutes(db, log) {
  return {
    list(req, res) {
      try {
        const runs = listReadableWorkflowRuns(db, req.query || {});
        response.success(res, runs);
      } catch (err) {
        log.error('workflows list', { error: err.message });
        badRequestOrInternal(res, err);
      }
    },

    get(req, res) {
      try {
        if (!getReadableWorkflowRun(db, req.params.run_id)) {
          return response.notFound(res, '工作流任务不存在');
        }
        const run = workflowService.getWorkflowRunDetail(db, req.params.run_id);
        if (!run) return response.notFound(res, '工作流任务不存在');
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
        if (!getReadableWorkflowRun(db, req.params.run_id)) {
          return response.notFound(res, '工作流任务不存在');
        }
        const run = workflowService.retryWorkflowRun(db, log, req.params.run_id, req.body || {});
        if (!run) return response.notFound(res, '工作流任务不存在');
        response.success(res, run);
      } catch (err) {
        log.error('workflows retry', { error: err.message, run_id: req.params.run_id });
        badRequestOrInternal(res, err);
      }
    },

    cancel(req, res) {
      try {
        if (!getReadableWorkflowRun(db, req.params.run_id)) {
          return response.notFound(res, '工作流任务不存在');
        }
        const run = workflowService.cancelWorkflowRun(db, log, req.params.run_id, req.body?.reason);
        if (!run) return response.notFound(res, '工作流任务不存在');
        response.success(res, run);
      } catch (err) {
        log.error('workflows cancel', { error: err.message, run_id: req.params.run_id });
        badRequestOrInternal(res, err);
      }
    },

    pause(req, res) {
      try {
        if (!getReadableWorkflowRun(db, req.params.run_id)) {
          return response.notFound(res, '工作流任务不存在');
        }
        const run = workflowService.pauseWorkflowRun(db, log, req.params.run_id, req.body?.reason);
        if (!run) return response.notFound(res, '工作流任务不存在');
        response.success(res, run);
      } catch (err) {
        log.error('workflows pause', { error: err.message, run_id: req.params.run_id });
        badRequestOrInternal(res, err);
      }
    },

    resume(req, res) {
      try {
        if (!getReadableWorkflowRun(db, req.params.run_id)) {
          return response.notFound(res, '工作流任务不存在');
        }
        const run = workflowService.resumeWorkflowRun(db, log, req.params.run_id);
        if (!run) return response.notFound(res, '工作流任务不存在');
        response.success(res, run);
      } catch (err) {
        log.error('workflows resume', { error: err.message, run_id: req.params.run_id });
        badRequestOrInternal(res, err);
      }
    },
  };
};
