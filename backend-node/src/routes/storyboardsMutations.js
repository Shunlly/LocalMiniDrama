/**
 * 分镜路由写入：全能片段、视频提示词、润色结果、超分路径与摄影参数。
 * 路由仍从 storyboards.js 导出，本模块不改变公开 API。
 */
const { pickPhotographyParamPatch } = require('./storyboardsAssembly');

function persistUniversalSegmentText(db, sbId, text) {
  const nowIso = new Date().toISOString();
  db.prepare('UPDATE storyboards SET universal_segment_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    text,
    nowIso,
    sbId
  );
}

function persistVideoPrompt(db, sbId, text) {
  const nowIso = new Date().toISOString();
  db.prepare('UPDATE storyboards SET video_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    text,
    nowIso,
    sbId
  );
}

function persistPolishedPrompt(db, sbId, polished) {
  const nowIso = new Date().toISOString();
  db.prepare('UPDATE storyboards SET polished_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    polished, nowIso, sbId
  );
}

function persistContinuitySnapshot(db, sbId, cleaned) {
  db.prepare('UPDATE storyboards SET continuity_snapshot = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    cleaned, new Date().toISOString(), sbId
  );
}

function persistStoryboardLocalPath(db, sbId, relativePath) {
  const now = new Date().toISOString();
  db.prepare('UPDATE storyboards SET local_path = ?, updated_at = ? WHERE id = ?').run(relativePath, now, sbId);
}

function applyPhotographyParamPatches(db, rows, overwrite) {
  let updated = 0;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'UPDATE storyboards SET movement = COALESCE(?, movement), lighting_style = COALESCE(?, lighting_style), depth_of_field = COALESCE(?, depth_of_field), updated_at = ? WHERE id = ?'
  );
  const stmtOverwrite = db.prepare(
    'UPDATE storyboards SET movement = ?, lighting_style = ?, depth_of_field = ?, updated_at = ? WHERE id = ?'
  );

  for (const row of rows) {
    const patch = pickPhotographyParamPatch(row, overwrite);
    if (!patch) continue;
    if (patch.mode === 'overwrite') {
      stmtOverwrite.run(patch.inferred.movement, patch.inferred.lighting_style, patch.inferred.depth_of_field, now, row.id);
      updated++;
    } else {
      stmt.run(patch.newMovement, patch.newLighting, patch.newDof, now, row.id);
      updated++;
    }
  }
  return { total: rows.length, updated };
}

module.exports = {
  persistUniversalSegmentText,
  persistVideoPrompt,
  persistPolishedPrompt,
  persistContinuitySnapshot,
  persistStoryboardLocalPath,
  applyPhotographyParamPatches,
};
