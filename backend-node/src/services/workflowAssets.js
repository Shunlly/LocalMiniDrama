/**
 * 工作流资产准备：节拍切分、角色场景资产、创意审阅与分镜草稿。
 * 路由仍通过 workflowService 调用，本模块不改变公开 API。
 */

const characterContinuityService = require('./characterContinuityService');
const { nowIso, parseJson, toJson } = require('./workflowStatus');

function splitScriptIntoBeats(script, count) {
  const sentences = String(script || '')
    .split(/(?<=[。！？!?；;.\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const desired = Math.max(1, Math.min(8, Number(count) || Math.ceil(sentences.length / 2) || 3));
  if (!sentences.length) return ['故事节拍'];
  const beats = [];
  for (let i = 0; i < desired; i++) {
    const start = Math.floor((i * sentences.length) / desired);
    const end = Math.floor(((i + 1) * sentences.length) / desired);
    const chunk = sentences.slice(start, Math.max(start + 1, end)).join('');
    if (chunk.trim()) beats.push(chunk.trim());
  }
  return beats.length ? beats : [String(script).slice(0, 400) || '故事节拍'];
}

function ensureAssetBible(db, log, dramaId, mode = 'draft') {
  const now = nowIso();
  const eventRows = db.prepare(
    'SELECT characters, location, detail FROM story_events WHERE drama_id = ? ORDER BY event_no ASC, id ASC'
  ).all(Number(dramaId));
  const characterNames = new Set();
  const locations = new Set();
  for (const event of eventRows) {
    const chars = parseJson(event.characters, []);
    if (Array.isArray(chars)) chars.forEach((name) => {
      const clean = String(name || '').trim();
      if (clean) characterNames.add(clean);
    });
    const location = String(event.location || '').trim();
    if (location) locations.add(location);
  }
  if (!characterNames.size) characterNames.add('主角');
  if (!locations.size) locations.add('主要场景');

  const insertCharacter = db.prepare(
    `INSERT INTO characters
     (drama_id, name, role, description, personality, appearance, image_url, local_path, identity_anchors, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let characterCreated = 0;
  Array.from(characterNames).slice(0, 12).forEach((name, index) => {
    const exists = db.prepare(
      'SELECT id FROM characters WHERE drama_id = ? AND name = ? AND deleted_at IS NULL'
    ).get(Number(dramaId), name);
    if (exists) return;
    const referencePath = mode === 'production'
      ? null
      : `mock://dramas/${dramaId}/characters/${index + 1}/reference.png`;
    insertCharacter.run(
      Number(dramaId),
      name,
      index === 0 ? 'main' : 'supporting',
      `${name}来自原始故事，角色信息已进入制作资产。`,
      '跨集保持角色动机、说话方式和行为逻辑一致。',
      `${name}的外观身份已锁定，分镜和媒体生成时保持一致。`,
      referencePath,
      referencePath,
      toJson({ locked_name: name, source: 'workflow_asset_bible', consistency_rule: 'do not rewrite identity anchors in downstream steps' }),
      index,
      now,
      now
    );
    characterCreated += 1;
  });

  if (mode === 'production') {
    db.prepare(
      `UPDATE characters
          SET image_url = CASE WHEN image_url LIKE 'mock://%' OR image_url LIKE 'placeholder://%' THEN NULL ELSE image_url END,
              local_path = CASE WHEN local_path LIKE 'mock://%' OR local_path LIKE 'placeholder://%' THEN NULL ELSE local_path END,
              updated_at = ?
        WHERE drama_id = ? AND deleted_at IS NULL`
    ).run(now, Number(dramaId));
  }

  const insertScene = db.prepare(
    `INSERT INTO scenes (drama_id, location, time, prompt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?)`
  );
  let sceneCreated = 0;
  Array.from(locations).slice(0, 12).forEach((location) => {
    const exists = db.prepare(
      'SELECT id FROM scenes WHERE drama_id = ? AND location = ? AND deleted_at IS NULL'
    ).get(Number(dramaId), location);
    if (exists) return;
    insertScene.run(Number(dramaId), location, 'day', `${location}，短剧电影感环境，空间与光线连续性保持一致`, now, now);
    sceneCreated += 1;
  });

  const propCreated = 0;

  const continuity = mode === 'production'
    ? { character_count: characterNames.size, updated: 0, episode_range: [] }
    : characterContinuityService.ensureCharacterContinuity(db, log, dramaId);
  log?.info?.('Workflow asset bible prepared', { drama_id: dramaId, characterCreated, sceneCreated, propCreated });
  return {
    character_created: characterCreated,
    scene_created: sceneCreated,
    prop_created: propCreated,
    character_continuity: {
      character_count: continuity.character_count,
      updated: continuity.updated,
      episode_range: continuity.episode_range,
    },
  };
}

function createCreativeReview(db, { dramaId, runId, sourceId, role, targetType, targetId, status, findings }) {
  const now = nowIso();
  const existing = db.prepare(
    `SELECT id FROM creative_reviews
     WHERE run_id = ? AND role = ? AND target_type = ? AND COALESCE(target_id, '') = COALESCE(?, '')
     ORDER BY id ASC LIMIT 1`
  ).get(runId || null, role, targetType, targetId || null);
  if (existing) return existing.id;
  const info = db.prepare(
    `INSERT INTO creative_reviews
     (drama_id, run_id, source_id, role, target_type, target_id, status, findings_json, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    dramaId || null,
    runId || null,
    sourceId || null,
    role,
    targetType,
    targetId || null,
    status || 'locked',
    toJson(findings || []),
    now,
    status === 'locked' || status === 'resolved' ? now : null
  );
  return Number(info.lastInsertRowid);
}

function ensureStoryboardDraft(db, log, dramaId) {
  const now = nowIso();
  const episodes = db.prepare(
    'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
  ).all(Number(dramaId));
  const characters = db.prepare(
    'SELECT id, name FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC'
  ).all(Number(dramaId));
  const scenes = db.prepare(
    'SELECT id, location FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(Number(dramaId));
  const insertStoryboard = db.prepare(
    `INSERT INTO storyboards
     (episode_id, storyboard_number, title, description, layout_description, location, time, duration, dialogue, narration,
      action, atmosphere, image_prompt, video_prompt, shot_type, angle, movement, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
  );
  let created = 0;
  let skippedEpisodes = 0;

  for (const episode of episodes) {
    const existing = db.prepare(
      "SELECT COUNT(*) AS count FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL AND COALESCE(status, '') != 'stale'"
    ).get(episode.id).count || 0;
    if (existing > 0) {
      skippedEpisodes += 1;
      continue;
    }
    const beats = splitScriptIntoBeats(episode.script_content, 4);
    beats.forEach((beat, index) => {
      const num = index + 1;
      const title = `第 ${episode.episode_number || episode.id} 集 · 分镜 ${num}`;
      const referencedCharacters = characters.filter((character) => (
        String(character.name || '').trim() && beat.includes(String(character.name).trim())
      ));
      const scene = scenes.find((candidate) => (
        String(candidate.location || '').trim() && beat.includes(String(candidate.location).trim())
      )) || scenes[0] || null;
      const location = scene?.location || '';
      const action = beat.slice(0, 500);
      const inserted = insertStoryboard.run(
        episode.id,
        num,
        title,
        action,
        '构图稳定，角色站位清楚，动作易于识别。',
        location,
        'day',
        5,
        '',
        action,
        action,
        '戏剧张力清晰，可直接进入制作',
        `${action}，${location || '故事场景'}，角色造型一致，干净的电影感动画画面`,
        `${action}，镜头运动跟随情绪节拍，保持角色身份与场景连续性`,
        index === 0 ? 'wide' : 'medium',
        'eye_level',
        index % 2 === 0 ? 'slow push in' : 'static hold',
        now,
        now
      );
      db.prepare('UPDATE storyboards SET scene_id = ?, characters = ?, updated_at = ? WHERE id = ?')
        .run(
          scene?.id || null,
          toJson(referencedCharacters.map((character) => ({ id: character.id, name: character.name }))),
          now,
          Number(inserted.lastInsertRowid)
        );
      created += 1;
    });
  }
  log?.info?.('Workflow storyboard draft prepared', { drama_id: dramaId, created, skippedEpisodes });
  return { storyboard_created: created, episode_count: episodes.length, skipped_episodes: skippedEpisodes };
}

module.exports = {
  splitScriptIntoBeats,
  ensureAssetBible,
  createCreativeReview,
  ensureStoryboardDraft,
};
