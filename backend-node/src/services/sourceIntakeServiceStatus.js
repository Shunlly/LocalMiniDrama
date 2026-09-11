/**
 * 素材接入状态计算：来源分类、条目拆分、事件张力/关系与改编方案装配。
 * 路由仍通过 sourceIntakeService 调用，本模块不改变公开 API。
 */

const { detectChaptersByRules } = require('./novelImportService');
const { trimText } = require('./sourceIntakeServiceAssembly');

const SOURCE_TYPES = new Set(['novel', 'outline', 'script', 'storyboard', 'comic', 'transcript']);

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
    chunks = [{ title: title || `${sourceType} 素材`, content: body }];
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

module.exports = {
  SOURCE_TYPES,
  normalizeSourceType,
  splitSourceItems,
  buildEventEdges,
  buildStoryEvents,
  buildAdaptationPlan,
  estimateTension,
  extractCharacters,
  extractLocation,
};
