/**
 * 图片生成参考图装配：分镜角色/场景/道具参考、尾帧站位锁与智能过滤。
 * 路由仍通过 imageService 调用，本模块不改变公开 API。
 * 角色补扫只暂存 storyboards.characters，成功提交前不写库。
 */

const imageClient = require('./imageClient');
const {
  isUsableProviderReference,
  isLastFrameType,
  rowUseFirstFrameLayoutLock,
} = require('./imageServiceAssembly');

/**
 * 装配图生参考图列表与标签。只读查询加暂存，不写库。
 */
function assembleImageGenerationReferences(db, log, { row, imageGenId, refLimits, elapsed }) {
  let stagedStoryboardCharacters = null;
// ── Step 2: 解析参考图 ───────────────────────────────────────────
let reference_image_urls = null;
let reference_source = null;
// 参考图映射说明：告诉图片AI每张参考图对应哪个角色/场景，防止模型模仿宫格布局
let reference_context_note = null;
/** 分镜 characters 列已显式配置时，不再用 Step2.3「台词是否出现人名」过滤参考图（以勾选为准） */
let skipStep23PromptCharFilter = false;
if (row.reference_images) {
  try {
    const parsed = JSON.parse(row.reference_images);
    if (Array.isArray(parsed) && parsed.length > 0) {
      reference_image_urls = parsed;
      reference_source = 'DB';
    }
  } catch (_) {}
}

// ── 首尾帧专用：尾帧图生可选注入首帧作为“人物站位+构图锁”参考图（默认开启，可由 use_first_frame_layout_lock=0 关闭）──
if (row.storyboard_id) {
  const isLastFrame = isLastFrameType(row.frame_type);
  const useFirstLayoutLock = rowUseFirstFrameLayoutLock(row);
  if (isLastFrame && useFirstLayoutLock) {
    try {
      const sbFirst = db.prepare(`
        SELECT first_frame_image_id, image_url, local_path,
               last_frame_image_url, last_frame_local_path
        FROM storyboards WHERE id = ? AND deleted_at IS NULL
      `).get(Number(row.storyboard_id));

      let firstRef = null;
      if (sbFirst) {
        // 优先用显式绑定的 first_frame 图片
        if (sbFirst.first_frame_image_id) {
          const ig = db.prepare('SELECT local_path, image_url FROM image_generations WHERE id = ?').get(Number(sbFirst.first_frame_image_id));
          if (ig) firstRef = ig.local_path || ig.image_url;
        }
        if (!firstRef) firstRef = sbFirst.local_path || sbFirst.image_url; // 兼容旧主图即首帧
      }

      if (firstRef) {
        const layoutLabel = 'Image LAYOUT_LOCK: 首帧构图与人物站位参考（CRITICAL: 必须保持与此图完全一致的左右站位、人物相对位置、相机取景、整体布局，仅演化姿态/表情/结果元素，严禁交换位置或重构画面）';
        if (!reference_image_urls || reference_image_urls.length === 0) {
          reference_image_urls = [firstRef];
          reference_context_note = layoutLabel;
          reference_source = 'auto-first-frame-for-last (layout lock)';
        } else {
          // 已存在参考时，优先插入到最前面（最高权重）
          reference_image_urls = [firstRef, ...reference_image_urls].slice(0, refLimits.total);
          reference_context_note = (reference_context_note ? reference_context_note + '\n' : '') + layoutLabel;
          reference_source = (reference_source || 'mixed') + '+first-frame-layout-lock';
        }
        log.info('[图生] 尾帧自动注入首帧作为站位锁参考', {
          id: imageGenId,
          first_ref: String(firstRef).slice(0, 80),
          total_refs: reference_image_urls.length
        });
      } else {
        log.warn('[图生] 尾帧生成但未找到可用的首帧参考图，无法强制站位锁', { id: imageGenId, storyboard_id: row.storyboard_id });
      }
    } catch (e) {
      log.warn('[图生] 尾帧首帧参考注入失败（继续）', { id: imageGenId, error: e.message });
    }
  }
}

// 尾帧可能已注入首帧站位锁参考，仍需合并当前勾选的角色/场景/道具参考图
if (row.storyboard_id) {
  const sb = db.prepare('SELECT scene_id, characters, angle_s, shot_type FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(row.storyboard_id);
  if (sb) {
    const refs = [];
    const refLabels = [];
    if (sb.scene_id) {
      const scene = db.prepare('SELECT image_url, local_path, location FROM scenes WHERE id = ? AND deleted_at IS NULL').get(sb.scene_id);
      if (scene) {
        const locationName = scene.location || 'scene';
        // 优先使用 scenes 表当前主图（image_url / local_path），只有当前字段为空才降级使用历史 quad_panel_0 面板
        // 这样“重新生成场景图”后，分镜图生成能立即取到最新图片
        let sceneRef = scene.local_path || scene.image_url;
        let isPanel = false;
        if (!sceneRef) {
          const scenePanel = db.prepare(
            `SELECT local_path, image_url FROM image_generations
             WHERE scene_id = ? AND frame_type = 'quad_panel_0' AND status = 'completed'
             ORDER BY id DESC LIMIT 1`
          ).get(sb.scene_id);
          if (scenePanel && (scenePanel.local_path || scenePanel.image_url)) {
            sceneRef = scenePanel.local_path || scenePanel.image_url;
            isPanel = true;
          }
        }
        if (sceneRef && imageClient.canAddStoryboardObjectRef(refLabels, refLimits)) {
          refs.push(sceneRef);
          refLabels.push(`Image ${refs.length}: scene background reference for "${locationName}"${isPanel ? ' (establishing wide shot from history panel)' : ' (current scene image)'} `);
        }
      }
    }
    /** 分镜 characters 列：null=未配置走兼容逻辑；数组=显式勾选（含空数组=不要任何角色参考） */
    let explicitDramaCharIds = null;
    let charListParsed = null;
    if (sb.characters != null && String(sb.characters).trim() !== '') {
      try {
        const parsed = JSON.parse(sb.characters);
        if (Array.isArray(parsed)) {
          charListParsed = parsed;
          explicitDramaCharIds = parsed
            .map((item) => Number(typeof item === 'object' && item != null ? item.id : item))
            .filter((n) => Number.isFinite(n));
        }
      } catch (_) {
        explicitDramaCharIds = null;
        charListParsed = null;
      }
    }
    if (charListParsed && charListParsed.length) {
      for (const item of charListParsed) {
        if (!imageClient.canAddStoryboardCharacterRef(refLabels, refLimits)) break;
        const cid = typeof item === 'object' && item != null ? item.id : item;
        const c = db.prepare('SELECT image_url, local_path, name FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(cid));
        if (!c) continue;
        // 优先使用 characters 表当前主图（image_url / local_path），只有当前字段为空才降级使用历史 quad_panel_1 面板
        let charRef = c.local_path || c.image_url;
        let isPanel = false;
        if (!charRef) {
          const charPanel = db.prepare(
            `SELECT local_path, image_url FROM image_generations
             WHERE character_id = ? AND frame_type = 'quad_panel_1' AND status = 'completed'
             ORDER BY id DESC LIMIT 1`
          ).get(Number(cid));
          if (charPanel && (charPanel.local_path || charPanel.image_url)) {
            charRef = charPanel.local_path || charPanel.image_url;
            isPanel = true;
          }
        }
        if (charRef) {
          refs.push(charRef);
          refLabels.push(`Image ${refs.length}: character appearance reference for "${c.name || 'character'}"${isPanel ? ' (front full-body view from history panel)' : ' (current character image)'}`);
        }
      }
    }
    // ── 分镜关联道具（storyboard_props）→ 参考图（前端「物品」与 DB 一致，此前未参与 Step2）──
    try {
      const propLinks = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').all(row.storyboard_id);
      for (const link of propLinks) {
        if (!imageClient.canAddStoryboardObjectRef(refLabels, refLimits)) break;
        const prop = db.prepare(
          'SELECT name, image_url, local_path, ref_image, extra_images FROM props WHERE id = ? AND deleted_at IS NULL'
        ).get(Number(link.prop_id));
        if (!prop) continue;
        let propRef = prop.ref_image || prop.local_path || prop.image_url;
        if (!propRef && prop.extra_images) {
          try {
            const extras = typeof prop.extra_images === 'string' ? JSON.parse(prop.extra_images) : prop.extra_images;
            if (Array.isArray(extras) && extras[0]) propRef = extras[0];
          } catch (_) {}
        }
        if (propRef && !imageClient.refListHasCanonical(refs, propRef)) {
          refs.push(propRef);
          refLabels.push(`Image ${refs.length}: prop/object appearance reference for "${prop.name || 'prop'}"`);
        }
      }
    } catch (_) {}
    // ── 补充：从 storyboard_characters 关联表查 character_libraries 的四视图 URL ──
    // 若分镜已显式配置 characters JSON，则只保留「当前勾选角色同名」的库条目，避免 UI 已去掉的人仍被当作参考图
    const allowedLibNamesLower = new Set();
    if (explicitDramaCharIds !== null && explicitDramaCharIds.length > 0) {
      for (const cid of explicitDramaCharIds) {
        const nm = db.prepare('SELECT name FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(cid));
        if (nm?.name) allowedLibNamesLower.add(String(nm.name).trim().toLowerCase());
      }
    }
    const restrictLibToExplicitSelection = explicitDramaCharIds !== null;
    try {
      const libLinks = db.prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ?').all(row.storyboard_id);
      const coveredNames = new Set();
      for (const link of libLinks) {
        if (!imageClient.canAddStoryboardCharacterRef(refLabels, refLimits)) break;
        const lib = db.prepare(
          'SELECT id, name, four_view_image_url, image_url, local_path FROM character_libraries WHERE id = ? AND deleted_at IS NULL'
        ).get(link.character_id);
        if (!lib) continue;
        if (restrictLibToExplicitSelection) {
          const ln = String(lib.name || '').trim().toLowerCase();
          if (!ln || !allowedLibNamesLower.has(ln)) continue;
        }
        if (coveredNames.has(lib.name)) continue;
        // 优先使用角色库当前主图（four_view_image_url → image_url → local_path），只有当前字段为空才降级使用历史 quad_panel_1 面板
        // 这样“重新生成角色四视图/主图”后，分镜图生成能立即取到最新图片
        let libRef = lib.four_view_image_url || lib.local_path || lib.image_url;
        let isPanel = false;
        let isFourView = !!lib.four_view_image_url;
        if (!libRef) {
          const libPanel = db.prepare(
            `SELECT local_path, image_url FROM image_generations
             WHERE character_id = ? AND frame_type = 'quad_panel_1' AND status = 'completed'
             ORDER BY id DESC LIMIT 1`
          ).get(lib.id);
          if (libPanel && (libPanel.local_path || libPanel.image_url)) {
            libRef = libPanel.local_path || libPanel.image_url;
            isPanel = true;
            isFourView = false;
          }
        }
        if (libRef && !imageClient.refListHasCanonical(refs, libRef)) {
          refs.push(libRef);
          refLabels.push(`Image ${refs.length}: character appearance reference for "${lib.name || 'character'}"${isPanel ? ' (front full-body view from history panel)' : isFourView ? ' (four-view reference sheet)' : ' (character image)'}`);
          coveredNames.add(lib.name);
        }
      }
    } catch (_) {}

    // ── Step 2.1: 文本补扫 — 检测 prompt/action/dialogue 中提及但未关联的角色 ────────────────
    // 若用户已在分镜上显式勾选角色名单（含空数组），则不再根据台词把已去掉的角色塞回参考图。
    if (row.drama_id && refs.length < refLimits.total) {
      if (explicitDramaCharIds !== null && explicitDramaCharIds.length === 0) {
        // 显式清空：跳过文本补扫
      } else try {
        let sbScanText = '';
        try {
          const sbScan = db.prepare(
            'SELECT action, dialogue, result FROM storyboards WHERE id = ? AND deleted_at IS NULL'
          ).get(row.storyboard_id);
          if (sbScan) sbScanText = [sbScan.action, sbScan.dialogue, sbScan.result].filter(Boolean).join(' ');
        } catch (_) {}
        const scanText = [row.prompt || '', row.description || '', sbScanText].join(' ').toLowerCase();

        // 从已有标签中提取已覆盖的角色名（避免重复）
        const coveredCharNames = new Set(
          refLabels.map((l) => { const m = l.match(/for\s+"([^"]+)"/i); return m ? m[1].toLowerCase() : null; }).filter(Boolean)
        );

        const dramaChars = db.prepare(
          'SELECT id, name FROM characters WHERE drama_id = ? AND deleted_at IS NULL'
        ).all(Number(row.drama_id));

        for (const dChar of dramaChars) {
          if (!dChar.name) continue;
          if (explicitDramaCharIds !== null && !explicitDramaCharIds.includes(Number(dChar.id))) continue;
          if (coveredCharNames.has(dChar.name.toLowerCase())) continue;
          if (!scanText.includes(dChar.name.toLowerCase())) continue;
          if (!imageClient.canAddStoryboardCharacterRef(refLabels, refLimits)) break;
          const dCharRow = db.prepare(
            'SELECT image_url, local_path FROM characters WHERE id = ? AND deleted_at IS NULL'
          ).get(Number(dChar.id));
          // 优先使用 characters 表当前主图（image_url / local_path），只有当前字段为空才降级使用历史 quad_panel_1 面板
          let charRef = dCharRow?.local_path || dCharRow?.image_url;
          let isPanel = false;
          if (!charRef) {
            const charPanel = db.prepare(
              `SELECT local_path, image_url FROM image_generations
               WHERE character_id = ? AND frame_type = 'quad_panel_1' AND status = 'completed'
               ORDER BY id DESC LIMIT 1`
            ).get(Number(dChar.id));
            if (charPanel && (charPanel.local_path || charPanel.image_url)) {
              charRef = charPanel.local_path || charPanel.image_url;
              isPanel = true;
            }
          }
          if (charRef && !imageClient.refListHasCanonical(refs, charRef)) {
            refs.push(charRef);
            refLabels.push(`Image ${refs.length}: character appearance reference for "${dChar.name}"${isPanel ? ' (front full-body view from history panel)' : ' (character image)'}`);
            coveredCharNames.add(dChar.name.toLowerCase());
            log.info('[图生] Step2.1 文本补扫到未关联角色，已添加参考图', { id: imageGenId, name: dChar.name });
            // 同步回写到 storyboards.characters，避免下次重复扫描
            try {
              const sbCharRow = db.prepare('SELECT characters FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(row.storyboard_id));
              let charList = [];
              try { charList = JSON.parse(sbCharRow?.characters || '[]'); } catch (_) { charList = []; }
              if (!charList.find((c) => Number(typeof c === 'object' && c != null ? c.id : c) === dChar.id)) {
                charList.push({ id: dChar.id, name: dChar.name });
                stagedStoryboardCharacters = JSON.stringify(charList);
                log.info('[图生] Step2.1 已暂存角色关联，待图片成功后提交', { id: imageGenId, name: dChar.name });
              }
            } catch (_) {}
          }
        }
      } catch (scanErr) {
        log.warn('[图生] Step2.1 文本补扫异常，跳过', { id: imageGenId, error: scanErr.message });
      }
    }

    if (explicitDramaCharIds !== null) {
      skipStep23PromptCharFilter = true;
    }
    if (refs.length > 0) {
      if (!reference_image_urls || reference_image_urls.length === 0) {
        reference_image_urls = refs;
        reference_source = 'storyboard 自动解析';
        if (refLabels.length > 0) {
          reference_context_note = refLabels.slice(0, refs.length).join('\n');
        }
      } else {
        const mergedRefs = [...reference_image_urls];
        const mergedLabels = (reference_context_note || '').split('\n').filter(Boolean);
        for (let ri = 0; ri < refs.length; ri++) {
          if (mergedRefs.length >= refLimits.total) break;
          if (!imageClient.refListHasCanonical(mergedRefs, refs[ri])) {
            mergedRefs.push(refs[ri]);
            if (refLabels[ri]) mergedLabels.push(refLabels[ri]);
          }
        }
        reference_image_urls = mergedRefs.slice(0, refLimits.total);
        reference_context_note = mergedLabels
          .slice(0, reference_image_urls.length)
          .map((lbl, idx) => lbl.replace(/^Image\s+\d+/i, `Image ${idx + 1}`))
          .join('\n');
        reference_source = (reference_source || 'mixed') + '+storyboard-refs';
        log.info('[图生] 已与既有参考图（如首帧站位锁）合并分镜角色/场景参考', {
          id: imageGenId,
          total_refs: reference_image_urls.length,
        });
      }
    }
  }
}
if (reference_image_urls && reference_image_urls.length > 0) {
  const labels = String(reference_context_note || '').split('\n').filter(Boolean);
  const kept = [];
  const keptLabels = [];
  reference_image_urls.forEach((reference, index) => {
    if (!isUsableProviderReference(reference)) return;
    kept.push(reference);
    if (labels[index]) keptLabels.push(labels[index]);
  });
  reference_image_urls = kept.length ? kept : null;
  reference_context_note = keptLabels.length
    ? keptLabels.map((label, index) => label.replace(/^Image\s+\d+/i, `Image ${index + 1}`)).join('\n')
    : null;
}
log.info('[图生] Step2 参考图', {
  id: imageGenId,
  source: reference_source || '无',
  count: reference_image_urls ? reference_image_urls.length : 0,
  elapsed: elapsed(),
});

// ── Step 2.3: 参考图智能过滤（仅单帧分镜 + 多张参考图时生效）────────────────────────────
// 策略：从 reference_context_note 中提取角色名，判断是否在当前镜头的提示词里被提及。
// 场景参考图始终保留；未被提及的角色参考图跳过，减少无关图片对模型的干扰。
if (
  row.storyboard_id &&
  row.frame_type !== 'quad_grid' &&
  row.frame_type !== 'nine_grid' &&
  !skipStep23PromptCharFilter &&
  reference_image_urls && reference_image_urls.length > 1 &&
  reference_context_note
) {
  try {
    // 同时检查分镜的 action / dialogue / result 字段，避免角色通过台词/动作出场却被误过滤
    let sbTextForFilter = '';
    try {
      const sbForFilter = db.prepare(
        'SELECT action, dialogue, result FROM storyboards WHERE id = ? AND deleted_at IS NULL'
      ).get(Number(row.storyboard_id));
      if (sbForFilter) {
        sbTextForFilter = [sbForFilter.action, sbForFilter.dialogue, sbForFilter.result]
          .filter(Boolean).join(' ');
      }
    } catch (_) {}
    const promptText = [row.prompt || '', row.description || '', sbTextForFilter]
      .join(' ').toLowerCase();
    const labels = reference_context_note.split('\n');
    const filteredRefs = [];
    const filteredLabels = [];

    for (let fi = 0; fi < reference_image_urls.length; fi++) {
      const label = labels[fi] || '';
      const isCharRef = /character appearance reference/i.test(label);
      if (!isCharRef) {
        // 场景/其它参考图 → 始终保留
        filteredRefs.push(reference_image_urls[fi]);
        filteredLabels.push(label);
        continue;
      }
      // 提取角色名（格式：character appearance reference for "姓名"）
      const nameMatch = label.match(/for\s+"([^"]+)"/i);
      const charName = nameMatch ? nameMatch[1].trim() : '';
      const nameInPrompt = charName && promptText.includes(charName.toLowerCase());
      if (nameInPrompt || !charName) {
        filteredRefs.push(reference_image_urls[fi]);
        filteredLabels.push(label);
      } else {
        log.info('[图生] Step2.3 过滤不相关角色参考图', { id: imageGenId, name: charName });
      }
    }

    // 若过滤后至少有 1 张，则更新；否则保留全部（避免误杀）
    const refCountBeforeStep23 = reference_image_urls.length;
    if (filteredRefs.length > 0 && filteredRefs.length < refCountBeforeStep23) {
      reference_image_urls = filteredRefs;
      // 重新编号 Image N: 标签
      reference_context_note = filteredLabels
        .map((lbl, idx) => lbl.replace(/^Image\s+\d+/i, `Image ${idx + 1}`))
        .join('\n');
      log.info('[图生] Step2.3 参考图过滤完成', {
        id: imageGenId,
        before: refCountBeforeStep23,
        after: filteredRefs.length,
        removed: refCountBeforeStep23 - filteredRefs.length,
      });
    }
  } catch (filterErr) {
    log.warn('[图生] Step2.3 参考图过滤异常，使用全部参考图', { id: imageGenId, error: filterErr.message });
  }
}

// ── Step 2.5: 单张分镜图 + 有参考图时，记录参考图映射（由 callGeminiImageApi 处理 parts 结构）───
// Gemini 正确做法：文字说明→参考图→生成指令（交替结构），在 imageClient 中组装
// 这里只记录日志，不再污染主 prompt 文本
if (row.storyboard_id && row.frame_type !== 'quad_grid' && row.frame_type !== 'nine_grid' && reference_image_urls && reference_image_urls.length > 0) {
  log.info('[图生] Step2.5 参考图就绪，上传前将按体积/分辨率优化', {
    id: imageGenId,
    ref_count: reference_image_urls.length,
    context_note: reference_context_note || '(无标签)',
  });
}
  return {
    reference_image_urls,
    reference_source,
    reference_context_note,
    skipStep23PromptCharFilter,
    stagedStoryboardCharacters,
  };
}

module.exports = {
  assembleImageGenerationReferences,
};
