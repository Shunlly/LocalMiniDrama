function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const sec = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function rowToTimelineItem(row) {
  return {
    id: row.id,
    track_id: row.track_id,
    storyboard_id: row.storyboard_id,
    start_sec: Number(row.start_sec) || 0,
    end_sec: Number(row.end_sec) || 0,
    duration_sec: Math.max(0, (Number(row.end_sec) || 0) - (Number(row.start_sec) || 0)),
    source_path: row.source_path || '',
    metadata: parseJson(row.metadata, {}),
    storyboard: row.storyboard_id ? {
      id: row.storyboard_id,
      storyboard_number: row.storyboard_number,
      title: row.storyboard_title,
      dialogue: row.dialogue || '',
      narration: row.narration || '',
      action: row.action || '',
      video_url: row.video_url || '',
      image_url: row.image_url || '',
      audio_local_path: row.audio_local_path || '',
      narration_audio_local_path: row.narration_audio_local_path || '',
    } : null,
  };
}

function getEpisode(db, episodeId) {
  return db.prepare(
    `SELECT ep.*, d.title AS drama_title
       FROM episodes ep
       INNER JOIN dramas d ON d.id = ep.drama_id
      WHERE ep.id = ? AND ep.deleted_at IS NULL AND d.deleted_at IS NULL`
  ).get(Number(episodeId));
}

function listEpisodes(db, dramaId) {
  return db.prepare(
    `SELECT id, drama_id, episode_number, title, video_url, status
       FROM episodes
      WHERE drama_id = ? AND deleted_at IS NULL
      ORDER BY episode_number ASC, id ASC`
  ).all(Number(dramaId));
}

function getEpisodeTimeline(db, episodeId) {
  const episode = getEpisode(db, episodeId);
  if (!episode) return null;
  const tracks = db.prepare(
    `SELECT *
       FROM timeline_tracks
      WHERE episode_id = ?
      ORDER BY sort_order ASC, id ASC`
  ).all(Number(episodeId));

  const rows = tracks.length
    ? db.prepare(
      `SELECT ti.*,
              sb.storyboard_number,
              sb.title AS storyboard_title,
              sb.dialogue,
              sb.narration,
              sb.action,
              sb.video_url,
              sb.image_url,
              sb.audio_local_path,
              sb.narration_audio_local_path
         FROM timeline_items ti
         LEFT JOIN storyboards sb ON sb.id = ti.storyboard_id
        WHERE ti.track_id IN (${tracks.map(() => '?').join(',')})
        ORDER BY ti.start_sec ASC, ti.id ASC`
    ).all(...tracks.map((track) => track.id))
    : [];
  const byTrack = new Map();
  for (const row of rows) {
    if (!byTrack.has(row.track_id)) byTrack.set(row.track_id, []);
    byTrack.get(row.track_id).push(rowToTimelineItem(row));
  }

  const hydratedTracks = tracks.map((track) => {
    const items = byTrack.get(track.id) || [];
    return {
      id: track.id,
      episode_id: track.episode_id,
      type: track.type,
      name: track.name,
      sort_order: track.sort_order,
      status: track.status || 'pending',
      metadata: parseJson(track.metadata, {}),
      duration_sec: items.reduce((max, item) => Math.max(max, item.end_sec), 0),
      item_count: items.length,
      items,
    };
  });

  return {
    episode: {
      id: episode.id,
      drama_id: episode.drama_id,
      drama_title: episode.drama_title,
      episode_number: episode.episode_number,
      title: episode.title,
      video_url: episode.video_url || '',
      status: episode.status || '',
    },
    summary: {
      track_count: hydratedTracks.length,
      item_count: rows.length,
      duration_sec: hydratedTracks.reduce((max, track) => Math.max(max, track.duration_sec), 0),
      track_types: hydratedTracks.map((track) => track.type),
    },
    tracks: hydratedTracks,
  };
}

function getDramaTimeline(db, dramaId) {
  const drama = db.prepare('SELECT id, title, status FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(dramaId));
  if (!drama) return null;
  const episodes = listEpisodes(db, dramaId).map((episode) => getEpisodeTimeline(db, episode.id)).filter(Boolean);
  return {
    drama,
    summary: {
      episode_count: episodes.length,
      track_count: episodes.reduce((sum, episode) => sum + episode.summary.track_count, 0),
      item_count: episodes.reduce((sum, episode) => sum + episode.summary.item_count, 0),
      duration_sec: episodes.reduce((sum, episode) => sum + episode.summary.duration_sec, 0),
      track_types: Array.from(new Set(episodes.flatMap((episode) => episode.summary.track_types))),
    },
    episodes,
  };
}

function subtitleText(item) {
  return String(
    item.storyboard?.dialogue ||
    item.storyboard?.narration ||
    item.source_path ||
    item.storyboard?.action ||
    ''
  ).trim();
}

function exportEpisodeSrt(db, episodeId) {
  const timeline = getEpisodeTimeline(db, episodeId);
  if (!timeline) return null;
  const subtitleTrack = timeline.tracks.find((track) => track.type === 'subtitle') || timeline.tracks[0];
  const cues = (subtitleTrack?.items || [])
    .map((item) => ({ item, text: subtitleText(item) }))
    .filter((cue) => cue.text);
  const content = cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTime(cue.item.start_sec)} --> ${formatSrtTime(cue.item.end_sec)}`,
    cue.text,
  ].join('\n')).join('\n\n');
  return {
    episode: timeline.episode,
    cue_count: cues.length,
    content: content ? `${content}\n` : '',
  };
}

function exportDramaManifest(db, dramaId) {
  const timeline = getDramaTimeline(db, dramaId);
  if (!timeline) return null;
  return {
    schema: 'localminidrama.timeline_manifest.v1',
    generated_at: new Date().toISOString(),
    drama: timeline.drama,
    summary: timeline.summary,
    episodes: timeline.episodes.map((episode) => ({
      episode: episode.episode,
      summary: episode.summary,
      tracks: episode.tracks.map((track) => ({
        id: track.id,
        type: track.type,
        name: track.name,
        status: track.status,
        metadata: track.metadata,
        item_count: track.item_count,
        duration_sec: track.duration_sec,
        items: track.items.map((item) => ({
          id: item.id,
          storyboard_id: item.storyboard_id,
          start_sec: item.start_sec,
          end_sec: item.end_sec,
          source_path: item.source_path,
          metadata: item.metadata,
        })),
      })),
    })),
  };
}

module.exports = {
  formatSrtTime,
  getEpisodeTimeline,
  getDramaTimeline,
  exportEpisodeSrt,
  exportDramaManifest,
};
