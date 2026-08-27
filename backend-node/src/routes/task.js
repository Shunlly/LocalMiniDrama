const taskService = require('../services/taskService');
const dramaWriteGuard = require('../services/dramaWriteGuard');
const response = require('../response');

function sendBoundaryError(res, err) {
  if (err.code === 'TASK_SCOPE_CONFLICT') {
    response.error(res, 409, err.code, err.message, err.details);
    return true;
  }
  if (dramaWriteGuard.isBoundaryError(err)) {
    response.error(res, err.statusCode || 409, err.code, err.message, err.details);
    return true;
  }
  return false;
}

function getTaskStatus(db, log) {
  return (req, res) => {
    try {
      const task = taskService.getTask(db, req.params.task_id, { requireReadable: true });
      if (!task) return response.notFound(res, '任务不存在');
      response.success(res, task);
    } catch (err) {
      if (sendBoundaryError(res, err)) return;
      log.errorw('Get task failed', { error: err.message, task_id: req.params.task_id });
      return response.internalError(res, err.message);
    }
  };
}

function getResourceTasks(db, log) {
  return (req, res) => {
    const resourceId = req.query.resource_id;
    if (!resourceId) return response.badRequest(res, '缺少resource_id参数');
    try {
      const tasks = taskService.getTasksByResource(db, resourceId, {
        dramaId: req.query.drama_id,
        requireReadable: true,
      });
      response.success(res, tasks);
    } catch (err) {
      if (sendBoundaryError(res, err)) return;
      log.errorw('Get resource tasks failed', { error: err.message });
      response.internalError(res, err.message);
    }
  };
}

function cancelTaskStatus(db, log) {
  return async (req, res) => {
    try {
      const result = await taskService.cancelTask(db, log, req.params.task_id, req.body?.reason, {
        requireReadable: true,
      });
      if (!result.ok && result.reason === 'not_found') {
        return response.notFound(res, '任务不存在');
      }
      if (!result.ok) {
        const code = result.code || (result.reason === 'task_scope_conflict'
          ? 'TASK_SCOPE_CONFLICT'
          : result.reason === 'remote_cancel_uncertain'
            ? 'REMOTE_CANCEL_UNCERTAIN'
            : result.reason === 'remote_cancel_exhausted'
              ? 'REMOTE_CANCEL_EXHAUSTED'
            : 'REMOTE_CANCEL_FAILED');
        const statusCode = code === 'DRAMA_NOT_FOUND' ? 404 : 409;
        return response.error(
          res,
          statusCode,
          code,
          result.error || '任务取消失败，任务仍在运行',
          result.details
        );
      }
      response.success(res, result.task || { id: req.params.task_id });
    } catch (err) {
      log.errorw('Cancel task failed', { error: err.message, task_id: req.params.task_id });
      response.internalError(res, err.message);
    }
  };
}

module.exports = function taskRoutes(db, log) {
  return {
    getTaskStatus: getTaskStatus(db, log),
    getResourceTasks: getResourceTasks(db, log),
    cancelTaskStatus: cancelTaskStatus(db, log),
  };
};
