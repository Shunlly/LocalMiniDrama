// 只读查询、行装配与状态计算见 sourceIntakeServiceQuery.js / sourceIntakeServiceAssembly.js / sourceIntakeServiceStatus.js

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dramaService = require('./dramaService');
const dramaWriteGuard = require('./dramaWriteGuard');
const uploadService = require('./uploadService');
const {
  toJson,
  normalizeMetadata,
  rowToSource,
  rowToItem,
  rowToEvent,
  rowToPlan,
} = require('./sourceIntakeServiceAssembly');
const {
  listSourcesByDrama,
  getSourceById,
  getSourceDetail,
  getEventEdgesForSource,
  getLatestPlanForSource,
  getAdaptationPlanById,
} = require('./sourceIntakeServiceQuery');
const {
  SOURCE_TYPES,
  normalizeSourceType,
  splitSourceItems,
  buildEventEdges,
  buildStoryEvents,
  buildAdaptationPlan,
} = require('./sourceIntakeServiceStatus');

function nowIso() {
  return new Date().toISOString();
}

function contentHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function resolveStorySourceRoot() {
  const testRoot = process.env.NODE_TEST_CONTEXT
    ? String(process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT || '').trim()
    : '';
  return testRoot
    ? path.resolve(testRoot)
    : path.join(process.cwd(), 'data', 'story_sources');
}

function persistRawSourceText(dramaId, hash, text) {
  const dir = path.join(resolveStorySourceRoot(), String(dramaId));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${hash}.txt`);
  let created = false;
  try {
    fs.writeFileSync(filePath, String(text || ''), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = fs.lstatSync(filePath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      const unsafe = new Error('素材文本路径不是普通文件');
      unsafe.code = 'UNSAFE_SOURCE_STORAGE';
      throw unsafe;
    }
  }
  return {
    absolutePath: filePath,
    created,
    relativePath: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
  };
}

function removeRawSourceText(artifact) {
  if (!artifact?.created) return;
  try {
    fs.unlinkSync(artifact.absolutePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    fs.rmdirSync(path.dirname(artifact.absolutePath));
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  }
}

function createStorySource(db, log, params) {
  const dramaId = Number(params.drama_id || params.dramaId);
  dramaWriteGuard.assertDramaWritable(db, dramaId);
  const text = String(params.text || params.raw_text || '').trim();
  if (!text) {
    const err = new Error('素材文本不能为空');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const sourceType = normalizeSourceType(params.source_type, text);
  const title = String(params.title || '').trim() || `${sourceType} 素材`;
  const items = splitSourceItems(sourceType, text, title);
  const createdAt = nowIso();
  const hash = contentHash(text);
  const metadata = {
    ...normalizeMetadata(params.metadata),
    classifier: params.source_type && SOURCE_TYPES.has(String(params.source_type).toLowerCase()) ? 'user' : 'rules',
    raw_text_length: text.length,
    item_count: items.length,
  };
  delete metadata.original_file;
  delete metadata.original_path;
  delete metadata.original_url;

  let originalArtifact = null;
  let rawTextArtifact = null;

  const tx = db.transaction(() => {
    rawTextArtifact = persistRawSourceText(dramaId, hash, text);
    const sourceInfo = db.prepare(
      `INSERT INTO story_sources (drama_id, source_type, title, raw_text_path, content_hash, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(dramaId, sourceType, title, rawTextArtifact.relativePath, hash, toJson(metadata), createdAt);
    const sourceId = Number(sourceInfo.lastInsertRowid);

    if (params.original_file) {
      const storageOptions = params.original_storage || {};
      originalArtifact = uploadService.persistStorySourceOriginal(
        storageOptions.storagePath,
        dramaId,
        sourceId,
        params.original_file,
        storageOptions
      );
      metadata.original_file = originalArtifact.metadata;
      db.prepare('UPDATE story_sources SET metadata = ? WHERE id = ?')
        .run(toJson(metadata), sourceId);
    }

    const insertItem = db.prepare(
      `INSERT INTO source_items (source_id, item_type, item_no, title, raw_text, summary, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const savedItems = items.map((item) => {
      const info = insertItem.run(
        sourceId,
        item.item_type,
        item.item_no,
        item.title,
        item.raw_text,
        item.summary,
        item.status,
        createdAt,
        createdAt
      );
      return { ...item, id: Number(info.lastInsertRowid), source_id: sourceId };
    });

    const events = buildStoryEvents(dramaId, sourceType, savedItems);
    const insertEvent = db.prepare(
      `INSERT INTO story_events (drama_id, source_item_id, event_no, title, detail, characters, location, tension, hook_score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const savedEvents = events.map((event, index) => {
      const sourceItemId = savedItems[index]?.id || null;
      const info = insertEvent.run(
        dramaId,
        sourceItemId,
        event.event_no,
        event.title,
        event.detail,
        toJson(event.characters),
        event.location,
        event.tension,
        event.hook_score,
        createdAt
      );
      return { ...event, id: Number(info.lastInsertRowid), source_item_id: sourceItemId, created_at: createdAt };
    });
    const insertEdge = db.prepare(
      `INSERT INTO story_event_edges (drama_id, source_id, from_event_id, to_event_id, relation_type, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const edge of buildEventEdges(dramaId, sourceId, savedEvents)) {
      insertEdge.run(
        edge.drama_id,
        edge.source_id,
        edge.from_event_id,
        edge.to_event_id,
        edge.relation_type,
        edge.description,
        createdAt
      );
    }

    const targetEpisodeCount = Math.max(1, Math.floor(Number(params.target_episode_count) || Number(params.episode_count) || savedItems.length || 1));
    const plan = buildAdaptationPlan({
      dramaId,
      sourceId,
      sourceType,
      title,
      items: savedItems,
      events: savedEvents,
      targetEpisodeCount,
      style: params.style,
    });
    const planInfo = db.prepare(
      `INSERT INTO adaptation_plans (drama_id, source_id, target_episode_count, style, plan_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`
    ).run(dramaId, sourceId, targetEpisodeCount, params.style || null, toJson(plan), createdAt, createdAt);

    return {
      source: getSourceById(db, Number(sourceId)),
      items: savedItems,
      events: savedEvents,
      event_edges: getEventEdgesForSource(db, sourceId),
      adaptation_plan: getAdaptationPlanById(db, Number(planInfo.lastInsertRowid)),
    };
  });

  let result;
  try {
    result = tx();
  } catch (error) {
    uploadService.removeStorySourceOriginal(originalArtifact, log);
    try {
      removeRawSourceText(rawTextArtifact);
    } catch (cleanupError) {
      log?.warn?.('Failed to clean rolled-back source text', { error: cleanupError.message });
    }
    throw error;
  }
  log?.info?.('Story source imported', {
    drama_id: dramaId,
    source_id: result.source.id,
    source_type: sourceType,
    item_count: result.items.length,
  });
  return result;
}

function createAdaptationPlan(db, log, sourceId, options = {}) {
  const detail = getSourceDetail(db, sourceId);
  if (!detail) return null;
  const count = Math.max(1, Math.floor(Number(options.target_episode_count) || detail.items.length || 1));
  const plan = buildAdaptationPlan({
    dramaId: detail.source.drama_id,
    sourceId: detail.source.id,
    sourceType: detail.source.source_type,
    title: detail.source.title,
    items: detail.items,
    events: detail.events,
    targetEpisodeCount: count,
    style: options.style || detail.source.metadata?.style,
  });
  const now = nowIso();
  const info = db.prepare(
    `INSERT INTO adaptation_plans (drama_id, source_id, target_episode_count, style, plan_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`
  ).run(detail.source.drama_id, detail.source.id, count, options.style || null, toJson(plan), now, now);
  log?.info?.('Adaptation plan created', { source_id: detail.source.id, plan_id: info.lastInsertRowid });
  return getAdaptationPlanById(db, Number(info.lastInsertRowid));
}

function insertEpisodesAppendOnly(db, dramaId, episodes) {
  const now = nowIso();
  const maxRow = db.prepare(
    'SELECT MAX(episode_number) AS max_no FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
  ).get(Number(dramaId));
  let nextNo = Number(maxRow?.max_no) || 0;
  const insert = db.prepare(
    `INSERT INTO episodes (drama_id, episode_number, title, script_content, description, duration, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 'draft', ?, ?)`
  );
  const saved = [];
  for (const episode of episodes) {
    nextNo += 1;
    const info = insert.run(
      Number(dramaId),
      nextNo,
      episode.title || `第 ${nextNo} 集`,
      episode.script_content || '',
      episode.description || null,
      now,
      now
    );
    saved.push({ ...episode, id: Number(info.lastInsertRowid), episode_number: nextNo });
  }
  db.prepare('UPDATE dramas SET updated_at = ? WHERE id = ?').run(now, Number(dramaId));
  return saved;
}

function markExistingStoryboardsStale(db, dramaId, episodes) {
  const numbers = episodes.map((episode) => Number(episode.episode_number)).filter(Boolean);
  if (!numbers.length) return 0;
  const placeholders = numbers.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id FROM episodes
     WHERE drama_id = ? AND episode_number IN (${placeholders}) AND deleted_at IS NULL`
  ).all(Number(dramaId), ...numbers);
  if (!rows.length) return 0;
  const episodeIds = rows.map((row) => row.id);
  const epPlaceholders = episodeIds.map(() => '?').join(',');
  const result = db.prepare(
    `UPDATE storyboards
     SET status = 'stale', error_msg = '改编方案覆盖后，该分镜已过期', updated_at = ?
     WHERE episode_id IN (${epPlaceholders}) AND deleted_at IS NULL`
  ).run(nowIso(), ...episodeIds);
  return result.changes || 0;
}

function applyAdaptationPlanToEpisodes(db, log, planId, options = {}) {
  const apply = db.transaction(() => {
    const plan = getAdaptationPlanById(db, planId);
    if (!plan) return null;

    // 计划行的 drama_id 才是本次写入的真实边界，不能用 plan_id 或来源 ID 代替。
    dramaWriteGuard.assertDramaWritable(db, plan.drama_id);
    const episodes = Array.isArray(plan.plan_json?.episodes) ? plan.plan_json.episodes : [];
    const savePayload = episodes.map((episode, index) => ({
      episode_number: Number(episode.episode_number) || index + 1,
      title: episode.title || `第 ${index + 1} 集`,
      script_content: [
        episode.beat_summary || '',
        episode.hook ? `\n悬念：${episode.hook}` : '',
      ].join('').trim(),
    }));

    const existingCount = db.prepare(
      'SELECT COUNT(*) AS count FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
    ).get(Number(plan.drama_id)).count || 0;
    const overwrite = options.overwrite === true || options.overwrite_existing_episodes === true;
    let savedEpisodes = [];
    let staleStoryboardCount = 0;

    if (overwrite) {
      staleStoryboardCount = markExistingStoryboardsStale(db, plan.drama_id, savePayload);
      const ok = dramaService.saveEpisodes(db, log, plan.drama_id, { episodes: savePayload });
      if (!ok) throw new Error('保存适配计划剧集失败');
      savedEpisodes = db.prepare(
        'SELECT id, episode_number, title, script_content FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
      ).all(Number(plan.drama_id));
    } else if (existingCount > 0) {
      savedEpisodes = insertEpisodesAppendOnly(db, plan.drama_id, savePayload);
    } else {
      const ok = dramaService.saveEpisodes(db, log, plan.drama_id, { episodes: savePayload });
      if (!ok) throw new Error('保存适配计划剧集失败');
      savedEpisodes = db.prepare(
        'SELECT id, episode_number, title, script_content FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
      ).all(Number(plan.drama_id));
    }

    const now = nowIso();
    db.prepare('UPDATE adaptation_plans SET status = ?, updated_at = ? WHERE id = ?').run('applied', now, plan.id);
    return {
      drama_id: plan.drama_id,
      plan_id: plan.id,
      episode_count: savedEpisodes.length,
      overwrite,
      stale_storyboard_count: staleStoryboardCount,
      episodes: savedEpisodes,
    };
  });

  const result = typeof apply.immediate === 'function' ? apply.immediate() : apply();
  if (result) {
    log?.info?.('Adaptation plan applied to episodes', {
      drama_id: result.drama_id,
      plan_id: result.plan_id,
      overwrite: result.overwrite,
      episode_count: result.episode_count,
      stale_storyboard_count: result.stale_storyboard_count,
    });
  }
  return result;
}

module.exports = {
  SOURCE_TYPES,
  normalizeSourceType,
  splitSourceItems,
  buildEventEdges,
  createStorySource,
  listSourcesByDrama,
  getSourceById,
  getSourceDetail,
  getEventEdgesForSource,
  getLatestPlanForSource,
  getAdaptationPlanById,
  createAdaptationPlan,
  applyAdaptationPlanToEpisodes,
  rowToSource,
  rowToItem,
  rowToEvent,
  rowToPlan,
  normalizeMetadata,
};
