'use strict';

/**
 * 质量检查数据收集：分集、分镜、时间线、资产引用与生成媒体。
 * 路由仍通过 qaService 调用，本模块不改变公开 API。
 */

const {
  parseJson,
  hasText,
  isRealMediaPath,
  containsMockReference,
  isNonMockGenerationRow,
} = require('./qaServiceCheckRules');

function count(db, sql, ...params) {
  return db.prepare(sql).get(...params).count || 0;
}

function firstRealAsset(row, fields) {
  return fields.map((field) => row?.[field]).find(isRealMediaPath) || null;
}

function getEpisodes(db, dramaId, episodeId) {
  if (episodeId) {
    return db.prepare(
      `SELECT * FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC`
    ).all(Number(episodeId), Number(dramaId));
  }
  return db.prepare(
    `SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC`
  ).all(Number(dramaId));
}

function getStoryboardsForEpisodes(db, episodeIds) {
  if (!episodeIds.length) return [];
  const placeholders = episodeIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM storyboards
     WHERE episode_id IN (${placeholders}) AND deleted_at IS NULL
     ORDER BY episode_id ASC, storyboard_number ASC, id ASC`
  ).all(...episodeIds);
}

function hasTimelineForEpisodes(db, episodeIds, options = {}) {
  if (!episodeIds.length) return { ok: false, trackCount: 0, itemCount: 0, trackTypes: [], episodes: [] };
  const placeholders = episodeIds.map(() => '?').join(',');
  const tracks = db.prepare(
    `SELECT id, episode_id, type, status, metadata
       FROM timeline_tracks WHERE episode_id IN (${placeholders}) ORDER BY episode_id ASC, sort_order ASC`
  ).all(...episodeIds);
  const trackIds = tracks.map((track) => track.id);
  const items = trackIds.length
    ? db.prepare(
      `SELECT id, track_id, storyboard_id, start_sec, end_sec, source_path, metadata
         FROM timeline_items WHERE track_id IN (${trackIds.map(() => '?').join(',')})`
    ).all(...trackIds)
    : [];
  const trackTypes = Array.from(new Set(tracks.map((track) => track.type)));
  const requiredTrackTypes = ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'];
  const optionalTrackTypes = ['effect', 'bgm', 'transition'];
  const validItemsForTrack = (track) => items.filter((item) => {
    if (Number(item.track_id) !== Number(track.id)) return false;
    const metadata = parseJson(item.metadata, {});
    if (metadata?.placeholder === true) return false;
    if (!(Number(item.end_sec) > Number(item.start_sec))) return false;
    if (track.type === 'subtitle') return hasText(item.source_path);
    if (options.production) return isRealMediaPath(item.source_path);
    return hasText(item.source_path);
  });
  const episodeResults = episodeIds.map((episodeId) => {
    const episodeTracks = tracks.filter((track) => Number(track.episode_id) === Number(episodeId));
    const byType = new Map(episodeTracks.map((track) => [track.type, track]));
    const explicitTracks = requiredTrackTypes.every((type) => byType.has(type));
    const videoItems = byType.has('video') ? validItemsForTrack(byType.get('video')) : [];
    const subtitleItems = byType.has('subtitle') ? validItemsForTrack(byType.get('subtitle')) : [];
    const voiceItems = byType.has('voice') ? validItemsForTrack(byType.get('voice')) : [];
    const dialogueItems = byType.has('dialogue') ? validItemsForTrack(byType.get('dialogue')) : [];
    const optionalTracksExplicitlyUnused = !options.production || optionalTrackTypes.every((type) => {
      const track = byType.get(type);
      if (!track) return false;
      const metadata = parseJson(track.metadata, {});
      const validCount = validItemsForTrack(track).length;
      return validCount > 0 || (track.status === 'unused' && metadata.optional === true && metadata.usage === 'unused');
    });
    return {
      episode_id: Number(episodeId),
      passed: explicitTracks && videoItems.length > 0 && subtitleItems.length > 0 &&
        (voiceItems.length > 0 || dialogueItems.length > 0) && optionalTracksExplicitlyUnused,
      explicit_tracks: explicitTracks,
      video_item_count: videoItems.length,
      subtitle_item_count: subtitleItems.length,
      voice_item_count: voiceItems.length,
      dialogue_item_count: dialogueItems.length,
      optional_tracks_explicit: optionalTracksExplicitlyUnused,
      track_types: episodeTracks.map((track) => track.type),
    };
  });
  return {
    ok: episodeResults.length === episodeIds.length && episodeResults.every((episode) => episode.passed),
    trackCount: tracks.length,
    itemCount: items.length,
    trackTypes,
    requiredTrackTypes,
    optionalTrackTypes,
    episodes: episodeResults,
  };
}

function collectAssetReferenceFailures(db, storyboards, characterRows, sceneRows) {
  const characterById = new Map(characterRows.map((row) => [Number(row.id), row]));
  const characterByName = new Map(characterRows.map((row) => [String(row.name || '').trim().toLowerCase(), row]));
  const sceneById = new Map(sceneRows.map((row) => [Number(row.id), row]));
  const assetReferenceFailures = [];
  for (const storyboard of storyboards) {
    const references = parseJson(storyboard.characters, []);
    if (storyboard.characters && !Array.isArray(references)) {
      assetReferenceFailures.push({ storyboard_id: storyboard.id, type: 'character', reason: 'invalid_reference_list' });
    }
    for (const reference of Array.isArray(references) ? references : []) {
      const id = Number(typeof reference === 'object' && reference ? reference.id : reference);
      const name = String(typeof reference === 'object' && reference ? reference.name || '' : reference || '').trim().toLowerCase();
      const character = (Number.isSafeInteger(id) && id > 0 ? characterById.get(id) : null) || characterByName.get(name);
      if (!character || !firstRealAsset(character, ['local_path', 'image_url', 'four_view_image_url', 'seedance2_asset']) ||
        containsMockReference(character.identity_anchors) || containsMockReference(character.stages)) {
        assetReferenceFailures.push({ storyboard_id: storyboard.id, type: 'character', reference });
      }
    }
    if (storyboard.scene_id != null) {
      const scene = sceneById.get(Number(storyboard.scene_id));
      if (!scene || !firstRealAsset(scene, ['local_path', 'image_url', 'ref_image'])) {
        assetReferenceFailures.push({ storyboard_id: storyboard.id, type: 'scene', reference: storyboard.scene_id });
      }
    }
    const propReferences = db.prepare(
      `SELECT sp.prop_id, p.id, p.image_url, p.local_path, p.ref_image
         FROM storyboard_props sp
         LEFT JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
        WHERE sp.storyboard_id = ?`
    ).all(storyboard.id);
    for (const prop of propReferences) {
      if (!prop.id || !firstRealAsset(prop, ['local_path', 'image_url', 'ref_image'])) {
        assetReferenceFailures.push({ storyboard_id: storyboard.id, type: 'prop', reference: prop.prop_id });
      }
    }
    for (const field of ['reference_images', 'continuity_snapshot']) {
      if (containsMockReference(storyboard[field])) {
        assetReferenceFailures.push({ storyboard_id: storyboard.id, type: field, reason: 'mock_reference' });
      }
    }
  }
  return assetReferenceFailures;
}

function collectGeneratedMedia(db, storyboards) {
  const realMediaStoryboardIds = new Set();
  const realImageStoryboardIds = new Set();
  const realVideoStoryboardIds = new Set();
  for (const sb of storyboards) {
    if (
      isRealMediaPath(sb.video_url) ||
      isRealMediaPath(sb.local_path) ||
      isRealMediaPath(sb.image_url) ||
      isRealMediaPath(sb.audio_local_path) ||
      isRealMediaPath(sb.narration_audio_local_path)
    ) {
      realMediaStoryboardIds.add(Number(sb.id));
    }
  }
  let generatedMediaRows = [];
  if (storyboards.length) {
    const sbIds = storyboards.map((sb) => sb.id);
    const placeholders = sbIds.map(() => '?').join(',');
    const generatedImageRows = db.prepare(
       `SELECT storyboard_id, provider, image_url, NULL AS video_url, local_path
          FROM image_generations
         WHERE storyboard_id IN (${placeholders})
           AND status = 'completed'
           AND deleted_at IS NULL`
    ).all(
      ...sbIds
    ).filter(isNonMockGenerationRow);
    generatedMediaRows = generatedImageRows;
    const generatedVideoRows = db.prepare(
       `SELECT storyboard_id, provider, NULL AS image_url, video_url, local_path
          FROM video_generations
         WHERE storyboard_id IN (${placeholders})
           AND status = 'completed'
           AND deleted_at IS NULL`
    ).all(
      ...sbIds
    ).filter(isNonMockGenerationRow);
    generatedMediaRows.push(...generatedVideoRows);
    generatedImageRows.forEach((row) => realImageStoryboardIds.add(Number(row.storyboard_id)));
    generatedVideoRows.forEach((row) => realVideoStoryboardIds.add(Number(row.storyboard_id)));
    generatedMediaRows.forEach((row) => realMediaStoryboardIds.add(Number(row.storyboard_id)));
  }
  return {
    realMediaStoryboardIds,
    realImageStoryboardIds,
    realVideoStoryboardIds,
    generatedMediaRows,
  };
}

function collectSourceIntake(db, dramaId) {
  const sourceCount = count(db, 'SELECT COUNT(*) AS count FROM story_sources WHERE drama_id = ? AND deleted_at IS NULL', dramaId);
  const sourceItemCount = sourceCount
    ? count(
      db,
      `SELECT COUNT(*) AS count FROM source_items si
       INNER JOIN story_sources ss ON ss.id = si.source_id
       WHERE ss.drama_id = ? AND ss.deleted_at IS NULL`,
      dramaId
    )
    : 0;
  return { sourceCount, sourceItemCount };
}

function collectStoryIr(db, dramaId) {
  const eventCount = count(db, 'SELECT COUNT(*) AS count FROM story_events WHERE drama_id = ?', dramaId);
  const planCount = count(db, 'SELECT COUNT(*) AS count FROM adaptation_plans WHERE drama_id = ?', dramaId);
  const edgeCount = count(db, 'SELECT COUNT(*) AS count FROM story_event_edges WHERE drama_id = ?', dramaId);
  return { eventCount, planCount, edgeCount };
}

function collectCharacters(db, dramaId) {
  return db.prepare(
    `SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC`
  ).all(dramaId);
}

function collectScenes(db, dramaId) {
  return db.prepare('SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC').all(dramaId);
}

function collectProps(db, dramaId) {
  return db.prepare('SELECT * FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC').all(dramaId);
}

function collectWorkflowSteps(db, runId) {
  if (!runId) return [];
  return db.prepare('SELECT * FROM workflow_steps WHERE run_id = ? ORDER BY sort_order ASC').all(String(runId));
}

function collectProviderAudit(db, runId) {
  let providerCount = 0;
  let skillCount = 0;
  let providerRows = [];
  if (runId) {
    providerCount = count(db, 'SELECT COUNT(*) AS count FROM provider_invocations WHERE run_id = ?', String(runId));
    skillCount = count(db, 'SELECT COUNT(*) AS count FROM skill_invocations WHERE run_id = ?', String(runId));
    try {
      providerRows = db.prepare(
        `SELECT provider_type, provider_name, mode, status, output_json
           FROM provider_invocations
          WHERE run_id = ?`
      ).all(String(runId));
    } catch (_) {}
  }
  return { providerCount, skillCount, providerRows };
}

module.exports = {
  count,
  firstRealAsset,
  getEpisodes,
  getStoryboardsForEpisodes,
  hasTimelineForEpisodes,
  collectAssetReferenceFailures,
  collectGeneratedMedia,
  collectSourceIntake,
  collectStoryIr,
  collectCharacters,
  collectScenes,
  collectProps,
  collectWorkflowSteps,
  collectProviderAudit,
};
