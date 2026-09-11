/**
 * 工作流时间线规划：轨道创建、条目写入与集级时间线装配。
 * 路由仍通过 workflowService 调用，本模块不改变公开 API。
 */

const { nowIso, toJson } = require('./workflowStatus');

function findOrCreateTimelineTrack(db, episodeId, type, name, sortOrder) {
  const existing = db.prepare(
    'SELECT id, name, sort_order FROM timeline_tracks WHERE episode_id = ? AND type = ? ORDER BY id ASC LIMIT 1'
  ).get(Number(episodeId), type);
  if (existing) {
    if (existing.name !== name || Number(existing.sort_order) !== Number(sortOrder)) {
      db.prepare('UPDATE timeline_tracks SET name = ?, sort_order = ?, updated_at = ? WHERE id = ?')
        .run(name, sortOrder, nowIso(), existing.id);
    }
    return existing.id;
  }
  const now = nowIso();
  const info = db.prepare(
    `INSERT INTO timeline_tracks (episode_id, type, name, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(Number(episodeId), type, name, sortOrder, now, now);
  return Number(info.lastInsertRowid);
}

function insertTimelineItemIfMissing(db, trackId, storyboardId, startSec, endSec, sourcePath, metadata) {
  const existing = db.prepare(
    'SELECT id FROM timeline_items WHERE track_id = ? AND storyboard_id = ? LIMIT 1'
  ).get(Number(trackId), Number(storyboardId));
  if (existing) return false;
  const now = nowIso();
  db.prepare(
    `INSERT INTO timeline_items (track_id, storyboard_id, start_sec, end_sec, source_path, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(trackId), Number(storyboardId), startSec, endSec, sourcePath, toJson(metadata), now, now);
  return true;
}

function upsertTimelineItem(db, trackId, storyboardId, startSec, endSec, sourcePath, metadata) {
  const existing = db.prepare(
    'SELECT id FROM timeline_items WHERE track_id = ? AND storyboard_id = ? LIMIT 1'
  ).get(Number(trackId), Number(storyboardId));
  const now = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE timeline_items
          SET start_sec = ?, end_sec = ?, source_path = ?, metadata = ?, updated_at = ?
        WHERE id = ?`
    ).run(startSec, endSec, sourcePath, toJson(metadata), now, existing.id);
    return false;
  }
  db.prepare(
    `INSERT INTO timeline_items (track_id, storyboard_id, start_sec, end_sec, source_path, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(trackId), Number(storyboardId), startSec, endSec, sourcePath, toJson(metadata), now, now);
  return true;
}

function updateTimelineTrackState(db, trackId, status, metadata) {
  db.prepare('UPDATE timeline_tracks SET status = ?, metadata = ?, updated_at = ? WHERE id = ?')
    .run(status, toJson(metadata), nowIso(), Number(trackId));
}

function countTimelineItems(db, trackId) {
  return db.prepare('SELECT COUNT(*) AS count FROM timeline_items WHERE track_id = ?')
    .get(Number(trackId)).count || 0;
}

function ensureTimelinePlan(db, log, dramaId, mode = 'draft') {
  const episodes = db.prepare(
    'SELECT id, episode_number FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
  ).all(Number(dramaId));
  let trackCreatedOrFound = 0;
  let itemCreated = 0;

  for (const episode of episodes) {
    const tracks = {
      video: findOrCreateTimelineTrack(db, episode.id, 'video', '视频', 10),
      subtitle: findOrCreateTimelineTrack(db, episode.id, 'subtitle', '字幕', 20),
      voice: findOrCreateTimelineTrack(db, episode.id, 'voice', '旁白', 30),
      dialogue: findOrCreateTimelineTrack(db, episode.id, 'dialogue', '对白', 35),
      effect: findOrCreateTimelineTrack(db, episode.id, 'effect', '音效', 40),
      bgm: findOrCreateTimelineTrack(db, episode.id, 'bgm', 'BGM', 50),
      transition: findOrCreateTimelineTrack(db, episode.id, 'transition', '转场', 60),
    };
    trackCreatedOrFound += Object.keys(tracks).length;
    db.prepare(
      `DELETE FROM timeline_items
        WHERE track_id IN (?, ?, ?)
          AND (
            source_path LIKE 'mock://%'
            OR source_path LIKE 'placeholder://%'
            OR metadata LIKE '%"placeholder":true%'
          )`
    ).run(tracks.effect, tracks.bgm, tracks.transition);
    if (mode === 'production') {
      const trackIds = Object.values(tracks);
      const placeholders = trackIds.map(() => '?').join(',');
      db.prepare(
        `DELETE FROM timeline_items
          WHERE track_id IN (${placeholders})
            AND (
              source_path LIKE 'mock://%'
              OR source_path LIKE 'placeholder://%'
              OR metadata LIKE '%"placeholder":true%'
            )`
      ).run(...trackIds);
    }
    const storyboards = db.prepare(
      `SELECT id, storyboard_number, duration, dialogue, narration, video_url, video_local_path,
              audio_local_path, narration_audio_local_path
         FROM storyboards
        WHERE episode_id = ? AND deleted_at IS NULL
        ORDER BY storyboard_number ASC, id ASC`
    ).all(episode.id);
    let cursor = 0;
    for (const sb of storyboards) {
      const duration = Math.max(1, Number(sb.duration) || 5);
      const start = cursor;
      const end = cursor + duration;
      if (mode === 'production') {
        const videoPath = sb.video_local_path || sb.video_url;
        if (videoPath && !/^(?:mock|placeholder):\/\//i.test(videoPath)) {
          if (upsertTimelineItem(db, tracks.video, sb.id, start, end, videoPath, { workflow: 'novel2anime', kind: 'video', production: true })) itemCreated += 1;
        }
        const subtitle = sb.dialogue || sb.narration || '';
        if (subtitle) {
          if (upsertTimelineItem(db, tracks.subtitle, sb.id, start, end, subtitle, { kind: 'subtitle', production: true })) itemCreated += 1;
        }
        if (sb.narration_audio_local_path) {
          if (upsertTimelineItem(db, tracks.voice, sb.id, start, end, sb.narration_audio_local_path, { kind: 'voice', production: true })) itemCreated += 1;
        }
        if (sb.audio_local_path) {
          if (upsertTimelineItem(db, tracks.dialogue, sb.id, start, end, sb.audio_local_path, { kind: 'dialogue', text: sb.dialogue || '', production: true })) itemCreated += 1;
        }
      } else {
        if (insertTimelineItemIfMissing(db, tracks.video, sb.id, start, end, `mock://storyboard/${sb.id}/video`, { workflow: 'novel2anime', placeholder: true })) itemCreated += 1;
        if (insertTimelineItemIfMissing(db, tracks.subtitle, sb.id, start, end, sb.dialogue || sb.narration || '', { kind: 'subtitle' })) itemCreated += 1;
        if (insertTimelineItemIfMissing(db, tracks.voice, sb.id, start, end, `mock://storyboard/${sb.id}/voice`, { kind: 'voice', placeholder: true })) itemCreated += 1;
        if (insertTimelineItemIfMissing(db, tracks.dialogue, sb.id, start, end, sb.dialogue || '', { kind: 'dialogue', placeholder: !sb.dialogue })) itemCreated += 1;
      }
      cursor = end;
    }
    for (const type of ['effect', 'bgm', 'transition']) {
      updateTimelineTrackState(db, tracks[type], 'unused', {
        workflow: 'novel2anime',
        optional: true,
        usage: 'unused',
      });
    }
    for (const type of ['video', 'subtitle', 'voice', 'dialogue']) {
      const itemCount = countTimelineItems(db, tracks[type]);
      updateTimelineTrackState(db, tracks[type], itemCount > 0 ? 'ready' : 'pending', {
        workflow: 'novel2anime',
        optional: false,
        item_count: itemCount,
      });
    }
  }
  log?.info?.('Workflow timeline plan prepared', { drama_id: dramaId, episode_count: episodes.length, itemCreated });
  return { episode_count: episodes.length, track_count: trackCreatedOrFound, timeline_item_created: itemCreated };
}

module.exports = {
  findOrCreateTimelineTrack,
  insertTimelineItemIfMissing,
  upsertTimelineItem,
  updateTimelineTrackState,
  countTimelineItems,
  ensureTimelinePlan,
};
