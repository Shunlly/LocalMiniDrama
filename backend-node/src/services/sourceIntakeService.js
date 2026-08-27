const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dramaService = require('./dramaService');
const dramaWriteGuard = require('./dramaWriteGuard');
const uploadService = require('./uploadService');
const { detectChaptersByRules } = require('./novelImportService');

const SOURCE_TYPES = new Set(['novel', 'outline', 'script', 'storyboard', 'comic', 'transcript']);

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function normalizeMetadata(value) {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
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
      const unsafe = new Error('The source text path is not a regular file.');
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

function trimText(value, max = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 3).trimEnd() + '...';
}

const CHINESE_NUMERAL = '零〇一二三四五六七八九十百千万两';
const EPISODE_HEADING_RE = new RegExp(`^(第\\s*(?:\\d+|[${CHINESE_NUMERAL}]+)\\s*[集章回]|EP(?:ISODE)?\\.?\\s*\\d+|Episode\\s*\\d+)`, 'i');
const STORYBOARD_HEADING_RE = new RegExp(`^(镜头|分镜|shot|scene)\\s*(?:\\d+|[${CHINESE_NUMERAL}]+)?`, 'i');

function normalizeSourceType(sourceType, text) {
  const requested = String(sourceType || '').trim().toLowerCase();
  if (SOURCE_TYPES.has(requested)) return requested;

  const body = String(text || '');
  if (/(\bshot\b|\bscene\b|镜头|分镜|画面|运镜|时长)/i.test(body)) return 'storyboard';
  if (/(第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*集|EP(?:ISODE)?\.?\s*\d+|Episode\s*\d+|对白|旁白|内景|外景|INT\.|EXT\.)/i.test(body)) return 'script';
  if (/(\[\d{1,2}:\d{2}(?::\d{2})?\]|\d{1,2}:\d{2}\s+.+:|speaker\s*\d*:)/i.test(body)) return 'transcript';
  if (/(漫画|分格|格子|panel|comic)/i.test(body)) return 'comic';
  if (detectChaptersByRules(body).length > 1 || body.length > 1800) return 'novel';
  return 'outline';
}

function splitByHeading(text, pattern) {
  const lines = String(text || '').split(/\r?\n/);
  const chunks = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line ? line.match(pattern) : null;
    if (heading) {
      if (current && current.content.join('\n').trim()) chunks.push(current);
      const marker = heading[0] || line;
      const rest = line.slice(marker.length).trim();
      current = { title: marker.trim(), content: rest ? [rest] : [] };
      continue;
    }
    if (!current) current = { title: '', content: [] };
    current.content.push(rawLine);
  }
  if (current && current.content.join('\n').trim()) chunks.push(current);
  return chunks.map((c, index) => ({
    title: c.title || `Part ${index + 1}`,
    content: c.content.join('\n').trim(),
  }));
}

function splitSourceItems(sourceType, text, title) {
  const body = String(text || '').trim();
  let chunks = [];
  let itemType = sourceType;

  if (sourceType === 'novel') {
    chunks = detectChaptersByRules(body).map((chapter) => ({
      title: chapter.title,
      content: chapter.content,
    }));
    itemType = 'chapter';
  } else if (sourceType === 'script') {
    chunks = splitByHeading(body, EPISODE_HEADING_RE);
    itemType = 'episode_script';
  } else if (sourceType === 'storyboard') {
    chunks = splitByHeading(body, STORYBOARD_HEADING_RE);
    itemType = 'storyboard_scene';
  } else if (sourceType === 'transcript') {
    chunks = splitByHeading(body, /^(\[\d{1,2}:\d{2}(?::\d{2})?\]|\d{1,2}:\d{2})/);
    itemType = 'transcript_segment';
  }

  if (!chunks.length) {
    chunks = [{ title: title || `${sourceType} source`, content: body }];
  }

  return chunks
    .filter((chunk) => chunk.content && chunk.content.trim())
    .map((chunk, index) => ({
      item_type: itemType,
      item_no: index + 1,
      title: trimText(chunk.title || `${itemType} ${index + 1}`, 120),
      raw_text: chunk.content.trim(),
      summary: trimText(chunk.content, 500),
      status: 'ready',
    }));
}

function cleanEntityName(value) {
  return String(value || '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/^(角色|人物|地点|场景|location|scene|characters?)\s*[:：]?/i, '')
    .replace(/[。.!?？；;].*$/g, '')
    .trim();
}

function extractCharacters(text) {
  const names = new Set();
  const body = String(text || '');
  const explicit = body.match(/(?:角色|人物|characters?)\s*[:：]\s*([^\n]+)/i);
  if (explicit) {
    explicit[1]
      .split(/(?:地点|场景|location|scene)\s*[:：]/i)[0]
      .split(/[、,，;；/|\s]+/)
      .map(cleanEntityName)
      .filter((name) => name.length >= 2 && name.length <= 16)
      .forEach((name) => names.add(name));
  }
  for (const m of body.matchAll(/@([\p{Script=Han}A-Za-z0-9_\-]{2,16})/gu)) {
    names.add(m[1]);
  }
  for (const m of body.matchAll(/^\s*([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9_\-]{1,15})\s*[：:]/gmu)) {
    const name = cleanEntityName(m[1]);
    if (!/^(角色|人物|地点|场景|location|scene|characters?|speaker)$/i.test(name)) names.add(name);
  }
  return Array.from(names).slice(0, 12);
}

function extractLocation(text) {
  const body = String(text || '');
  const explicit = body.match(/(?:地点|场景|location|scene)\s*[:：]\s*([^\n]+)/i);
  if (explicit) {
    const value = explicit[1].split(/(?:角色|人物|characters?)\s*[:：]/i)[0];
    return trimText(cleanEntityName(value), 80);
  }
  const slugline = body.match(/\b(?:INT|EXT)\.\s*([^\n.-]+(?:[- ]+[^\n.-]+)?)/i);
  return slugline ? trimText(cleanEntityName(slugline[1]), 80) : '';
}

function estimateTension(text) {
  const body = String(text || '');
  let score = 1;
  if (/[！!？?]/.test(body)) score += 1;
  if (/(冲突|危机|追逐|爆炸|死亡|告白|背叛|秘密|真相|反转|conflict|crisis|chase|betray|secret|reveal|truth|cliffhanger)/i.test(body)) score += 2;
  if (body.length > 800) score += 1;
  return Math.max(1, Math.min(5, score));
}

function scoreKeyword(text, patterns) {
  const body = String(text || '').toLowerCase();
  return patterns.reduce((sum, pattern) => sum + (pattern.test(body) ? 1 : 0), 0);
}

function inferEventRelations(previous, current, index, total) {
  const relations = ['next'];
  const prevText = `${previous?.title || ''}\n${previous?.detail || ''}`;
  const currentText = `${current?.title || ''}\n${current?.detail || ''}`;
  const combined = `${prevText}\n${currentText}`;

  if (
    scoreKeyword(combined, [
      /because|therefore|so that|as a result|导致|因此|所以|于是|引发|结果|不得不/i,
    ]) > 0 ||
    Number(current?.tension || 0) > Number(previous?.tension || 0)
  ) {
    relations.push('cause');
  }

  if (scoreKeyword(combined, [
    /conflict|fight|escape|chase|threat|betray|crisis|guard|enemy|冲突|争执|追逐|逃亡|危机|背叛|威胁|敌人|守卫|打斗|阻止|对峙/i,
  ]) > 0) {
    relations.push('conflict');
  }

  if (scoreKeyword(currentText, [
    /reveal|discover|secret|truth|clue|letter|map|warning|发现|揭开|真相|秘密|线索|信|地图|警告|身份|反转/i,
  ]) > 0) {
    relations.push('reveal');
  }

  if (
    index === total - 1 ||
    Number(current?.hook_score || 0) >= 4 ||
    scoreKeyword(currentText, [
      /cliffhanger|hook|but|suddenly|however|悬念|钩子|突然|然而|但是|没想到|下一秒|最后/i,
    ]) > 0
  ) {
    relations.push('hook');
  }

  return Array.from(new Set(relations));
}

function buildEventEdges(dramaId, sourceId, savedEvents) {
  const edges = [];
  for (let i = 1; i < savedEvents.length; i++) {
    const previous = savedEvents[i - 1];
    const current = savedEvents[i];
    const relations = inferEventRelations(previous, current, i, savedEvents.length);
    for (const relation of relations) {
      edges.push({
        drama_id: Number(dramaId),
        source_id: Number(sourceId),
        from_event_id: previous.id,
        to_event_id: current.id,
        relation_type: relation,
        description: relation === 'next'
          ? `Event ${previous.event_no} leads to event ${current.event_no}`
          : `${relation} relation inferred between event ${previous.event_no} and event ${current.event_no}`,
      });
    }
  }
  return edges;
}

function buildStoryEvents(dramaId, sourceType, items) {
  return items.map((item, index) => {
    const tension = estimateTension(item.raw_text);
    return {
      drama_id: Number(dramaId),
      source_item_id: null,
      event_no: index + 1,
      title: item.title || `素材事件 ${index + 1}`,
      detail: trimText(item.raw_text, 800),
      characters: extractCharacters(item.raw_text),
      location: extractLocation(item.raw_text),
      tension,
      hook_score: Math.max(1, Math.min(5, tension + (index === items.length - 1 ? 1 : 0))),
    };
  });
}

function summarizeEpisodeBeats(bucketItems, bucketEvents) {
  const beats = bucketEvents.length ? bucketEvents : bucketItems;
  return beats.map((item, index) => ({
    beat_no: index + 1,
    title: trimText(item.title || `情节点 ${index + 1}`, 120),
    summary: trimText(item.detail || item.summary || item.raw_text || '', 260),
    tension: item.tension || undefined,
    hook_score: item.hook_score || undefined,
  }));
}

function pickEpisodeSignal(bucketEvents, kind) {
  const patterns = {
    conflict: /conflict|fight|escape|chase|threat|betray|crisis|guard|enemy|冲突|争执|追逐|逃亡|危机|背叛|威胁|敌人|守卫|打斗|阻止|对峙/i,
    reveal: /reveal|discover|secret|truth|clue|letter|map|warning|发现|揭开|真相|秘密|线索|信|地图|警告|身份|反转/i,
  };
  const pattern = patterns[kind];
  const found = bucketEvents.find((event) => pattern && pattern.test(`${event.title || ''}\n${event.detail || ''}`));
  return found ? trimText(found.detail || found.title, 220) : '';
}

function buildAdaptationPlan({ dramaId, sourceId, sourceType, title, items, events, targetEpisodeCount, style }) {
  const count = Math.max(1, Math.floor(Number(targetEpisodeCount) || Math.min(items.length || 1, 12)));
  const episodes = [];
  for (let i = 0; i < count; i++) {
    const bucketItems = items.filter((_, idx) => Math.floor((idx * count) / Math.max(items.length, 1)) === i);
    const bucketEvents = events.filter((_, idx) => Math.floor((idx * count) / Math.max(events.length, 1)) === i);
    const first = bucketItems[0] || items[Math.min(i, Math.max(items.length - 1, 0))] || {};
    const beats = summarizeEpisodeBeats(bucketItems, bucketEvents);
    const characters = Array.from(new Set(bucketEvents.flatMap((event) => Array.isArray(event.characters) ? event.characters : [])));
    const locations = Array.from(new Set(bucketEvents.map((event) => event.location).filter(Boolean)));
    episodes.push({
      episode_number: i + 1,
      title: first.title || `第 ${i + 1} 集`,
      source_item_ids: bucketItems.map((item) => item.id).filter(Boolean),
      story_event_ids: bucketEvents.map((event) => event.id).filter(Boolean),
      source_trace: bucketItems.map((item) => ({ id: item.id, item_no: item.item_no, title: item.title })).filter((item) => item.id),
      beats,
      beat_summary: trimText(bucketItems.map((item) => item.summary || item.raw_text).join('\n'), 1200),
      conflict: pickEpisodeSignal(bucketEvents, 'conflict'),
      reveal: pickEpisodeSignal(bucketEvents, 'reveal'),
      hook: bucketEvents.length ? trimText(bucketEvents[bucketEvents.length - 1].title || bucketEvents[bucketEvents.length - 1].detail, 220) : '',
      continuity_notes: {
        characters,
        locations,
        source_item_count: bucketItems.length,
        story_event_count: bucketEvents.length,
      },
    });
  }

  return {
    drama_id: Number(dramaId),
    source_id: Number(sourceId),
    source_type: sourceType,
    source_title: title || '',
    target_episode_count: count,
    style: style || '',
    episodes,
    review_gates: ['writer_review', 'art_review', 'motion_review', 'director_lock'],
    created_by: 'source_intake_service',
  };
}

function rowToSource(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    source_type: row.source_type,
    title: row.title,
    raw_text_path: row.raw_text_path,
    content_hash: row.content_hash,
    metadata: parseJson(row.metadata, {}),
    created_at: row.created_at,
  };
}

function rowToItem(row) {
  return {
    id: row.id,
    source_id: row.source_id,
    item_type: row.item_type,
    item_no: row.item_no,
    title: row.title,
    raw_text: row.raw_text,
    summary: row.summary,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToEvent(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    source_item_id: row.source_item_id,
    event_no: row.event_no,
    title: row.title,
    detail: row.detail,
    characters: parseJson(row.characters, []),
    location: row.location,
    tension: row.tension,
    hook_score: row.hook_score,
    created_at: row.created_at,
  };
}

function rowToPlan(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    source_id: row.source_id,
    target_episode_count: row.target_episode_count,
    style: row.style,
    plan_json: parseJson(row.plan_json, {}),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createStorySource(db, log, params) {
  const dramaId = Number(params.drama_id || params.dramaId);
  dramaWriteGuard.assertDramaWritable(db, dramaId);
  const text = String(params.text || params.raw_text || '').trim();
  if (!text) {
    const err = new Error('source text is required');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const sourceType = normalizeSourceType(params.source_type, text);
  const title = String(params.title || '').trim() || `${sourceType} source`;
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

function listSourcesByDrama(db, dramaId) {
  const rows = db.prepare(
    `SELECT * FROM story_sources WHERE drama_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`
  ).all(Number(dramaId));
  return rows.map(rowToSource);
}

function getSourceById(db, sourceId) {
  const row = db.prepare('SELECT * FROM story_sources WHERE id = ? AND deleted_at IS NULL').get(Number(sourceId));
  if (!row) return null;
  dramaWriteGuard.assertDramaReadable(db, row.drama_id);
  return rowToSource(row);
}

function getSourceDetail(db, sourceId) {
  const source = getSourceById(db, sourceId);
  if (!source) return null;
  const items = db.prepare('SELECT * FROM source_items WHERE source_id = ? ORDER BY item_no ASC, id ASC').all(source.id).map(rowToItem);
  const itemIds = items.map((item) => item.id);
  let events = [];
  if (itemIds.length) {
    const placeholders = itemIds.map(() => '?').join(',');
    events = db.prepare(`SELECT * FROM story_events WHERE source_item_id IN (${placeholders}) ORDER BY event_no ASC, id ASC`).all(...itemIds).map(rowToEvent);
  }
  const eventEdges = getEventEdgesForSource(db, source.id);
  const plans = db.prepare('SELECT * FROM adaptation_plans WHERE source_id = ? ORDER BY created_at DESC, id DESC').all(source.id).map(rowToPlan);
  return { source, items, events, event_edges: eventEdges, adaptation_plans: plans };
}

function getEventEdgesForSource(db, sourceId) {
  try {
    return db.prepare(
      `SELECT * FROM story_event_edges
       WHERE source_id = ?
       ORDER BY id ASC`
    ).all(Number(sourceId)).map((row) => ({
      id: row.id,
      drama_id: row.drama_id,
      source_id: row.source_id,
      from_event_id: row.from_event_id,
      to_event_id: row.to_event_id,
      relation_type: row.relation_type,
      description: row.description,
      created_at: row.created_at,
    }));
  } catch (_) {
    return [];
  }
}

function getLatestPlanForSource(db, sourceId) {
  const row = db.prepare(
    `SELECT * FROM adaptation_plans WHERE source_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
  ).get(Number(sourceId));
  return row ? rowToPlan(row) : null;
}

function getAdaptationPlanById(db, planId) {
  const row = db.prepare('SELECT * FROM adaptation_plans WHERE id = ?').get(Number(planId));
  return row ? rowToPlan(row) : null;
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
     SET status = 'stale', error_msg = 'stale after adaptation overwrite', updated_at = ?
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
