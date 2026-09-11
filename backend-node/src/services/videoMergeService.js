const dramaWriteGuard = require('./dramaWriteGuard');
const {
  STRICT_PRODUCTION_MODE,
  buildPersistedMergeOptions,
  buildStrictSceneFilterPlan,
} = require('./videoMergePlanning');
const { runExternalProcess } = require('./videoMergeProcess');
const {
  normalizeMergeScenes,
  updateCurrentMergeEpisodeOutput,
  processVideoMerge,
} = require('./videoMergeExecution');

function list(db, query) {
  if (query.drama_id && !require('./dramaWriteGuard').canReadDrama(db, Number(query.drama_id))) return [];
  let sql = 'FROM video_merges WHERE deleted_at IS NULL';
  const params = [];
  if (query.episode_id) {
    sql += ' AND episode_id = ?';
    params.push(query.episode_id);
  }
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(query.drama_id);
  }
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC, id DESC').all(...params);
  return rows.filter((row) => require('./dramaWriteGuard').canReadResource(db, 'video_merges', row.id)).map(rowToItem);
}

function rowToItem(r) {
  return {
    id: r.id,
    episode_id: r.episode_id,
    drama_id: r.drama_id,
    title: r.title,
    provider: r.provider,
    status: r.status,
    merged_url: r.merged_url,
    duration: r.duration ?? undefined,
    task_id: r.task_id,
    error_msg: r.error_msg ?? undefined,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}

function getById(db, id) {
  if (!require('./dramaWriteGuard').canReadResource(db, 'video_merges', id)) return null;
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

function create(db, log, req) {
  const now = new Date().toISOString();
  const scenes = normalizeMergeScenes(req.scenes, db);
  const taskService = require('./taskService');
  const mergeOptionsJson = JSON.stringify(buildPersistedMergeOptions(req));
  const persist = db.transaction(() => {
    const episode = dramaWriteGuard.assertEpisodeWritable(db, req.episode_id, req.drama_id);
    const episodeId = Number(episode.id);
    const dramaId = Number(episode.drama_id);
    const task = taskService.createTask(db, log, 'video_merge', String(episodeId));
    const info = db.prepare(
      `INSERT INTO video_merges (episode_id, drama_id, title, provider, model, status, scenes, merge_options, task_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(
      episodeId,
      dramaId,
      req.title ?? null,
      req.provider || 'ffmpeg',
      req.model ?? null,
      JSON.stringify(scenes),
      mergeOptionsJson,
      task.id,
      now
    );
    return { mergeId: Number(info.lastInsertRowid), taskId: task.id };
  });
  const created = typeof persist.immediate === 'function' ? persist.immediate() : persist();
  taskService.ensureTaskOperation(created.taskId);
  return { merge_id: created.mergeId, task_id: created.taskId, ...getById(db, created.mergeId) };
}

function deleteById(db, log, id) {
  const now = new Date().toISOString();
  return dramaWriteGuard.runResourceWrite(db, 'video_merges', id, (row) => {
    const result = db.prepare(
      'UPDATE video_merges SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(now, Number(row.id));
    return result.changes > 0;
  });
}

function completeQaPendingMerge(db, mergeId, completedAt = new Date().toISOString()) {
  const row = db.prepare(
    `SELECT id, episode_id, task_id, merged_url, duration
       FROM video_merges
      WHERE id = ? AND status = 'qa_pending'`
  ).get(Number(mergeId));
  if (!row) return false;
  const complete = db.transaction(() => {
    const result = db.prepare(
      `UPDATE video_merges
          SET status = 'completed', completed_at = ?, error_msg = NULL
        WHERE id = ? AND status = 'qa_pending'`
    ).run(completedAt, row.id);
    if (result.changes === 0) return false;
    updateCurrentMergeEpisodeOutput(
      db,
      row.id,
      row.episode_id,
      row.merged_url,
      'completed',
      completedAt
    );
    if (row.task_id) {
      const taskService = require('./taskService');
      const task = taskService.getTask(db, row.task_id);
      if (task && task.status !== 'completed') {
        throw new Error('视频合成：QA 完成任务尚未完成');
      }
      if (task && !taskService.refreshCompletedTaskResult(db, row.task_id, {
        merge_id: row.id,
        video_url: row.merged_url,
        duration: row.duration,
        mode: STRICT_PRODUCTION_MODE,
        status: 'completed',
      })) {
        throw new Error('视频合成：QA 完成任务结果未能刷新');
      }
    }
    return true;
  });
  return complete();
}

module.exports = {
  list,
  getById,
  create,
  deleteById,
  completeQaPendingMerge,
  processVideoMerge,
  buildStrictSceneFilterPlan,
  updateCurrentMergeEpisodeOutput,
  __test: { runExternalProcess },
};
