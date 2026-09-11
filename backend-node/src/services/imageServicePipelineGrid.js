/**
 * 图片生成管线：四宫格/九宫格提示词拼装与整图拆分。
 * 由 imageServicePipeline.js 再导出，不改变公开 API。
 */

const path = require('path');
const fs = require('fs');
const uploadService = require('./uploadService');

/**
 * 将四宫格整图拆成 4 张子图，保存到本地，并在 image_generations 表中分别建立记录。
 * @param {string} absLocalPath  图片的绝对路径（sharp 读取用）
 * @param {string} storagePath   存储根目录的绝对路径（用于计算写入 DB 的相对路径）
 * @param {string} imageUrl_     原图的远端 URL（用于推导子图 URL）
 * frame_type 分别为 quad_panel_0~3，对应左上/右上/左下/右下。
 */
async function splitQuadGridToImages(db, log, originalRow, absLocalPath, storagePath, imageUrl_) {
  if (!absLocalPath) {
    log.warn('[四宫格拆分] 缺少本地文件路径，跳过拆分', { id: originalRow.id });
    return;
  }
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    log.warn('[四宫格拆分] sharp 未安装，跳过拆分', { error: e.message });
    return;
  }
  try {
    // Windows：避免 libvips 直接 open 含中文路径；读入 Buffer，写出用 fs.writeFileSync
    const inputBuf = fs.readFileSync(absLocalPath);
    const meta = await sharp(inputBuf).metadata();
    const w = meta.width;
    const h = meta.height;
    const hw = Math.floor(w / 2);
    const hh = Math.floor(h / 2);
    // 4 象限：左上(0)、右上(1)、左下(2)、右下(3)
    const quadrants = [
      { left: 0,  top: 0,  width: hw,     height: hh,     idx: 0 },
      { left: hw, top: 0,  width: w - hw, height: hh,     idx: 1 },
      { left: 0,  top: hh, width: hw,     height: h - hh, idx: 2 },
      { left: hw, top: hh, width: w - hw, height: h - hh, idx: 3 },
    ];
    const labels = ['左上', '右上', '左下', '右下'];
    const absDir = path.dirname(absLocalPath);
    const ext = path.extname(absLocalPath) || '.jpg';
    const base = path.basename(absLocalPath, ext);
    const now = new Date().toISOString();
    for (const q of quadrants) {
      let publishedPanelPath = null;
      try {
        const panelFilename = `${base}_panel${q.idx}${ext}`;
        // 绝对路径（文件写入）
        const absPanelPath = path.join(absDir, panelFilename);
        // 相对路径（存 DB，与原图同格式：images/ig_xxx_panel0.jpg）
        const relPanelPath = path.relative(storagePath, absPanelPath).replace(/\\/g, '/');
        // 用 sharp 裁剪并添加文字标签 SVG 角标
        const labelSvg = `<svg width="${q.width}" height="${q.height}">
  <rect x="4" y="4" width="42" height="24" rx="4" fill="rgba(0,0,0,0.55)"/>
  <text x="25" y="21" font-size="14" fill="white" font-family="sans-serif" text-anchor="middle">${labels[q.idx]}</text>
</svg>`;
        const panelBuf = await sharp(inputBuf)
          .extract({ left: q.left, top: q.top, width: q.width, height: q.height })
          .composite([{ input: Buffer.from(labelSvg, 'utf8'), top: 0, left: 0 }])
          .jpeg({ quality: 92 })
          .toBuffer();
        uploadService.writeStorageBuffer(storagePath, relPanelPath, panelBuf);
        publishedPanelPath = absPanelPath;
        // 推导远端 URL（与原图同目录，只替换文件名）
        const panelImageUrl = imageUrl_
          ? imageUrl_.replace(/[^/\\]+$/, panelFilename)
          : null;
        // 插入 image_generation 记录（status=completed，直接可用）
        db.prepare(
          `INSERT INTO image_generations (storyboard_id, drama_id, scene_id, character_id, provider, prompt, model, frame_type, image_url, local_path, status, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`
        ).run(
          originalRow.storyboard_id ?? null,
          originalRow.drama_id ?? 0,
          originalRow.scene_id ?? null,
          originalRow.character_id ?? null,
          originalRow.provider || 'system',
          `[${labels[q.idx]}] ${originalRow.prompt || ''}`.slice(0, 1000),
          originalRow.model ?? null,
          `quad_panel_${q.idx}`,
          panelImageUrl,
          relPanelPath,
          now, now, now
        );
        log.info(`[四宫格拆分] 面板 ${q.idx}(${labels[q.idx]}) 已保存`, { rel_path: relPanelPath });
      } catch (panelErr) {
        if (publishedPanelPath) uploadService.removeFile(publishedPanelPath, log);
        log.warn(`[四宫格拆分] 面板 ${q.idx} 失败`, { error: panelErr.message });
      }
    }
    log.info('[四宫格拆分] 完成', { original_id: originalRow.id, storyboard_id: originalRow.storyboard_id });
  } catch (err) {
    log.warn('[四宫格拆分] 整体失败', { error: err.message });
  }
}

/**
 * 四宫格模式：用 AI 生成 4 个帧提示词，拼成四宫格格式的单张图片提示词
 * 让 AI 图片生成模型直接输出一张 2×2 四格序列图
 */
async function buildQuadGridPrompt(db, log, cfg, storyboardId, model, signal) {
  // 在函数内部 require，避免循环依赖
  const framePromptService = require('./framePromptService');
  const sb = framePromptService.loadStoryboard(db, storyboardId);
  if (!sb) return null;
  const scene = framePromptService.loadScene(db, sb.scene_id);
  const characterNames = framePromptService.loadStoryboardCharacterNames(db, storyboardId);

  // 四个面板使用差异明显的相机角度，方便用户挑选最佳构图
  const QUAD_PANEL_ANGLES = ['平视', '仰拍', '俯拍', '侧面'];
  const QUAD_PANEL_ANGLE_LABELS_EN = [
    'eye-level shot',
    'low-angle upward shot',
    'high-angle downward shot (bird\'s eye)',
    'side-angle profile shot',
  ];
  const [sbFirst, sbKey1, sbKey2, sbLast] = QUAD_PANEL_ANGLES.map((a) => ({ ...sb, angle: a }));

  log.info('[四宫格] 开始生成4帧提示词（四种相机角度）', {
    storyboard_id: storyboardId,
    angles: QUAD_PANEL_ANGLES,
  });
  const [first, key1, key2, last] = await Promise.all([
    framePromptService.generateSingleFrameExported(db, log, cfg, sbFirst, scene, characterNames, model || undefined, 'first', { signal }),
    framePromptService.generateSingleFrameExported(db, log, cfg, sbKey1, scene, characterNames, model || undefined, 'key', { signal }),
    framePromptService.generateSingleFrameExported(db, log, cfg, sbKey2, scene, characterNames, model || undefined, 'key', { signal }),
    framePromptService.generateSingleFrameExported(db, log, cfg, sbLast, scene, characterNames, model || undefined, 'last', { signal }),
  ]);
  log.info('[四宫格] 4帧提示词生成完成', { storyboard_id: storyboardId });
  log.info('[四宫格] first.prompt:\n' + first.prompt);
  log.info('[四宫格] key1.prompt:\n' + key1.prompt);
  log.info('[四宫格] key2.prompt:\n' + key2.prompt);
  log.info('[四宫格] last.prompt:\n' + last.prompt);

  const rawStyle = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').toString().trim();
  const styleZhGrid = (cfg?.style?.default_style_zh || '').toString().trim();
  const styleHeadGrid = [
    styleZhGrid ? `【画风·最高优先级】${styleZhGrid}` : '',
    rawStyle && rawStyle !== styleZhGrid ? `MANDATORY ART STYLE: ${rawStyle}.` : rawStyle ? `MANDATORY ART STYLE: ${rawStyle}.` : '',
  ].filter(Boolean).join('\n');
  const styleNote = !styleHeadGrid && rawStyle ? `. Art style: ${rawStyle}` : '';
  const quadCore = `Create a 2x2 grid storyboard image with EXACTLY 4 equal-sized panels arranged in 2 rows and 2 columns (like a coordinate quadrant layout). Each panel occupies exactly one quadrant of the image. NO borders of any color (black, white, gray), NO dividing lines, NO frames between panels — the 4 panels must be seamlessly adjacent with no gaps or separators${styleNote}.

Each panel uses a DIFFERENT camera angle to show the same scene from varied perspectives — this is intentional and required.

TOP ROW (left to right):
[Panel 1 - top-left quadrant, ${QUAD_PANEL_ANGLE_LABELS_EN[0]}, initial state]: ${first.prompt}
[Panel 2 - top-right quadrant, ${QUAD_PANEL_ANGLE_LABELS_EN[1]}, key action moment]: ${key1.prompt}

BOTTOM ROW (left to right):
[Panel 3 - bottom-left quadrant, ${QUAD_PANEL_ANGLE_LABELS_EN[2]}, action continuation]: ${key2.prompt}
[Panel 4 - bottom-right quadrant, ${QUAD_PANEL_ANGLE_LABELS_EN[3]}, final state]: ${last.prompt}

CRITICAL LAYOUT RULES: The image MUST be divided into 4 equal quadrants in a 2x2 grid. Do NOT arrange panels in a single strip. Do NOT add any black or dark borders/frames around the panels. Each panel is self-contained with consistent character appearance and art style. The camera angle MUST visually differ between panels as specified above.`;
  const quadPrompt = (styleHeadGrid ? `${styleHeadGrid}\n\n` : '') + quadCore;
  log.info('[四宫格] FINAL IMAGE PROMPT (发送给图片AI):\n' + quadPrompt);
  return quadPrompt;
}

/**
 * 九宫格模式：用 AI 生成 9 个帧提示词，拼成 3×3 格序列图提示词
 * 9 个面板各用一种不同相机角度，覆盖常见电影视角，供用户挑选最佳构图
 */
async function buildNineGridPrompt(db, log, cfg, storyboardId, model, signal) {
  const framePromptService = require('./framePromptService');
  const sb = framePromptService.loadStoryboard(db, storyboardId);
  if (!sb) return null;
  const scene = framePromptService.loadScene(db, sb.scene_id);
  const characterNames = framePromptService.loadStoryboardCharacterNames(db, storyboardId);

  // 9 种差异明显的相机角度
  const NINE_PANEL_ANGLES = ['平视', '仰拍', '俯拍', '侧面左', '侧面右', '背面', '极端仰拍', '极端俯拍', '斜侧45度'];
  const NINE_PANEL_ANGLE_LABELS_EN = [
    'eye-level shot',
    'low-angle upward shot',
    'high-angle downward shot (bird\'s eye)',
    'left profile side shot',
    'right profile side shot',
    'rear shot from behind the character',
    'extreme low angle (worm\'s eye view)',
    'extreme high angle (aerial top-down view)',
    'diagonal 45-degree angle shot',
  ];
  // 时间线分布：首帧 × 1、关键帧 × 7、尾帧 × 1
  const frameKinds = ['first', 'key', 'key', 'key', 'key', 'key', 'key', 'key', 'last'];
  const sbVariants = NINE_PANEL_ANGLES.map((a) => ({ ...sb, angle: a }));

  log.info('[九宫格] 开始生成9帧提示词（九种相机角度）', { storyboard_id: storyboardId, angles: NINE_PANEL_ANGLES });
  const frames = await Promise.all(
    sbVariants.map((sbv, i) =>
      framePromptService.generateSingleFrameExported(db, log, cfg, sbv, scene, characterNames, model || undefined, frameKinds[i], { signal })
    )
  );
  log.info('[九宫格] 9帧提示词生成完成', { storyboard_id: storyboardId });
  frames.forEach((f, i) => log.info(`[九宫格] panel${i}.prompt:\n` + f.prompt));

  const rawStyle = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').toString().trim();
  const styleZhGrid = (cfg?.style?.default_style_zh || '').toString().trim();
  const styleHeadGrid = [
    styleZhGrid ? `【画风·最高优先级】${styleZhGrid}` : '',
    rawStyle && rawStyle !== styleZhGrid ? `MANDATORY ART STYLE: ${rawStyle}.` : rawStyle ? `MANDATORY ART STYLE: ${rawStyle}.` : '',
  ].filter(Boolean).join('\n');
  const styleNote = !styleHeadGrid && rawStyle ? `. Art style: ${rawStyle}` : '';
  const ROWS = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
  ];
  const rowNames = ['TOP ROW', 'MIDDLE ROW', 'BOTTOM ROW'];
  const colNames = ['left', 'center', 'right'];
  const panelDescs = frames.map((f, i) => `[Panel ${i + 1} - ${colNames[i % 3]}, ${NINE_PANEL_ANGLE_LABELS_EN[i]}]: ${f.prompt}`);

  const rowBlocks = ROWS.map((cols, r) =>
    `${rowNames[r]} (left to right):\n` + cols.map((c) => panelDescs[c]).join('\n')
  ).join('\n\n');

  const nineCore = `Create a 3x3 grid storyboard image with EXACTLY 9 equal-sized panels arranged in 3 rows and 3 columns. Each panel occupies exactly one cell of the 3×3 grid. NO borders of any color (black, white, gray), NO dividing lines, NO frames between panels — all 9 panels must be seamlessly adjacent with no gaps or separators${styleNote}.

Each panel uses a DIFFERENT camera angle to show the same scene from varied cinematic perspectives — this is intentional and required.

${rowBlocks}

CRITICAL LAYOUT RULES: The image MUST be divided into 9 equal cells in a 3×3 grid. Do NOT arrange panels in a single strip. Do NOT add any borders or frames. Each panel is self-contained with consistent character appearance and art style. The camera angle MUST visually differ between panels as specified above.`;
  const ninePrompt = (styleHeadGrid ? `${styleHeadGrid}\n\n` : '') + nineCore;
  log.info('[九宫格] FINAL IMAGE PROMPT (发送给图片AI):\n' + ninePrompt);
  return ninePrompt;
}

/**
 * 九宫格拆分：将一张 3×3 合成图拆成 9 张独立图，写入 image_generations
 * frame_type 分别为 nine_panel_0~8，对应 3×3 从左上到右下排列。
 */
async function splitNineGridToImages(db, log, originalRow, absLocalPath, storagePath, imageUrl_) {
  if (!absLocalPath) {
    log.warn('[九宫格拆分] 缺少本地文件路径，跳过拆分', { id: originalRow.id });
    return;
  }
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    log.warn('[九宫格拆分] sharp 未安装，跳过拆分', { error: e.message });
    return;
  }
  const labels = ['左上', '中上', '右上', '左中', '中间', '右中', '左下', '中下', '右下'];
  try {
    const inputBuf = fs.readFileSync(absLocalPath);
    const meta = await sharp(inputBuf).metadata();
    const w = meta.width;
    const h = meta.height;
    const cw = Math.floor(w / 3);
    const ch = Math.floor(h / 3);
    // 9 格：行×列，处理余数保证无缝覆盖
    const cells = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const left = col * cw;
        const top  = row * ch;
        const width  = col === 2 ? w - left : cw;
        const height = row === 2 ? h - top  : ch;
        cells.push({ left, top, width, height, idx: row * 3 + col });
      }
    }
    const absDir = path.dirname(absLocalPath);
    const ext = path.extname(absLocalPath) || '.jpg';
    const base = path.basename(absLocalPath, ext);
    const now = new Date().toISOString();
    for (const c of cells) {
      let publishedPanelPath = null;
      try {
        const panelFilename = `${base}_panel${c.idx}${ext}`;
        const absPanelPath = path.join(absDir, panelFilename);
        const relPanelPath = path.relative(storagePath, absPanelPath).replace(/\\/g, '/');
        const labelSvg = `<svg width="${c.width}" height="${c.height}">
  <rect x="4" y="4" width="42" height="24" rx="4" fill="rgba(0,0,0,0.55)"/>
  <text x="25" y="21" font-size="14" fill="white" font-family="sans-serif" text-anchor="middle">${labels[c.idx]}</text>
</svg>`;
        const panelBuf = await sharp(inputBuf)
          .extract({ left: c.left, top: c.top, width: c.width, height: c.height })
          .composite([{ input: Buffer.from(labelSvg, 'utf8'), top: 0, left: 0 }])
          .jpeg({ quality: 92 })
          .toBuffer();
        uploadService.writeStorageBuffer(storagePath, relPanelPath, panelBuf);
        publishedPanelPath = absPanelPath;
        const panelImageUrl = imageUrl_ ? imageUrl_.replace(/[^/\\]+$/, panelFilename) : null;
        db.prepare(
          `INSERT INTO image_generations (storyboard_id, drama_id, scene_id, provider, prompt, model, frame_type, image_url, local_path, status, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`
        ).run(
          originalRow.storyboard_id ?? null,
          originalRow.drama_id ?? 0,
          originalRow.scene_id ?? null,
          originalRow.provider || 'system',
          `[${labels[c.idx]}] ${originalRow.prompt || ''}`.slice(0, 1000),
          originalRow.model ?? null,
          `nine_panel_${c.idx}`,
          panelImageUrl,
          relPanelPath,
          now, now, now
        );
        log.info(`[九宫格拆分] 面板 ${c.idx}(${labels[c.idx]}) 已保存`, { rel_path: relPanelPath });
      } catch (panelErr) {
        if (publishedPanelPath) uploadService.removeFile(publishedPanelPath, log);
        log.warn(`[九宫格拆分] 面板 ${c.idx} 失败`, { error: panelErr.message });
      }
    }
    log.info('[九宫格拆分] 完成', { original_id: originalRow.id, storyboard_id: originalRow.storyboard_id });
  } catch (err) {
    log.warn('[九宫格拆分] 整体失败', { error: err.message });
  }
}

/**
 * 四宫格/九宫格：优先复用带多角度标记的缓存提示词，否则现场生成。
 * 取消信号向上抛出；其它失败回退到原始 prompt。
 */
async function applyGridPromptIfNeeded(db, log, row, signal, imageGenId) {
  // 调用时再取取消判定，避免与 imageServicePipeline.js 形成加载期循环依赖
  const { imageTaskCancelled } = require('./imageServicePipeline');
  // ── 四宫格模式：先生成4帧提示词，再拼装组合提示词 ──────────────────
  if (row.frame_type === 'quad_grid' && row.storyboard_id) {
    try {
      const loadConfig = require('../config').loadConfig;
      const cfg = loadConfig();

      // 先检查同一分镜是否已有已完成的四宫格提示词缓存
      const cachedRow = db.prepare(
        `SELECT prompt FROM image_generations
          WHERE storyboard_id = ? AND frame_type = 'quad_grid'
            AND prompt IS NOT NULL AND prompt != ''
            AND status = 'completed'
            AND id != ?
          ORDER BY created_at DESC LIMIT 1`
      ).get(Number(row.storyboard_id), imageGenId);

      // 只复用包含多角度标记的新版缓存提示词，旧版单一角度缓存自动作废
      const QUAD_CACHE_MARKER = 'eye-level shot';
      let quadPrompt = null;
      if (cachedRow?.prompt && cachedRow.prompt.includes(QUAD_CACHE_MARKER)) {
        quadPrompt = cachedRow.prompt;
        log.info('[图生] 使用缓存的四宫格提示词（跳过 AI 生成）', { id: imageGenId, prompt_len: quadPrompt.length });
      } else {
        if (cachedRow?.prompt) {
          log.info('[图生] 旧版单一角度缓存已作废，重新生成多角度提示词', { id: imageGenId });
        }
        quadPrompt = await buildQuadGridPrompt(db, log, cfg, row.storyboard_id, row.model, signal);
        if (quadPrompt) {
          log.info('[图生] 四宫格提示词已生成（新）', { id: imageGenId, prompt_len: quadPrompt.length });
        }
      }

      if (quadPrompt) {
        row.prompt = quadPrompt;
      }
    } catch (quadErr) {
      if (imageTaskCancelled(quadErr, signal)) throw quadErr;
      log.warn('[图生] 四宫格提示词生成失败，使用原始提示词', { id: imageGenId, error: quadErr.message });
    }
  }

  // ── 九宫格模式：先生成9帧提示词，再拼装组合提示词 ──────────────────
  if (row.frame_type === 'nine_grid' && row.storyboard_id) {
    try {
      const loadConfig = require('../config').loadConfig;
      const cfg = loadConfig();

      const NINE_CACHE_MARKER = 'worm\'s eye view';
      const cachedRow = db.prepare(
        `SELECT prompt FROM image_generations
          WHERE storyboard_id = ? AND frame_type = 'nine_grid'
            AND prompt IS NOT NULL AND prompt != ''
            AND status = 'completed'
            AND id != ?
          ORDER BY created_at DESC LIMIT 1`
      ).get(Number(row.storyboard_id), imageGenId);

      let ninePrompt = null;
      if (cachedRow?.prompt && cachedRow.prompt.includes(NINE_CACHE_MARKER)) {
        ninePrompt = cachedRow.prompt;
        log.info('[图生] 使用缓存的九宫格提示词（跳过 AI 生成）', { id: imageGenId, prompt_len: ninePrompt.length });
      } else {
        if (cachedRow?.prompt) {
          log.info('[图生] 旧版九宫格缓存已作废，重新生成多角度提示词', { id: imageGenId });
        }
        ninePrompt = await buildNineGridPrompt(db, log, cfg, row.storyboard_id, row.model, signal);
        if (ninePrompt) {
          log.info('[图生] 九宫格提示词已生成（新）', { id: imageGenId, prompt_len: ninePrompt.length });
        }
      }

      if (ninePrompt) {
        row.prompt = ninePrompt;
      }
    } catch (nineErr) {
      if (imageTaskCancelled(nineErr, signal)) throw nineErr;
      log.warn('[图生] 九宫格提示词生成失败，使用原始提示词', { id: imageGenId, error: nineErr.message });
    }
  }
}

/** 生成成功后按 frame_type 拆宫格；拆分失败只记日志，不影响主图提交。 */
function splitGeneratedGridIfNeeded(db, log, row, localPath, persistedImageUrl, cfg, imageGenId) {
  // 调用时再取存储根路径，避免与 imageServicePipeline.js 形成加载期循环依赖
  const { resolveStorageRoot } = require('./imageServicePipeline');
  const jobs = [];
  if (row.frame_type === 'quad_grid' && localPath) {
    const storagePath2 = resolveStorageRoot(cfg);
    const absLocalPath = path.join(storagePath2, localPath);
    jobs.push(splitQuadGridToImages(db, log, row, absLocalPath, storagePath2, persistedImageUrl).catch((e) => {
      log.warn('[图生] Step7 四宫格拆分异常', { id: imageGenId, error: e.message });
    }));
  }
  if (row.frame_type === 'nine_grid' && localPath) {
    const storagePath2 = resolveStorageRoot(cfg);
    const absLocalPath = path.join(storagePath2, localPath);
    jobs.push(splitNineGridToImages(db, log, row, absLocalPath, storagePath2, persistedImageUrl).catch((e) => {
      log.warn('[图生] Step7 九宫格拆分异常', { id: imageGenId, error: e.message });
    }));
  }
  return jobs.length ? Promise.all(jobs) : undefined;
}

module.exports = {
  splitQuadGridToImages,
  buildQuadGridPrompt,
  buildNineGridPrompt,
  splitNineGridToImages,
  applyGridPromptIfNeeded,
  splitGeneratedGridIfNeeded,
};
