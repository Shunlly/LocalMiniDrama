'use strict';

/**
 * 任务取消作用域校验与所属记录终态：视频/图片/合成的归属冲突与 terminalize。
 * 路由仍通过 taskService.cancelTask 进入，本模块不改变公开 API。
 */

function normalizeTaskResourceId(value) {
  const normalized = String(value ?? '').trim();
  return normalized === '0' ? '' : normalized;
}

function readDramaIdByEpisode(db, episodeId) {
  try {
    return db.prepare(
      'SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'
    ).get(Number(episodeId))?.drama_id ?? '';
  } catch (error) {
    if (/no such column/i.test(error?.message || '')) {
      return db.prepare('SELECT drama_id FROM episodes WHERE id = ?').get(Number(episodeId))?.drama_id ?? '';
    }
    if (/no such table/i.test(error?.message || '')) return '';
    throw error;
  }
}

function validateVideoTaskScope(db, task) {
  if (task?.type !== 'video_generation') return null;
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, drama_id FROM video_generations
        WHERE task_id = ? AND deleted_at IS NULL`
    ).all(task.id);
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return null;
    if (/no such column/i.test(error?.message || '')) {
      rows = db.prepare('SELECT id, drama_id FROM video_generations WHERE task_id = ?').all(task.id);
    } else throw error;
  }
  const expected = normalizeTaskResourceId(task.resource_id);
  const conflicting = rows.find((row) => normalizeTaskResourceId(row.drama_id) !== expected);
  if (!conflicting) return null;
  return {
    video_generation_id: conflicting.id,
    expected_drama_id: expected || null,
    actual_drama_id: normalizeTaskResourceId(conflicting.drama_id) || null,
  };
}

function resolveDeclaredImageDramaId(db, task) {
  const resourceId = normalizeTaskResourceId(task?.resource_id);
  if (/^[1-9]\d*$/.test(resourceId)) return resourceId;
  const scoped = resourceId.match(/^(character|scene)_(\d+)$/);
  if (!scoped) return '';
  try {
    const table = scoped[1] === 'character' ? 'characters' : 'scenes';
    const row = db.prepare(
      `SELECT drama_id FROM ${table} WHERE id = ? AND deleted_at IS NULL`
    ).get(Number(scoped[2]));
    return normalizeTaskResourceId(row?.drama_id);
  } catch (error) {
    if (/no such column/i.test(error?.message || '')) {
      const table = scoped[1] === 'character' ? 'characters' : 'scenes';
      return normalizeTaskResourceId(db.prepare(`SELECT drama_id FROM ${table} WHERE id = ?`).get(Number(scoped[2]))?.drama_id);
    }
    if (/no such table/i.test(error?.message || '')) return '';
    throw error;
  }
}

function imageTaskScope(db, task) {
  if (task?.type !== 'image_generation') return { conflict: null, dramaId: '' };
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, drama_id FROM image_generations
        WHERE task_id = ? AND deleted_at IS NULL`
    ).all(task.id);
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) {
      return { conflict: null, dramaId: resolveDeclaredImageDramaId(db, task) };
    }
    if (/no such column/i.test(error?.message || '')) {
      rows = db.prepare('SELECT id, drama_id FROM image_generations WHERE task_id = ?').all(task.id);
    } else throw error;
  }
  const declared = resolveDeclaredImageDramaId(db, task);
  const actualIds = [...new Set(rows.map((row) => normalizeTaskResourceId(row.drama_id)))];
  const conflicting = rows.find((row) => declared && normalizeTaskResourceId(row.drama_id) !== declared);
  if (actualIds.length <= 1 && !conflicting) {
    return { conflict: null, dramaId: declared || actualIds[0] || '' };
  }
  const conflictRow = conflicting || rows.find((row) => normalizeTaskResourceId(row.drama_id) !== actualIds[0]);
  return {
    conflict: {
      image_generation_id: conflictRow?.id || null,
      expected_drama_id: declared || actualIds[0] || null,
      actual_drama_id: normalizeTaskResourceId(conflictRow?.drama_id) || null,
    },
    dramaId: '',
  };
}

function validateMergeTaskScope(db, task) {
  if (task?.type !== 'video_merge') return null;
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, drama_id FROM video_merges
        WHERE task_id = ? AND deleted_at IS NULL`
    ).all(task.id);
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return null;
    if (/no such column/i.test(error?.message || '')) {
      rows = db.prepare('SELECT id, drama_id FROM video_merges WHERE task_id = ?').all(task.id);
    } else throw error;
  }
  const expected = normalizeTaskResourceId(readDramaIdByEpisode(db, task.resource_id));
  const conflicting = rows.find((row) => normalizeTaskResourceId(row.drama_id) !== expected);
  if (!conflicting) return null;
  return {
    video_merge_id: conflicting.id,
    expected_drama_id: expected || null,
    actual_drama_id: normalizeTaskResourceId(conflicting.drama_id) || null,
  };
}

function terminalizeOwnedVideoRecords(db, task, message, updatedAt, terminalStatus = 'cancelled') {
  const status = terminalStatus === 'failed' ? 'failed' : 'cancelled';
  const resourceId = normalizeTaskResourceId(task.resource_id);
  try {
    db.prepare(
      `UPDATE video_generations
          SET status = ?, error_msg = ?, completed_at = ?, updated_at = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, String(message || '').slice(0, 500), updatedAt, updatedAt, task.id, resourceId);
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return;
    if (!/completed_at|error_msg/i.test(error?.message || '')) throw error;
    db.prepare(
      `UPDATE video_generations SET status = ?, updated_at = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, updatedAt, task.id, resourceId);
  }
}

function terminalizeOwnedImageRecords(db, task, message, updatedAt, dramaId, terminalStatus = 'cancelled') {
  if (task?.type !== 'image_generation') return;
  const status = terminalStatus === 'failed' ? 'failed' : 'cancelled';
  try {
    db.prepare(
      `UPDATE image_generations
          SET status = ?, error_msg = ?, completed_at = ?, updated_at = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, String(message || '').slice(0, 500), updatedAt, updatedAt, task.id, dramaId || '');
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return;
    if (!/completed_at|error_msg/i.test(error?.message || '')) throw error;
    db.prepare(
      `UPDATE image_generations SET status = ?, updated_at = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, updatedAt, task.id, dramaId || '');
  }
}

function terminalizeOwnedMergeRecords(db, task, message, updatedAt, terminalStatus = 'cancelled') {
  if (task?.type !== 'video_merge') return;
  const status = terminalStatus === 'failed' ? 'failed' : 'cancelled';
  const expected = normalizeTaskResourceId(readDramaIdByEpisode(db, task.resource_id));
  try {
    db.prepare(
      `UPDATE video_merges
          SET status = ?, error_msg = ?, completed_at = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, String(message || '').slice(0, 500), updatedAt, task.id, expected);
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) {
      syncEpisodeStatusAfterMergeTerminal(db, task, terminalStatus, updatedAt);
      return;
    }
    if (!/completed_at|error_msg/i.test(error?.message || '')) throw error;
    db.prepare(
      `UPDATE video_merges SET status = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, task.id, expected);
  }
  syncEpisodeStatusAfterMergeTerminal(db, task, terminalStatus, updatedAt);
}

function syncEpisodeStatusAfterMergeTerminal(db, task, terminalStatus, updatedAt) {
  if (task?.type !== 'video_merge') return;
  let merges;
  try {
    merges = db.prepare(
      'SELECT id, episode_id, status FROM video_merges WHERE task_id = ?'
    ).all(task.id);
  } catch (error) {
    if (/no such table|no such column/i.test(error?.message || '')) return;
    throw error;
  }
  const mergeStatus = terminalStatus === 'failed' ? 'failed' : 'cancelled';
  const nextStatus = terminalStatus === 'failed' ? 'failed' : 'draft';
  for (const merge of merges) {
    if (String(merge.status || '') !== mergeStatus) continue;
    const episodeId = Number(merge.episode_id);
    if (!Number.isSafeInteger(episodeId) || episodeId <= 0) continue;
    try {
      db.prepare(
        `UPDATE episodes
            SET status = ?, updated_at = ?
          WHERE id = ?
            AND status = 'processing'
            AND ? = (
              SELECT id FROM video_merges
               WHERE episode_id = ?
               ORDER BY id DESC
               LIMIT 1
            )`
      ).run(nextStatus, updatedAt, episodeId, merge.id, episodeId);
    } catch (error) {
      if (/no such table|no such column/i.test(error?.message || '')) return;
      throw error;
    }
  }
}

module.exports = {
  normalizeTaskResourceId,
  readDramaIdByEpisode,
  validateVideoTaskScope,
  resolveDeclaredImageDramaId,
  imageTaskScope,
  validateMergeTaskScope,
  terminalizeOwnedVideoRecords,
  terminalizeOwnedImageRecords,
  terminalizeOwnedMergeRecords,
  syncEpisodeStatusAfterMergeTerminal,
};
