const fs = require('fs');
const path = require('path');
const { getDb, enableForeignKeys } = require('./index.js');
const { loadConfig } = require('../config/index.js');

const DOMAIN_INTEGRITY_MIGRATION = '32_novel2anime_domain_integrity.sql';
const DOMAIN_INTEGRITY_ERROR_CODE = 'NOVEL2ANIME_DOMAIN_INTEGRITY_VIOLATION';

const DOMAIN_INTEGRITY_CHECKS = [
  {
    code: 'story_sources_missing_drama',
    sql: `SELECT CAST(ss.id AS TEXT) AS row_key
            FROM story_sources ss
            LEFT JOIN dramas d ON d.id = ss.drama_id
           WHERE d.id IS NULL`,
  },
  {
    code: 'source_items_missing_source',
    sql: `SELECT CAST(si.id AS TEXT) AS row_key
            FROM source_items si
            LEFT JOIN story_sources ss ON ss.id = si.source_id
           WHERE ss.id IS NULL`,
  },
  {
    code: 'source_items_duplicate_key',
    sql: `SELECT CAST(source_id AS TEXT) || ':' || item_type || ':' ||
                 COALESCE(CAST(item_no AS TEXT), 'null') AS row_key
            FROM source_items
           GROUP BY source_id, item_type, COALESCE(item_no, -1)
          HAVING COUNT(*) > 1`,
  },
  {
    code: 'story_events_missing_drama',
    sql: `SELECT CAST(se.id AS TEXT) AS row_key
            FROM story_events se
            LEFT JOIN dramas d ON d.id = se.drama_id
           WHERE d.id IS NULL`,
  },
  {
    code: 'story_events_missing_source_item',
    sql: `SELECT CAST(se.id AS TEXT) AS row_key
            FROM story_events se
            LEFT JOIN source_items si ON si.id = se.source_item_id
           WHERE se.source_item_id IS NOT NULL AND si.id IS NULL`,
  },
  {
    code: 'story_events_cross_drama',
    sql: `SELECT CAST(se.id AS TEXT) AS row_key
            FROM story_events se
            JOIN source_items si ON si.id = se.source_item_id
            JOIN story_sources ss ON ss.id = si.source_id
           WHERE se.drama_id <> ss.drama_id`,
  },
  {
    code: 'adaptation_plans_missing_drama',
    sql: `SELECT CAST(ap.id AS TEXT) AS row_key
            FROM adaptation_plans ap
            LEFT JOIN dramas d ON d.id = ap.drama_id
           WHERE d.id IS NULL`,
  },
  {
    code: 'adaptation_plans_missing_source',
    sql: `SELECT CAST(ap.id AS TEXT) AS row_key
            FROM adaptation_plans ap
            LEFT JOIN story_sources ss ON ss.id = ap.source_id
           WHERE ss.id IS NULL`,
  },
  {
    code: 'adaptation_plans_cross_drama',
    sql: `SELECT CAST(ap.id AS TEXT) AS row_key
            FROM adaptation_plans ap
            JOIN story_sources ss ON ss.id = ap.source_id
           WHERE ap.drama_id <> ss.drama_id`,
  },
  {
    code: 'workflow_runs_missing_drama',
    sql: `SELECT wr.id AS row_key
            FROM workflow_runs wr
            LEFT JOIN dramas d ON d.id = wr.drama_id
           WHERE d.id IS NULL`,
  },
  {
    code: 'workflow_runs_missing_episode',
    sql: `SELECT wr.id AS row_key
            FROM workflow_runs wr
            LEFT JOIN episodes ep ON ep.id = wr.episode_id
           WHERE wr.episode_id IS NOT NULL AND ep.id IS NULL`,
  },
  {
    code: 'workflow_runs_cross_drama',
    sql: `SELECT wr.id AS row_key
            FROM workflow_runs wr
            JOIN episodes ep ON ep.id = wr.episode_id
           WHERE wr.drama_id <> ep.drama_id`,
  },
  {
    code: 'workflow_steps_missing_run',
    sql: `SELECT ws.id AS row_key
            FROM workflow_steps ws
            LEFT JOIN workflow_runs wr ON wr.id = ws.run_id
           WHERE wr.id IS NULL`,
  },
  {
    code: 'workflow_steps_duplicate_key',
    sql: `SELECT run_id || ':' || step_key AS row_key
            FROM workflow_steps
           GROUP BY run_id, step_key
          HAVING COUNT(*) > 1`,
  },
  {
    code: 'timeline_tracks_missing_episode',
    sql: `SELECT CAST(tt.id AS TEXT) AS row_key
            FROM timeline_tracks tt
            LEFT JOIN episodes ep ON ep.id = tt.episode_id
           WHERE ep.id IS NULL`,
  },
  {
    code: 'timeline_tracks_duplicate_type',
    sql: `SELECT CAST(episode_id AS TEXT) || ':' || type AS row_key
            FROM timeline_tracks
           GROUP BY episode_id, type
          HAVING COUNT(*) > 1`,
  },
  {
    code: 'timeline_items_missing_track',
    sql: `SELECT CAST(ti.id AS TEXT) AS row_key
            FROM timeline_items ti
            LEFT JOIN timeline_tracks tt ON tt.id = ti.track_id
           WHERE tt.id IS NULL`,
  },
  {
    code: 'timeline_items_missing_storyboard',
    sql: `SELECT CAST(ti.id AS TEXT) AS row_key
            FROM timeline_items ti
            LEFT JOIN storyboards sb ON sb.id = ti.storyboard_id
           WHERE ti.storyboard_id IS NOT NULL AND sb.id IS NULL`,
  },
  {
    code: 'timeline_items_cross_episode',
    sql: `SELECT CAST(ti.id AS TEXT) AS row_key
            FROM timeline_items ti
            JOIN timeline_tracks tt ON tt.id = ti.track_id
            JOIN storyboards sb ON sb.id = ti.storyboard_id
           WHERE tt.episode_id <> sb.episode_id`,
  },
  {
    code: 'qa_reports_missing_drama',
    sql: `SELECT CAST(qr.id AS TEXT) AS row_key
            FROM qa_reports qr
            LEFT JOIN dramas d ON d.id = qr.drama_id
           WHERE d.id IS NULL`,
  },
  {
    code: 'qa_reports_missing_episode',
    sql: `SELECT CAST(qr.id AS TEXT) AS row_key
            FROM qa_reports qr
            LEFT JOIN episodes ep ON ep.id = qr.episode_id
           WHERE qr.episode_id IS NOT NULL AND ep.id IS NULL`,
  },
  {
    code: 'qa_reports_missing_run',
    sql: `SELECT CAST(qr.id AS TEXT) AS row_key
            FROM qa_reports qr
            LEFT JOIN workflow_runs wr ON wr.id = qr.run_id
           WHERE qr.run_id IS NOT NULL AND wr.id IS NULL`,
  },
  {
    code: 'qa_reports_cross_drama',
    sql: `SELECT CAST(qr.id AS TEXT) AS row_key
            FROM qa_reports qr
            LEFT JOIN episodes ep ON ep.id = qr.episode_id
            LEFT JOIN workflow_runs wr ON wr.id = qr.run_id
           WHERE (ep.id IS NOT NULL AND ep.drama_id <> qr.drama_id)
              OR (wr.id IS NOT NULL AND wr.drama_id <> qr.drama_id)`,
  },
  {
    code: 'qa_reports_cross_episode',
    sql: `SELECT CAST(qr.id AS TEXT) AS row_key
            FROM qa_reports qr
            JOIN workflow_runs wr ON wr.id = qr.run_id
           WHERE qr.episode_id IS NOT NULL
             AND wr.episode_id IS NOT NULL
             AND qr.episode_id <> wr.episode_id`,
  },
  {
    code: 'provider_invocations_missing_run',
    sql: `SELECT CAST(pi.id AS TEXT) AS row_key
            FROM provider_invocations pi
            LEFT JOIN workflow_runs wr ON wr.id = pi.run_id
           WHERE pi.run_id IS NOT NULL AND wr.id IS NULL`,
  },
  {
    code: 'provider_invocations_missing_step',
    sql: `SELECT CAST(pi.id AS TEXT) AS row_key
            FROM provider_invocations pi
            LEFT JOIN workflow_steps ws ON ws.id = pi.workflow_step_id
           WHERE pi.workflow_step_id IS NOT NULL AND ws.id IS NULL`,
  },
  {
    code: 'provider_invocations_cross_run',
    sql: `SELECT CAST(pi.id AS TEXT) AS row_key
            FROM provider_invocations pi
            JOIN workflow_steps ws ON ws.id = pi.workflow_step_id
           WHERE pi.run_id IS NOT NULL AND pi.run_id <> ws.run_id`,
  },
  {
    code: 'skill_invocations_missing_run',
    sql: `SELECT CAST(si.id AS TEXT) AS row_key
            FROM skill_invocations si
            LEFT JOIN workflow_runs wr ON wr.id = si.run_id
           WHERE si.run_id IS NOT NULL AND wr.id IS NULL`,
  },
  {
    code: 'skill_invocations_missing_step',
    sql: `SELECT CAST(si.id AS TEXT) AS row_key
            FROM skill_invocations si
            LEFT JOIN workflow_steps ws ON ws.id = si.workflow_step_id
           WHERE si.workflow_step_id IS NOT NULL AND ws.id IS NULL`,
  },
  {
    code: 'skill_invocations_cross_run',
    sql: `SELECT CAST(si.id AS TEXT) AS row_key
            FROM skill_invocations si
            JOIN workflow_steps ws ON ws.id = si.workflow_step_id
           WHERE si.run_id IS NOT NULL AND si.run_id <> ws.run_id`,
  },
  {
    code: 'story_event_edges_missing_drama',
    sql: `SELECT CAST(see.id AS TEXT) AS row_key
            FROM story_event_edges see
            LEFT JOIN dramas d ON d.id = see.drama_id
           WHERE d.id IS NULL`,
  },
  {
    code: 'story_event_edges_missing_source',
    sql: `SELECT CAST(see.id AS TEXT) AS row_key
            FROM story_event_edges see
            LEFT JOIN story_sources ss ON ss.id = see.source_id
           WHERE see.source_id IS NOT NULL AND ss.id IS NULL`,
  },
  {
    code: 'story_event_edges_missing_from_event',
    sql: `SELECT CAST(see.id AS TEXT) AS row_key
            FROM story_event_edges see
            LEFT JOIN story_events se ON se.id = see.from_event_id
           WHERE se.id IS NULL`,
  },
  {
    code: 'story_event_edges_missing_to_event',
    sql: `SELECT CAST(see.id AS TEXT) AS row_key
            FROM story_event_edges see
            LEFT JOIN story_events se ON se.id = see.to_event_id
           WHERE se.id IS NULL`,
  },
  {
    code: 'story_event_edges_cross_drama',
    sql: `SELECT CAST(see.id AS TEXT) AS row_key
            FROM story_event_edges see
            JOIN story_events from_event ON from_event.id = see.from_event_id
            JOIN story_events to_event ON to_event.id = see.to_event_id
            LEFT JOIN story_sources ss ON ss.id = see.source_id
           WHERE see.drama_id <> from_event.drama_id
              OR see.drama_id <> to_event.drama_id
              OR (ss.id IS NOT NULL AND see.drama_id <> ss.drama_id)`,
  },
  {
    code: 'story_event_edges_cross_source',
    sql: `SELECT CAST(see.id AS TEXT) AS row_key
            FROM story_event_edges see
            JOIN story_events se
              ON se.id IN (see.from_event_id, see.to_event_id)
            JOIN source_items si ON si.id = se.source_item_id
           WHERE see.source_id IS NOT NULL AND see.source_id <> si.source_id`,
  },
  {
    code: 'story_event_edges_duplicate_key',
    sql: `SELECT COALESCE(CAST(source_id AS TEXT), 'null') || ':' ||
                 CAST(from_event_id AS TEXT) || ':' || CAST(to_event_id AS TEXT) || ':' ||
                 relation_type AS row_key
            FROM story_event_edges
           GROUP BY COALESCE(source_id, -1), from_event_id, to_event_id, relation_type
          HAVING COUNT(*) > 1`,
  },
];

function auditNovel2AnimeDomainIntegrity(database, options = {}) {
  const sampleLimit = Math.max(1, Math.min(20, Number(options.sample_limit) || 5));
  const violations = [];
  for (const check of DOMAIN_INTEGRITY_CHECKS) {
    const count = Number(database.prepare(`SELECT COUNT(*) AS count FROM (${check.sql})`).get().count);
    if (count === 0) continue;
    const samples = database.prepare(`SELECT row_key FROM (${check.sql}) LIMIT ?`)
      .all(sampleLimit)
      .map((row) => String(row.row_key));
    violations.push({ code: check.code, count, samples });
  }
  return violations;
}

function domainIntegrityError(violations) {
  const details = violations
    .map((item) => `${item.code}=${item.count} [${item.samples.join(', ')}]`)
    .join('; ');
  const error = new Error(
    `Novel2Anime domain integrity audit failed; existing violations were not deleted or auto-repaired. ` +
    `Repair the reported legacy data before restart: ${details}`
  );
  error.code = DOMAIN_INTEGRITY_ERROR_CODE;
  error.violations = violations;
  return error;
}

function applyDomainIntegrityMigration(database, sql, file) {
  const apply = database.transaction(() => {
    const violations = auditNovel2AnimeDomainIntegrity(database);
    if (violations.length > 0) throw domainIntegrityError(violations);
    database.exec(sql);
  });
  apply.immediate();
  console.log('Ran migration:', file);
}

function stripLeadingComments(sql) {
  return sql
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith('--');
    })
    .join('\n')
    .trim();
}

function runOne(database, sql, file, index) {
  const s = stripLeadingComments(sql);
  if (!s) return;
  try {
    database.exec(s);
    console.log('Ran migration:', file + (index >= 0 ? ' #' + (index + 1) : ''));
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (err.code === 'SQLITE_ERROR' && (msg.includes('duplicate column') || msg.includes('already exists'))) {
      console.log('Skip (already exists):', file + (index >= 0 ? ' #' + (index + 1) : ''));
    } else if (err.code === 'SQLITE_ERROR' && msg.includes('no such table')) {
      // ALTER TABLE 遇到表不存在时，记录警告并跳过（启动后 ensureAllColumns 会兜底建表补列）
      console.warn('Skip migration (table not found, will be ensured later):', file, '-', err.message);
    } else {
      throw err;
    }
  }
}

function runMigrations(database) {
  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations dir missing: ${migrationsDir}`);
  }
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let domainIntegrityMigrationFound = false;
  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    if (file === DOMAIN_INTEGRITY_MIGRATION) {
      ensureAllColumns(database);
      applyDomainIntegrityMigration(database, sql, file);
      domainIntegrityMigrationFound = true;
      continue;
    }
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (statements.length <= 1) {
      runOne(database, sql, file, -1);
    } else {
      statements.forEach((stmt, i) => runOne(database, stmt + ';', file, i));
    }
  }
  if (!domainIntegrityMigrationFound) {
    throw new Error(`Required migration is missing: ${DOMAIN_INTEGRITY_MIGRATION}`);
  }
}

/**
 * 通用：确保某张表存在指定列，不存在则 ALTER TABLE ADD COLUMN。
 * @param {object} database - better-sqlite3 实例
 * @param {string} table - 表名
 * @param {Array<{name:string, type:string}>} columns - 要确保存在的列
 */
function ensureColumns(database, table, columns) {
  let existing;
  try {
    existing = database.prepare(`PRAGMA table_info(${table})`).all();
  } catch (err) {
    if ((err.message || '').toLowerCase().includes('no such table')) {
      console.log(`ensureColumns: table ${table} not found, skip`);
      return;
    }
    throw err;
  }
  const names = new Set(existing.map((r) => r.name));
  for (const col of columns) {
    if (names.has(col.name)) continue;
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`);
      console.log(`ensureColumns: added ${table}.${col.name} (${col.type})`);
    } catch (e) {
      if ((e.message || '').toLowerCase().includes('duplicate column')) {
        // already exists (race / concurrent)
      } else {
        console.warn(`ensureColumns: failed to add ${table}.${col.name}:`, e.message);
      }
    }
  }
}

/**
 * 全量兜底补列：覆盖所有表的所有业务列。
 * 对于旧数据库（用更早版本的 init 脚本创建、缺少部分列），
 * 在每次启动时自动补齐，避免 "no such column" 运行时错误。
 *
 * SQLite 不支持 ALTER TABLE ADD COLUMN ... NOT NULL（无默认值），
 * 所以原 schema 中 NOT NULL 的列在这里用 DEFAULT 兜底。
 */
function ensureAllColumns(database) {
  // --- dramas ---
  ensureColumns(database, 'dramas', [
    { name: 'title',          type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'description',    type: 'TEXT' },
    { name: 'genre',          type: 'TEXT' },
    { name: 'style',          type: 'TEXT DEFAULT \'realistic\'' },
    { name: 'tags',           type: 'TEXT' },
    { name: 'thumbnail',      type: 'TEXT' },
    { name: 'total_episodes', type: 'INTEGER DEFAULT 1' },
    { name: 'total_duration', type: 'INTEGER DEFAULT 0' },
    { name: 'status',         type: 'TEXT DEFAULT \'draft\'' },
    { name: 'metadata',       type: 'TEXT' },
    { name: 'created_at',     type: 'TEXT' },
    { name: 'updated_at',     type: 'TEXT' },
    { name: 'deleted_at',     type: 'TEXT' },
  ]);

  // --- episodes ---
  ensureColumns(database, 'episodes', [
    { name: 'drama_id',       type: 'INTEGER DEFAULT 0' },
    { name: 'episode_number', type: 'INTEGER DEFAULT 0' },
    { name: 'title',          type: 'TEXT DEFAULT \'\'' },
    { name: 'script_content', type: 'TEXT' },
    { name: 'description',    type: 'TEXT' },
    { name: 'duration',       type: 'INTEGER DEFAULT 0' },
    { name: 'video_url',      type: 'TEXT' },
    { name: 'thumbnail',      type: 'TEXT' },
    { name: 'status',         type: 'TEXT DEFAULT \'draft\'' },
    { name: 'created_at',     type: 'TEXT' },
    { name: 'updated_at',     type: 'TEXT' },
    { name: 'deleted_at',     type: 'TEXT' },
  ]);

  // --- storyboards ---
  ensureColumns(database, 'storyboards', [
    { name: 'episode_id',        type: 'INTEGER DEFAULT 0' },
    { name: 'scene_id',          type: 'INTEGER' },
    { name: 'storyboard_number', type: 'INTEGER DEFAULT 0' },
    { name: 'title',             type: 'TEXT' },
    { name: 'description',       type: 'TEXT' },
    { name: 'layout_description', type: 'TEXT' },   // 画面布局与人物站位（首尾帧模式空间合同）
    { name: 'location',          type: 'TEXT' },
    { name: 'time',              type: 'TEXT' },
    { name: 'duration',          type: 'REAL' },
    { name: 'dialogue',          type: 'TEXT' },
    { name: 'narration',         type: 'TEXT' },
    { name: 'action',            type: 'TEXT' },
    { name: 'atmosphere',        type: 'TEXT' },
    { name: 'image_prompt',      type: 'TEXT' },
    { name: 'video_prompt',      type: 'TEXT' },
    { name: 'characters',        type: 'TEXT' },
    { name: 'shot_type',         type: 'TEXT' },
    { name: 'angle',             type: 'TEXT' },
    { name: 'movement',          type: 'TEXT' },
    { name: 'image_url',         type: 'TEXT' },
    { name: 'local_path',        type: 'TEXT' },
    { name: 'main_panel_idx',    type: 'INTEGER' },
    { name: 'video_url',         type: 'TEXT' },
    { name: 'video_local_path',  type: 'TEXT' },
    { name: 'reference_images',  type: 'TEXT' },
    { name: 'video_reference_image_id', type: 'INTEGER' },
    { name: 'composed_image',    type: 'TEXT' },
    { name: 'result',            type: 'TEXT' },
    { name: 'emotion',           type: 'TEXT' },               // 当前情绪（兴奋/悲伤/紧张等）
    { name: 'emotion_intensity', type: 'INTEGER' },            // 情绪强度 3/2/1/0/-1
    { name: 'error_msg',         type: 'TEXT' },
    { name: 'segment_index',     type: 'INTEGER DEFAULT 0' },  // 剧情段落索引（0-based）
    { name: 'segment_title',     type: 'TEXT' },               // 剧情段落名称
    { name: 'angle_h',           type: 'TEXT' },               // 水平方向（front/left/back/right...）
    { name: 'angle_v',           type: 'TEXT' },               // 俯仰角度（worm/low/eye_level/high）
    { name: 'angle_s',           type: 'TEXT' },               // 景别（close_up/medium/wide）
    { name: 'lighting_style',    type: 'TEXT' },               // 灯光风格（natural/side/dramatic/golden_hour 等）
    { name: 'depth_of_field',    type: 'TEXT' },               // 景深（shallow/medium/deep/extreme_shallow）
    { name: 'polished_prompt',        type: 'TEXT' },               // 文字AI润色后的图片生成提示词（可编辑，生图时优先使用）
    { name: 'continuity_snapshot',   type: 'TEXT' },               // JSON: 连戏状态快照 {characters:{name:{position,clothing,expression,props}},lighting}
    { name: 'audio_local_path',      type: 'TEXT' },               // 对白 TTS 本地路径
    { name: 'narration_audio_local_path', type: 'TEXT' },         // 解说旁白 TTS 本地路径
    { name: 'creation_mode',     type: 'TEXT DEFAULT \'classic\'' }, // classic | universal
    { name: 'universal_segment_text', type: 'TEXT' },              // 全能模式片段描述（@ 引用等）
    { name: 'first_frame_image_id', type: 'INTEGER' },
    { name: 'last_frame_image_id',  type: 'INTEGER' },
    { name: 'last_frame_image_url', type: 'TEXT' },
    { name: 'last_frame_local_path', type: 'TEXT' },
    { name: 'status',            type: 'TEXT DEFAULT \'draft\'' },
    { name: 'created_at',        type: 'TEXT' },
    { name: 'updated_at',        type: 'TEXT' },
    { name: 'deleted_at',        type: 'TEXT' },
  ]);

  // --- characters ---
  ensureColumns(database, 'characters', [
    { name: 'drama_id',          type: 'INTEGER DEFAULT 0' },
    { name: 'name',              type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'role',              type: 'TEXT' },
    { name: 'description',       type: 'TEXT' },
    { name: 'personality',       type: 'TEXT' },
    { name: 'appearance',        type: 'TEXT' },
    { name: 'image_url',         type: 'TEXT' },
    { name: 'local_path',        type: 'TEXT' },
    { name: 'extra_images',      type: 'TEXT' },
    { name: 'voice_style',       type: 'TEXT' },
    { name: 'sort_order',        type: 'INTEGER DEFAULT 0' },
    { name: 'error_msg',         type: 'TEXT' },
    { name: 'identity_anchors',  type: 'TEXT' },   // JSON: 6层视觉锚点（骨相/五官/辨识标记/色值/皮肤/发型）
    { name: 'style_tokens',      type: 'TEXT' },   // 风格词 token 列表
    { name: 'color_palette',     type: 'TEXT' },   // JSON: Hex 色值数组
    { name: 'four_view_image_url', type: 'TEXT' }, // 四视图参考图 URL
    { name: 'polished_prompt',   type: 'TEXT' },   // 文字AI润色后的完整图片生成提示词（可编辑，生图时直接使用）
    { name: 'ref_image',         type: 'TEXT' },   // 用户上传的参考图（本地相对路径或 URL），独立于 AI 生成的主图
    { name: 'stages',            type: 'TEXT' },   // JSON: 多阶段造型 [{episode_range:[1,3], appearance:"..."}]
    { name: 'seedance2_asset', type: 'TEXT' },   // JSON: 即梦/Seedance2 素材库认证 hub_asset_id / asset_url 等
    { name: 'seedance2_voice_asset', type: 'TEXT' }, // JSON: Seedance 2.0 音色参考音频（仅 SD2 模型有效）
    { name: 'negative_prompt', type: 'TEXT' },
    { name: 'created_at',        type: 'TEXT' },
    { name: 'updated_at',        type: 'TEXT' },
    { name: 'deleted_at',        type: 'TEXT' },
  ]);

  // --- scenes ---
  ensureColumns(database, 'scenes', [
    { name: 'drama_id',         type: 'INTEGER DEFAULT 0' },
    { name: 'episode_id',       type: 'INTEGER' },
    { name: 'location',         type: 'TEXT' },
    { name: 'time',             type: 'TEXT' },
    { name: 'prompt',           type: 'TEXT' },
    { name: 'polished_prompt',  type: 'TEXT' },  // 文字AI润色后的完整四视图图片提示词，生图时直接使用
    { name: 'image_url',        type: 'TEXT' },
    { name: 'local_path',       type: 'TEXT' },
    { name: 'panorama_image_url', type: 'TEXT' },
    { name: 'panorama_local_path', type: 'TEXT' },
    { name: 'panorama_image_id', type: 'INTEGER' },
    { name: 'extra_images',     type: 'TEXT' },
    { name: 'ref_image',        type: 'TEXT' },  // 用户上传的参考图（本地相对路径或 URL）
    { name: 'negative_prompt',  type: 'TEXT' },
    { name: 'storyboard_count', type: 'INTEGER DEFAULT 0' },
    { name: 'error_msg',        type: 'TEXT' },
    { name: 'status',           type: 'TEXT DEFAULT \'draft\'' },
    { name: 'created_at',       type: 'TEXT' },
    { name: 'updated_at',       type: 'TEXT' },
    { name: 'deleted_at',       type: 'TEXT' },
  ]);

  // --- props ---
  ensureColumns(database, 'props', [
    { name: 'drama_id',    type: 'INTEGER DEFAULT 0' },
    { name: 'episode_id',  type: 'INTEGER' },
    { name: 'name',        type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'type',        type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'prompt',      type: 'TEXT' },
    { name: 'image_url',    type: 'TEXT' },
    { name: 'local_path',   type: 'TEXT' },
    { name: 'extra_images', type: 'TEXT' },
    { name: 'ref_image',    type: 'TEXT' },  // 用户上传的参考图（本地相对路径或 URL）
    { name: 'negative_prompt', type: 'TEXT' },
    { name: 'error_msg',    type: 'TEXT' },
    { name: 'created_at',   type: 'TEXT' },
    { name: 'updated_at',   type: 'TEXT' },
    { name: 'deleted_at',   type: 'TEXT' },
  ]);

  // --- ai_service_configs ---（兜底建表：旧版 01_init.sql 可能未包含此表）
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS ai_service_configs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type  TEXT NOT NULL DEFAULT 'text',
      provider      TEXT DEFAULT '',
      name          TEXT DEFAULT '',
      base_url      TEXT DEFAULT '',
      api_key       TEXT,
      model         TEXT,
      default_model TEXT,
      endpoint      TEXT,
      query_endpoint TEXT,
      priority      INTEGER DEFAULT 0,
      is_default    INTEGER DEFAULT 0,
      is_active     INTEGER DEFAULT 1,
      settings      TEXT,
      created_at    TEXT,
      updated_at    TEXT,
      deleted_at    TEXT
    )`);
  } catch (_) {}
  ensureColumns(database, 'ai_service_configs', [
    { name: 'service_type',   type: 'TEXT NOT NULL DEFAULT \'text\'' },
    { name: 'provider',       type: 'TEXT DEFAULT \'\'' },
    { name: 'name',           type: 'TEXT DEFAULT \'\'' },
    { name: 'base_url',       type: 'TEXT DEFAULT \'\'' },
    { name: 'api_key',        type: 'TEXT' },
    { name: 'model',          type: 'TEXT' },
    { name: 'default_model',  type: 'TEXT' },
    { name: 'endpoint',       type: 'TEXT' },
    { name: 'query_endpoint', type: 'TEXT' },
    { name: 'priority',       type: 'INTEGER DEFAULT 0' },
    { name: 'is_default',     type: 'INTEGER DEFAULT 0' },
    { name: 'is_active',      type: 'INTEGER DEFAULT 1' },
    { name: 'settings',       type: 'TEXT' },
    { name: 'created_at',     type: 'TEXT' },
    { name: 'updated_at',     type: 'TEXT' },
    { name: 'deleted_at',     type: 'TEXT' },
  ]);

  // --- async_tasks ---
  ensureColumns(database, 'async_tasks', [
    { name: 'type',         type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'status',       type: 'TEXT NOT NULL DEFAULT \'pending\'' },
    { name: 'progress',     type: 'INTEGER DEFAULT 0' },
    { name: 'message',      type: 'TEXT' },
    { name: 'resource_id',  type: 'TEXT' },
    { name: 'completed_at', type: 'TEXT' },
    { name: 'error',        type: 'TEXT' },
    { name: 'result',       type: 'TEXT' },
    { name: 'created_at',   type: 'TEXT' },
    { name: 'updated_at',   type: 'TEXT' },
    { name: 'deleted_at',   type: 'TEXT' },
  ]);

  // --- image_generations ---
  ensureColumns(database, 'image_generations', [
    { name: 'storyboard_id',    type: 'INTEGER' },
    { name: 'drama_id',         type: 'INTEGER' },
    { name: 'episode_id',       type: 'INTEGER' },
    { name: 'scene_id',         type: 'INTEGER' },
    { name: 'character_id',     type: 'INTEGER' },
    { name: 'provider',         type: 'TEXT' },
    { name: 'prompt',           type: 'TEXT' },
    { name: 'negative_prompt',  type: 'TEXT' },
    { name: 'model',            type: 'TEXT' },
    { name: 'frame_type',       type: 'TEXT' },
    { name: 'reference_images', type: 'TEXT' },
    { name: 'use_first_frame_layout_lock', type: 'INTEGER' },
    { name: 'size',             type: 'TEXT' },
    { name: 'quality',          type: 'TEXT' },
    { name: 'image_url',        type: 'TEXT' },
    { name: 'local_path',       type: 'TEXT' },
    { name: 'width',            type: 'INTEGER' },
    { name: 'height',           type: 'INTEGER' },
    { name: 'status',           type: 'TEXT' },
    { name: 'task_id',          type: 'TEXT' },
    { name: 'idempotency_key',  type: 'TEXT' },
    { name: 'completed_at',     type: 'TEXT' },
    { name: 'error_msg',        type: 'TEXT' },
    { name: 'created_at',       type: 'TEXT' },
    { name: 'updated_at',       type: 'TEXT' },
    { name: 'deleted_at',       type: 'TEXT' },
  ]);

  // --- video_generations ---
  ensureColumns(database, 'video_generations', [
    { name: 'drama_id',             type: 'INTEGER' },
    { name: 'storyboard_id',        type: 'INTEGER' },
    { name: 'provider',             type: 'TEXT' },
    { name: 'prompt',               type: 'TEXT' },
    { name: 'model',                type: 'TEXT' },
    { name: 'duration',             type: 'REAL' },
    { name: 'aspect_ratio',         type: 'TEXT' },
    { name: 'resolution',           type: 'TEXT' },
    { name: 'seed',                 type: 'INTEGER' },
    { name: 'camera_fixed',         type: 'INTEGER' },
    { name: 'watermark',            type: 'INTEGER' },
    { name: 'image_url',            type: 'TEXT' },
    { name: 'first_frame_url',      type: 'TEXT' },
    { name: 'last_frame_url',       type: 'TEXT' },
    { name: 'reference_image_urls', type: 'TEXT' },
    { name: 'video_url',            type: 'TEXT' },
    { name: 'local_path',           type: 'TEXT' },
    { name: 'status',               type: 'TEXT' },
    { name: 'task_id',              type: 'TEXT' },
    { name: 'idempotency_key',      type: 'TEXT' },
    { name: 'provider_task_id',     type: 'TEXT' },
    { name: 'scene_id',             type: 'INTEGER' },
    { name: 'completed_at',         type: 'TEXT' },
    { name: 'error_msg',            type: 'TEXT' },
    { name: 'created_at',           type: 'TEXT' },
    { name: 'updated_at',           type: 'TEXT' },
    { name: 'deleted_at',           type: 'TEXT' },
  ]);

  // --- video_merges ---
  ensureColumns(database, 'video_merges', [
    { name: 'episode_id',   type: 'INTEGER' },
    { name: 'drama_id',     type: 'INTEGER' },
    { name: 'title',        type: 'TEXT' },
    { name: 'provider',     type: 'TEXT' },
    { name: 'model',        type: 'TEXT' },
    { name: 'status',       type: 'TEXT' },
    { name: 'scenes',       type: 'TEXT' },
    { name: 'merge_options', type: 'TEXT' },
    { name: 'task_id',      type: 'TEXT' },
    { name: 'merged_url',   type: 'TEXT' },
    { name: 'duration',     type: 'INTEGER' },
    { name: 'completed_at', type: 'TEXT' },
    { name: 'error_msg',    type: 'TEXT' },
    { name: 'created_at',   type: 'TEXT' },
    { name: 'deleted_at',   type: 'TEXT' },
  ]);

  // --- assets ---
  ensureColumns(database, 'assets', [
    { name: 'drama_id',     type: 'INTEGER' },
    { name: 'name',         type: 'TEXT' },
    { name: 'type',         type: 'TEXT' },
    { name: 'category',     type: 'TEXT' },
    { name: 'url',          type: 'TEXT' },
    { name: 'local_path',   type: 'TEXT' },
    { name: 'file_size',    type: 'INTEGER' },
    { name: 'mime_type',    type: 'TEXT' },
    { name: 'width',        type: 'INTEGER' },
    { name: 'height',       type: 'INTEGER' },
    { name: 'duration',     type: 'REAL' },
    { name: 'image_gen_id', type: 'INTEGER' },
    { name: 'video_gen_id', type: 'INTEGER' },
    { name: 'created_at',   type: 'TEXT' },
    { name: 'updated_at',   type: 'TEXT' },
    { name: 'deleted_at',   type: 'TEXT' },
  ]);

  // --- character_libraries ---
  ensureColumns(database, 'character_libraries', [
    { name: 'drama_id',          type: 'INTEGER' },   // NULL = 全局素材库；有值 = 本剧专属
    { name: 'name',              type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'category',          type: 'TEXT' },
    { name: 'image_url',         type: 'TEXT' },
    { name: 'local_path',        type: 'TEXT' },
    { name: 'description',       type: 'TEXT' },
    { name: 'appearance',        type: 'TEXT' },
    { name: 'tags',              type: 'TEXT' },
    { name: 'source_type',       type: 'TEXT' },
    { name: 'source_id',         type: 'TEXT' },
    { name: 'identity_anchors',  type: 'TEXT' },   // JSON: 6层视觉锚点（骨相/五官/辨识标记/色值/皮肤/发型）
    { name: 'style_tokens',      type: 'TEXT' },   // 风格词 token 列表
    { name: 'color_palette',     type: 'TEXT' },   // JSON: Hex 色值数组
    { name: 'four_view_image_url', type: 'TEXT' }, // 四视图参考图 URL（分镜图生图参考用）
    { name: 'created_at',        type: 'TEXT' },
    { name: 'updated_at',        type: 'TEXT' },
    { name: 'deleted_at',        type: 'TEXT' },
  ]);

  // --- scene_libraries ---
  ensureColumns(database, 'scene_libraries', [
    { name: 'drama_id',    type: 'INTEGER' },   // NULL = 全局素材库
    { name: 'location',    type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'time',        type: 'TEXT' },
    { name: 'prompt',      type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'image_url',   type: 'TEXT' },
    { name: 'local_path',  type: 'TEXT' },
    { name: 'category',    type: 'TEXT' },
    { name: 'tags',        type: 'TEXT' },
    { name: 'source_type', type: 'TEXT' },
    { name: 'source_id',   type: 'TEXT' },
    { name: 'created_at',  type: 'TEXT' },
    { name: 'updated_at',  type: 'TEXT' },
    { name: 'deleted_at',  type: 'TEXT' },
  ]);

  // --- prop_libraries ---
  ensureColumns(database, 'prop_libraries', [
    { name: 'drama_id',    type: 'INTEGER' },   // NULL = 全局素材库
    { name: 'name',        type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'description', type: 'TEXT' },
    { name: 'prompt',      type: 'TEXT' },
    { name: 'image_url',   type: 'TEXT' },
    { name: 'local_path',  type: 'TEXT' },
    { name: 'category',    type: 'TEXT' },
    { name: 'tags',        type: 'TEXT' },
    { name: 'source_type', type: 'TEXT' },
    { name: 'source_id',   type: 'TEXT' },
    { name: 'created_at',  type: 'TEXT' },
    { name: 'updated_at',  type: 'TEXT' },
    { name: 'deleted_at',  type: 'TEXT' },
  ]);

  // --- image_proxy_cache ---
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS image_proxy_cache (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key  TEXT NOT NULL UNIQUE,
      proxy_url  TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  } catch (_) {}
  ensureColumns(database, 'image_proxy_cache', [
    { name: 'cache_key',  type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'proxy_url',  type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  // --- ai_model_map（业务场景→模型路由映射表） ---
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS ai_model_map (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      key            TEXT NOT NULL UNIQUE,
      service_type   TEXT NOT NULL DEFAULT 'text',
      config_id      INTEGER,
      model_override TEXT,
      description    TEXT,
      created_at     TEXT NOT NULL DEFAULT '',
      updated_at     TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
  ensureColumns(database, 'ai_model_map', [
    { name: 'key',            type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'service_type',   type: 'TEXT NOT NULL DEFAULT \'text\'' },
    { name: 'config_id',      type: 'INTEGER' },
    { name: 'model_override', type: 'TEXT' },
    { name: 'description',    type: 'TEXT' },
    { name: 'created_at',     type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'updated_at',     type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  // --- storyboard_characters（分镜与角色库的关联表） ---
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS storyboard_characters (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id  INTEGER NOT NULL,
      character_id   INTEGER NOT NULL,
      created_at     TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}

  // --- novel2anime architecture tables ---
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS story_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL DEFAULT 0,
      source_type TEXT NOT NULL DEFAULT '',
      title TEXT,
      raw_text_path TEXT,
      content_hash TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      deleted_at TEXT
    )`);
  } catch (_) {}
  ensureColumns(database, 'story_sources', [
    { name: 'drama_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'source_type', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'title', type: 'TEXT' },
    { name: 'raw_text_path', type: 'TEXT' },
    { name: 'content_hash', type: 'TEXT' },
    { name: 'metadata', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'deleted_at', type: 'TEXT' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS source_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL DEFAULT 0,
      item_type TEXT NOT NULL DEFAULT '',
      item_no INTEGER DEFAULT 0,
      title TEXT,
      raw_text TEXT,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT
    )`);
  } catch (_) {}
  ensureColumns(database, 'source_items', [
    { name: 'source_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'item_type', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'item_no', type: 'INTEGER DEFAULT 0' },
    { name: 'title', type: 'TEXT' },
    { name: 'raw_text', type: 'TEXT' },
    { name: 'summary', type: 'TEXT' },
    { name: 'status', type: 'TEXT NOT NULL DEFAULT \'ready\'' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'updated_at', type: 'TEXT' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS story_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL DEFAULT 0,
      source_item_id INTEGER,
      event_no INTEGER DEFAULT 0,
      title TEXT,
      detail TEXT,
      characters TEXT,
      location TEXT,
      tension INTEGER DEFAULT 1,
      hook_score INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
  ensureColumns(database, 'story_events', [
    { name: 'drama_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'source_item_id', type: 'INTEGER' },
    { name: 'event_no', type: 'INTEGER DEFAULT 0' },
    { name: 'title', type: 'TEXT' },
    { name: 'detail', type: 'TEXT' },
    { name: 'characters', type: 'TEXT' },
    { name: 'location', type: 'TEXT' },
    { name: 'tension', type: 'INTEGER DEFAULT 1' },
    { name: 'hook_score', type: 'INTEGER DEFAULT 1' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS adaptation_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL DEFAULT 0,
      source_id INTEGER NOT NULL DEFAULT 0,
      target_episode_count INTEGER DEFAULT 1,
      style TEXT,
      plan_json TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT
    )`);
  } catch (_) {}
  ensureColumns(database, 'adaptation_plans', [
    { name: 'drama_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'source_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'target_episode_count', type: 'INTEGER DEFAULT 1' },
    { name: 'style', type: 'TEXT' },
    { name: 'plan_json', type: 'TEXT' },
    { name: 'status', type: 'TEXT NOT NULL DEFAULT \'draft\'' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'updated_at', type: 'TEXT' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      drama_id INTEGER NOT NULL DEFAULT 0,
      episode_id INTEGER,
      type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      current_step TEXT,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      deleted_at TEXT
    )`);
  } catch (_) {}
  ensureColumns(database, 'workflow_runs', [
    { name: 'drama_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'episode_id', type: 'INTEGER' },
    { name: 'type', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'status', type: 'TEXT NOT NULL DEFAULT \'pending\'' },
    { name: 'progress', type: 'INTEGER DEFAULT 0' },
    { name: 'current_step', type: 'TEXT' },
    { name: 'input_json', type: 'TEXT' },
    { name: 'output_json', type: 'TEXT' },
    { name: 'error', type: 'TEXT' },
    { name: 'started_at', type: 'TEXT' },
    { name: 'completed_at', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'updated_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'deleted_at', type: 'TEXT' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS workflow_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      step_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      sort_order INTEGER DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
  ensureColumns(database, 'workflow_steps', [
    { name: 'run_id', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'step_key', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'status', type: 'TEXT NOT NULL DEFAULT \'pending\'' },
    { name: 'attempts', type: 'INTEGER DEFAULT 0' },
    { name: 'input_json', type: 'TEXT' },
    { name: 'output_json', type: 'TEXT' },
    { name: 'error', type: 'TEXT' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'started_at', type: 'TEXT' },
    { name: 'completed_at', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'updated_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS workflow_step_effects (
      call_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      workflow_step_id TEXT NOT NULL DEFAULT '',
      step_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'succeeded',
      output_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
  ensureColumns(database, 'workflow_step_effects', [
    { name: 'run_id', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'workflow_step_id', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'step_key', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'status', type: 'TEXT NOT NULL DEFAULT \'succeeded\'' },
    { name: 'output_json', type: 'TEXT NOT NULL DEFAULT \'{}\'' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'updated_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS qa_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL DEFAULT 0,
      episode_id INTEGER,
      run_id TEXT,
      score INTEGER DEFAULT 0,
      passed INTEGER DEFAULT 0,
      report_json TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
  ensureColumns(database, 'qa_reports', [
    { name: 'drama_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'episode_id', type: 'INTEGER' },
    { name: 'run_id', type: 'TEXT' },
    { name: 'score', type: 'INTEGER DEFAULT 0' },
    { name: 'passed', type: 'INTEGER DEFAULT 0' },
    { name: 'report_json', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS creative_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      run_id TEXT,
      source_id INTEGER,
      role TEXT NOT NULL DEFAULT '',
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      findings_json TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      resolved_at TEXT
    )`);
  } catch (_) {}
  ensureColumns(database, 'creative_reviews', [
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'run_id', type: 'TEXT' },
    { name: 'source_id', type: 'INTEGER' },
    { name: 'role', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'target_type', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'target_id', type: 'TEXT' },
    { name: 'status', type: 'TEXT NOT NULL DEFAULT \'open\'' },
    { name: 'findings_json', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'resolved_at', type: 'TEXT' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS timeline_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT '',
      name TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT
    )`);
  } catch (_) {}
  ensureColumns(database, 'timeline_tracks', [
    { name: 'episode_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'type', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'name', type: 'TEXT' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'status', type: 'TEXT DEFAULT \'pending\'' },
    { name: 'metadata', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'updated_at', type: 'TEXT' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS timeline_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL DEFAULT 0,
      storyboard_id INTEGER,
      start_sec REAL DEFAULT 0,
      end_sec REAL DEFAULT 0,
      source_path TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT
    )`);
  } catch (_) {}
  ensureColumns(database, 'timeline_items', [
    { name: 'track_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'storyboard_id', type: 'INTEGER' },
    { name: 'start_sec', type: 'REAL DEFAULT 0' },
    { name: 'end_sec', type: 'REAL DEFAULT 0' },
    { name: 'source_path', type: 'TEXT' },
    { name: 'metadata', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'updated_at', type: 'TEXT' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS provider_invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_step_id TEXT,
      run_id TEXT,
      provider_type TEXT NOT NULL DEFAULT '',
      provider_name TEXT NOT NULL DEFAULT 'mock',
      model TEXT,
      mode TEXT NOT NULL DEFAULT 'mock',
      input_hash TEXT,
      output_json TEXT,
      status TEXT NOT NULL DEFAULT 'success',
      cost_estimate REAL DEFAULT 0,
      cost_kind TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
  ensureColumns(database, 'provider_invocations', [
    { name: 'workflow_step_id', type: 'TEXT' },
    { name: 'run_id', type: 'TEXT' },
    { name: 'provider_type', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'provider_name', type: 'TEXT NOT NULL DEFAULT \'mock\'' },
    { name: 'model', type: 'TEXT' },
    { name: 'mode', type: 'TEXT NOT NULL DEFAULT \'mock\'' },
    { name: 'input_hash', type: 'TEXT' },
    { name: 'output_json', type: 'TEXT' },
    { name: 'status', type: 'TEXT NOT NULL DEFAULT \'success\'' },
    { name: 'cost_estimate', type: 'REAL DEFAULT 0' },
    { name: 'cost_kind', type: 'TEXT' },
    { name: 'error_message', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS skill_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_name TEXT NOT NULL UNIQUE,
      skill_version TEXT,
      owner_role TEXT,
      workflow_node TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      mode TEXT NOT NULL DEFAULT 'mock',
      input_schema_json TEXT,
      output_schema_json TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
  ensureColumns(database, 'skill_registry', [
    { name: 'skill_name', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'skill_version', type: 'TEXT' },
    { name: 'owner_role', type: 'TEXT' },
    { name: 'workflow_node', type: 'TEXT' },
    { name: 'enabled', type: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'mode', type: 'TEXT NOT NULL DEFAULT \'mock\'' },
    { name: 'input_schema_json', type: 'TEXT' },
    { name: 'output_schema_json', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'updated_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS skill_invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_step_id TEXT,
      run_id TEXT,
      skill_name TEXT NOT NULL DEFAULT '',
      input_hash TEXT,
      output_hash TEXT,
      status TEXT NOT NULL DEFAULT 'success',
      cost_estimate REAL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
  ensureColumns(database, 'skill_invocations', [
    { name: 'workflow_step_id', type: 'TEXT' },
    { name: 'run_id', type: 'TEXT' },
    { name: 'skill_name', type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'skill_version', type: 'TEXT' },
    { name: 'template_sha256', type: 'TEXT' },
    { name: 'input_hash', type: 'TEXT' },
    { name: 'output_hash', type: 'TEXT' },
    { name: 'status', type: 'TEXT NOT NULL DEFAULT \'success\'' },
    { name: 'cost_estimate', type: 'REAL DEFAULT 0' },
    { name: 'error_message', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS story_event_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL DEFAULT 0,
      source_id INTEGER,
      from_event_id INTEGER NOT NULL DEFAULT 0,
      to_event_id INTEGER NOT NULL DEFAULT 0,
      relation_type TEXT NOT NULL DEFAULT 'next',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
  ensureColumns(database, 'story_event_edges', [
    { name: 'drama_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'source_id', type: 'INTEGER' },
    { name: 'from_event_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'to_event_id', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'relation_type', type: 'TEXT NOT NULL DEFAULT \'next\'' },
    { name: 'description', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  // --- global_settings（全局键值设置表） ---
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS global_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
}

/** 对已打开的 database 执行迁移与兜底补列（供 app 启动时调用） */
function runMigrationsAndEnsure(database) {
  enableForeignKeys(database);
  runMigrations(database);
  ensureAllColumns(database);
}

function main() {
  const config = loadConfig();
  const database = getDb(config.database);
  runMigrationsAndEnsure(database);
  console.log('Migrations complete.');
}

if (require.main === module) {
  main();
}

module.exports = {
  DOMAIN_INTEGRITY_ERROR_CODE,
  auditNovel2AnimeDomainIntegrity,
  ensureColumns,
  runMigrationsAndEnsure,
};
