/**
 * 剧本写路径：创建、更新与大纲/角色/分集/进度/画布保存。
 * 事务编排由入口模块注入 runDramaWriteTransaction；本模块不引用 dramaService，避免循环依赖。
 */

const storageLayout = require('./storageLayout');
const { validateFreeCanvas, badRequest: canvasBadRequest } = require('./freeCanvasValidation');
const seedance2AssetGuards = require('../utils/seedance2AssetGuards');
const { resolveStylePreset } = require('../constants/generationStylePresets');
const { getDrama, getDramaById } = require('./dramaQueryService');

let runDramaWriteTransaction;

function bindDramaWriteTransaction(fn) {
  if (typeof fn !== 'function') {
    throw new Error('剧本写事务编排函数无效');
  }
  runDramaWriteTransaction = fn;
}

function withDramaWriteTransaction(db, dramaId, mutation) {
  if (typeof runDramaWriteTransaction !== 'function') {
    throw new Error('剧本写事务尚未绑定');
  }
  return runDramaWriteTransaction(db, dramaId, mutation);
}

function createDrama(db, log, req) {
  const now = new Date().toISOString();
  let meta = {};
  if (req.metadata) {
    try {
      meta =
        typeof req.metadata === 'string'
          ? JSON.parse(req.metadata)
          : { ...req.metadata };
    } catch (_) {
      meta = {};
    }
  }
  if (!meta.storage_folder_label) {
    meta.storage_folder_label = storageLayout.sanitizeFolderLabel(req.title || '');
  }
  const metadataStr = Object.keys(meta).length ? JSON.stringify(meta) : null;
  const stmt = db.prepare(`
    INSERT INTO dramas (title, description, genre, style, metadata, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
  `);
  const info = stmt.run(
    req.title || '',
    req.description || null,
    req.genre || null,
    req.style || 'realistic',
    metadataStr,
    now,
    now
  );
  const id = info.lastInsertRowid;
  log.info('Drama created', { drama_id: id });
  return getDramaById(db, id);
}

function updateDramaUnsafe(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return null;
  const updates = [];
  const params = [];
  if (req.title != null) {
    updates.push('title = ?');
    params.push(req.title);
  }
  if (req.description != null) {
    updates.push('description = ?');
    params.push(req.description || null);
  }
  if (req.genre != null) {
    updates.push('genre = ?');
    params.push(req.genre || null);
  }
  if (req.status != null) {
    updates.push('status = ?');
    params.push(req.status);
  }
  if (updates.length === 0) return drama;
  params.push(new Date().toISOString(), dramaId);
  db.prepare(
    'UPDATE dramas SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ?'
  ).run(...params);
  log.info('Drama updated', { drama_id: dramaId });
  return getDramaById(db, dramaId);
}

function updateDrama(db, log, dramaId, req) {
  return withDramaWriteTransaction(db, dramaId, () => updateDramaUnsafe(db, log, dramaId, req));
}

function saveOutlineUnsafe(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return false;
  const now = new Date().toISOString();
  const tagsStr = Array.isArray(req.tags) ? JSON.stringify(req.tags) : null;
  // Merge new metadata with existing metadata
  let existingMetadata = {};
  if (drama.metadata) {
    try {
      existingMetadata = typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata;
    } catch (e) {
      existingMetadata = {};
    }
  }
  let newMetadata = {};
  if (req.metadata) {
    try {
      newMetadata = typeof req.metadata === 'string' ? JSON.parse(req.metadata) : req.metadata;
    } catch (e) {
      newMetadata = {};
    }
  }
  const mergedMetadata = { ...existingMetadata, ...newMetadata };

  // 与 mergeCfgStyleWithDrama 一致：提示词优先读 metadata.style_prompt_*。仅改 dramas.style 而不带画风长文案时，
  // 若仍保留旧的 metadata 画风，会出现「列表/首页 badge 已是新 style，角色提示词却仍用旧画风」。
  if (req.style !== undefined) {
    const styleVal = String(req.style || '').trim();
    const hasExplicitStylePrompt =
      req.metadata &&
      typeof req.metadata === 'object' &&
      !Array.isArray(req.metadata) &&
      ('style_prompt_zh' in req.metadata || 'style_prompt_en' in req.metadata);
    if (!hasExplicitStylePrompt && styleVal) {
      const preset = resolveStylePreset(styleVal);
      if (preset) {
        mergedMetadata.style_prompt_zh = preset.zh;
        mergedMetadata.style_prompt_en = preset.en;
      }
    }
  }

  const metadataStr = JSON.stringify(mergedMetadata);
  
  db.prepare(
    `UPDATE dramas SET title = ?, description = ?, genre = ?, tags = ?, style = ?, metadata = ?, updated_at = ? WHERE id = ?`
  ).run(
    req.title || drama.title, 
    req.summary ?? drama.description, 
    req.genre !== undefined ? req.genre : drama.genre, 
    tagsStr, 
    req.style !== undefined ? req.style : drama.style, 
    metadataStr, 
    now, 
    dramaId
  );
  log.info('Outline saved', { drama_id: dramaId, style: req.style, genre: req.genre, metadata: mergedMetadata });
  return true;
}

function saveOutline(db, log, dramaId, req) {
  return withDramaWriteTransaction(db, dramaId, () => saveOutlineUnsafe(db, log, dramaId, req));
}

function saveCharactersUnsafe(db, log, dramaId, req) {
  const did = Number(dramaId);
  const drama = getDramaById(db, did);
  if (!drama) return false;
  if (req.episode_id) {
    const ep = db.prepare('SELECT 1 FROM episodes WHERE id = ? AND drama_id = ?').get(req.episode_id, did);
    if (!ep) return false;
  }
  const characterIds = [];
  const chars = req.characters || [];
  for (const char of chars) {
    if (char.id) {
      const ex = db.prepare('SELECT id FROM characters WHERE id = ? AND drama_id = ?').get(char.id, did);
      if (ex) {
        characterIds.push(ex.id);
        // 只更新文本字段；image_url / local_path 仅在调用方显式传入时才覆盖，防止漏传字段清空已有图片
        const imgFields = [];
        const imgParams = [];
        if ('image_url' in char) { imgFields.push('image_url = ?'); imgParams.push(char.image_url ?? null); }
        if ('local_path' in char) { imgFields.push('local_path = ?'); imgParams.push(char.local_path ?? null); }
        if (imgFields.length > 0) {
          const prevC = db
            .prepare('SELECT id, local_path, image_url, seedance2_asset FROM characters WHERE id = ? AND deleted_at IS NULL')
            .get(char.id);
          if (prevC) {
            seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, prevC, {
              image_url: 'image_url' in char ? char.image_url : prevC.image_url,
              local_path: 'local_path' in char ? char.local_path : prevC.local_path,
            });
          }
        }
        const imgSql = imgFields.length > 0 ? ', ' + imgFields.join(', ') : '';
        let setCore = 'name = ?, role = ?, description = ?, personality = ?, appearance = ?';
        const coreParams = [char.name, char.role ?? null, char.description ?? null, char.personality ?? null, char.appearance ?? null];
        if ('negative_prompt' in char) {
          setCore += ', negative_prompt = ?';
          coreParams.push(char.negative_prompt ?? null);
        }
        db.prepare(
          `UPDATE characters SET ${setCore}${imgSql}, updated_at = ? WHERE id = ?`
        ).run(...coreParams, ...imgParams, new Date().toISOString(), char.id);
        continue;
      }
    }
    const byName = db.prepare('SELECT id FROM characters WHERE drama_id = ? AND name = ?').get(did, char.name);
    if (byName) {
      characterIds.push(byName.id);
      // 如果通过名字找到已存在的角色（包含软删除的），也要更新它的信息并复活
      const imgFieldsN = [];
      const imgParamsN = [];
      if ('image_url' in char) { imgFieldsN.push('image_url = ?'); imgParamsN.push(char.image_url ?? null); }
      if ('local_path' in char) { imgFieldsN.push('local_path = ?'); imgParamsN.push(char.local_path ?? null); }
      if (imgFieldsN.length > 0) {
        const prevN = db
          .prepare('SELECT id, local_path, image_url, seedance2_asset FROM characters WHERE id = ?')
          .get(byName.id);
        if (prevN) {
          seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, prevN, {
            image_url: 'image_url' in char ? char.image_url : prevN.image_url,
            local_path: 'local_path' in char ? char.local_path : prevN.local_path,
          });
        }
      }
      const imgSqlN = imgFieldsN.length > 0 ? ', ' + imgFieldsN.join(', ') : '';
      let setCoreN = 'role = ?, description = ?, personality = ?, appearance = ?';
      const coreParamsN = [char.role ?? null, char.description ?? null, char.personality ?? null, char.appearance ?? null];
      if ('negative_prompt' in char) {
        setCoreN += ', negative_prompt = ?';
        coreParamsN.push(char.negative_prompt ?? null);
      }
      db.prepare(
        `UPDATE characters SET ${setCoreN}${imgSqlN}, updated_at = ?, deleted_at = NULL WHERE id = ?`
      ).run(...coreParamsN, ...imgParamsN, new Date().toISOString(), byName.id);
      continue;
    }
    const now = new Date().toISOString();
    const info = db.prepare(
      `INSERT INTO characters (drama_id, name, role, description, personality, appearance, image_url, local_path, negative_prompt, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(did, char.name, char.role ?? null, char.description ?? null, char.personality ?? null, char.appearance ?? null, char.image_url ?? null, char.local_path ?? null, char.negative_prompt ?? null, now, now);
    characterIds.push(info.lastInsertRowid);
  }
  if (req.episode_id && characterIds.length > 0) {
    db.prepare('DELETE FROM episode_characters WHERE episode_id = ?').run(req.episode_id);
    const ins = db.prepare('INSERT OR IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)');
    for (const cid of characterIds) ins.run(req.episode_id, cid);
  }
  db.prepare('UPDATE dramas SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), did);
  log.info('Characters saved', { drama_id: dramaId, count: chars.length });
  return true;
}

function saveCharacters(db, log, dramaId, req) {
  return withDramaWriteTransaction(db, dramaId, () => saveCharactersUnsafe(db, log, dramaId, req));
}

function saveEpisodesUnsafe(db, log, dramaId, req) {
  const did = Number(dramaId);
  const drama = getDramaById(db, did);
  if (!drama) return false;
  const episodes = req.episodes || [];
  const now = new Date().toISOString();

  // 按 episode_number upsert：保留已有分集的 id，避免关联数据（角色/场景/道具/分镜）孤岛化
  const keptNumbers = new Set();
  for (const ep of episodes) {
    const num = ep.episode_number ?? 0;
    keptNumbers.add(num);
    // 查找已有的（包含软删除的，以防重新激活）
    const existing = db.prepare(
      'SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? ORDER BY deleted_at IS NOT NULL ASC, id ASC LIMIT 1'
    ).get(did, num);
    if (existing) {
      // 更新已有分集，保留 id
      db.prepare(
        `UPDATE episodes SET title = ?, script_content = ?, description = ?, duration = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`
      ).run(ep.title || '', ep.script_content ?? null, ep.description ?? null, ep.duration ?? 0, now, existing.id);
    } else {
      // 新增
      db.prepare(
        `INSERT INTO episodes (drama_id, episode_number, title, script_content, description, duration, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
      ).run(did, num, ep.title || '', ep.script_content ?? null, ep.description ?? null, ep.duration ?? 0, now, now);
    }
  }

  // 软删除本次未提交的分集（如用户删掉了某一集）
  const liveEpisodes = db.prepare(
    'SELECT id, episode_number FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
  ).all(did);
  for (const row of liveEpisodes) {
    if (!keptNumbers.has(row.episode_number)) {
      db.prepare('UPDATE episodes SET deleted_at = ? WHERE id = ?').run(now, row.id);
    }
  }

  db.prepare('UPDATE dramas SET updated_at = ? WHERE id = ?').run(now, did);
  log.info('Episodes saved', { drama_id: dramaId, count: episodes.length });
  return true;
}

function saveEpisodes(db, log, dramaId, req) {
  return withDramaWriteTransaction(db, dramaId, () => saveEpisodesUnsafe(db, log, dramaId, req));
}

function saveProgressUnsafe(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return false;
  // getDramaById 已通过 rowToDrama 把 metadata 解析为对象，不能对 object 再 JSON.parse，否则进 catch 得到 {} 会整表覆盖掉画风等字段
  const meta = storageLayout.parseMetadata(drama.metadata);
  meta.current_step = req.current_step;
  if (req.step_data) meta.step_data = req.step_data;
  const now = new Date().toISOString();
  db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(meta), now, dramaId);
  log.info('Progress saved', { drama_id: dramaId, step: req.current_step });
  return true;
}

function saveProgress(db, log, dramaId, req) {
  return withDramaWriteTransaction(db, dramaId, () => saveProgressUnsafe(db, log, dramaId, req));
}

/** 保存画布布局 / 工作流组到 metadata（合并现有 metadata） */
function saveCanvasLayoutUnsafe(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return null;
  const layout = req?.canvas_layout;
  const freeCanvas = req?.free_canvas;
  const workflowGroups = req?.workflow_groups;
  if (
    (layout == null || typeof layout !== 'object' || Array.isArray(layout)) &&
    freeCanvas === undefined &&
    workflowGroups === undefined
  ) {
    throw canvasBadRequest('请提供画布布局、自由画布或工作流组');
  }
  if (layout != null && (typeof layout !== 'object' || Array.isArray(layout))) {
    throw canvasBadRequest('画布布局必须为对象');
  }
  if (workflowGroups !== undefined && !Array.isArray(workflowGroups)) {
    throw canvasBadRequest('工作流组必须为数组');
  }
  const validatedFreeCanvas = freeCanvas === undefined
    ? undefined
    : validateFreeCanvas(db, Number(dramaId), freeCanvas);
  const meta = storageLayout.parseMetadata(drama.metadata);
  if (layout) meta.canvas_layout = layout;
  if (validatedFreeCanvas !== undefined) meta.free_canvas = validatedFreeCanvas;
  if (workflowGroups !== undefined) meta.workflow_groups = workflowGroups;
  const now = new Date().toISOString();
  db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(meta), now, dramaId);
  log.info('Canvas state saved', {
    drama_id: dramaId,
    node_count: layout ? Object.keys(layout.nodes || {}).length : undefined,
    free_node_count: validatedFreeCanvas ? validatedFreeCanvas.nodes.length : undefined,
    workflow_group_count: workflowGroups ? workflowGroups.length : undefined,
  });
  return getDrama(db, dramaId);
}

function saveCanvasLayout(db, log, dramaId, req) {
  return withDramaWriteTransaction(db, dramaId, () => saveCanvasLayoutUnsafe(db, log, dramaId, req));
}

module.exports = {
  bindDramaWriteTransaction,
  createDrama,
  updateDramaUnsafe,
  updateDrama,
  saveOutlineUnsafe,
  saveOutline,
  saveCharactersUnsafe,
  saveCharacters,
  saveEpisodesUnsafe,
  saveEpisodes,
  saveProgressUnsafe,
  saveProgress,
  saveCanvasLayoutUnsafe,
  saveCanvasLayout,
};
