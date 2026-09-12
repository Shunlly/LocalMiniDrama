const path = require('path');
const uploadService = require('../services/uploadService');
const angleService = require('../services/angleService');
const query = require('./storyboardsQuery');

/** 润色接口：邻镜结构化摘要（含全能片段与其它提示词字段） */
function formatNeighborShotPolishContext(row) {
  if (!row) return '(none)';
  const chunk = (k, v) => {
    const s = v != null && String(v).trim() ? String(v).trim() : '';
    return s ? `${k}: ${s}` : null;
  };
  const bits = [
    chunk('SHOT_NUM', row.storyboard_number),
    chunk('TITLE', row.title),
    chunk('DESCRIPTION', row.description),
    chunk('ACTION', row.action),
    chunk('DIALOGUE', row.dialogue),
    chunk('NARRATION', row.narration),
    chunk('VIDEO_PROMPT', row.video_prompt),
    chunk('UNIVERSAL_SEGMENT_TEXT', row.universal_segment_text),
  ].filter(Boolean);
  return bits.length ? bits.join('\n') : '(empty)';
}


function clipClassicCtx(s, maxLen) {
  if (s == null) return '';
  const t = String(s).trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

/**
 * 从「场景：…。配乐：…」式拼装文案中拆出带标签的分句，供润色时强制保留信息点（配乐/音效/情绪强度/画幅/完整镜头英文等）。
 */
function extractRetentionClausesFromVideoPrompts(draft, composed) {
  const seen = new Set();
  const out = [];
  const sources = [draft, composed].map((x) => (x != null ? String(x).trim() : '')).filter(Boolean);
  for (const full of sources) {
    const pieces = full
      .replace(/\r\n/g, '\n')
      .trim()
      .split(/。+/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (let piece of pieces) {
      piece = piece.replace(/\s*=\s*VideoRatio\s*:/gi, '=VideoRatio:').trim();
      if (!piece) continue;
      const labeled = /^(场景|镜头标题|动作|对话|对白|结果|景别|镜头角度|运镜|氛围|情绪|情绪强度|配乐|音效|时长|风格|解说旁白)[：:]/.test(
        piece
      );
      const hasRatio = /=VideoRatio\s*:/i.test(piece);
      if (!labeled && !hasRatio) continue;
      const dedupKey = piece.slice(0, 140);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      let c = piece;
      if (/^镜头角度/.test(c) && c.length > 920) c = `${c.slice(0, 920)}…`;
      else if (c.length > 560) c = `${c.slice(0, 560)}…`;
      if (!/[。．…]$/.test(c)) c += '。';
      out.push(c);
    }
  }
  return out;
}

/** 经典视频润色：邻镜长上下文（衔接剧情与已有视频文案） */
const MOVEMENT_LABEL_ZH = {
  static: '固定镜头',
  push: '推镜',
  pull: '拉镜',
  pan: '横摇',
  tilt: '纵摇',
  tracking: '跟镜',
  crane_up: '升镜',
  crane_dn: '降镜',
  orbit: '环绕',
  handheld: '手持',
};

const LIGHTING_LABEL_ZH = {
  natural: '自然光',
  front: '顺光',
  side: '侧光',
  backlit: '逆光',
  top: '顶光',
  under: '底光',
  soft: '柔光',
  dramatic: '戏剧光',
  golden_hour: '黄金时段',
  blue_hour: '蓝调时刻',
  night: '夜景',
  neon: '霓虹',
};

const DEPTH_LABEL_ZH = {
  extreme_shallow: '极浅景深',
  shallow: '浅景深',
  medium: '中景深',
  deep: '深景深（全焦）',
};

function movementDisplay(sbRow) {
  const raw = sbRow.movement != null ? String(sbRow.movement).trim() : '';
  if (!raw) return '';
  const zh = MOVEMENT_LABEL_ZH[raw];
  return zh ? `${zh}（${raw}）` : raw;
}

function lightingDisplay(sbRow) {
  const raw = sbRow.lighting_style != null ? String(sbRow.lighting_style).trim() : '';
  if (!raw) return '';
  const zh = LIGHTING_LABEL_ZH[raw];
  return zh ? `${zh}（${raw}）` : raw;
}

function depthDisplay(sbRow) {
  const raw = sbRow.depth_of_field != null ? String(sbRow.depth_of_field).trim() : '';
  if (!raw) return '';
  const zh = DEPTH_LABEL_ZH[raw];
  return zh ? `${zh}（${raw}）` : raw;
}

/** 结构化视角：中文标签 + 英文片语，供润色必覆盖清单 */
function angleCoverageLine(sbRow) {
  if (sbRow.angle_h && sbRow.angle_v && sbRow.angle_s) {
    try {
      const zh = angleService.toChineseLabel(sbRow.angle_h, sbRow.angle_v, sbRow.angle_s);
      const en = angleService.toPromptFragment(sbRow.angle_h, sbRow.angle_v, sbRow.angle_s);
      return `镜头角度（机位/景别）：${zh}；${en}`;
    } catch (_) {
      return sbRow.angle ? String(sbRow.angle).trim() : '';
    }
  }
  return sbRow.angle ? String(sbRow.angle).trim() : '';
}

/**
 * 凡非空字段逐条列出；模型须在同一段成稿中全部体现其语义（可改写，不可丢信息）。
 */
function buildClassicRequiredCoverageDigest(sbRow, linkedSceneText) {
  const lines = [];
  const add = (label, text) => {
    const s = text != null ? String(text).trim() : '';
    if (s) lines.push(`- ${label}：${s}`);
  };
  const sceneLocTime = [sbRow.location, sbRow.time].filter((x) => x != null && String(x).trim()).join('，');
  add('场景（地点与时间）', sceneLocTime);
  if (linkedSceneText) add('关联场景库（地点/时间/摘要）', linkedSceneText);
  add('镜头标题', sbRow.title);
  add('分镜描述', sbRow.description);
  add('人物动作', sbRow.action);
  add('人物对白', sbRow.dialogue);
  add('解说旁白', sbRow.narration);
  add('画面结果/落幅', sbRow.result);
  add('氛围', sbRow.atmosphere);
  add('情绪', sbRow.emotion);
  if (sbRow.emotion_intensity != null && sbRow.emotion_intensity !== '') {
    const ei = Number(sbRow.emotion_intensity);
    if (Number.isFinite(ei)) add('情绪强度', String(ei));
    else add('情绪强度', String(sbRow.emotion_intensity).trim());
  }
  add('景别', sbRow.shot_type);
  const ang = angleCoverageLine(sbRow);
  if (ang) add('镜头方式（视角/机位）', ang);
  add('光线/灯光风格', lightingDisplay(sbRow) || sbRow.lighting_style);
  add('景深', depthDisplay(sbRow) || sbRow.depth_of_field);
  add('运镜', movementDisplay(sbRow) || sbRow.movement);
  const dur = Number(sbRow.duration);
  const sec = Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 5;
  add('时长（秒）', `${sec}`);
  if (sbRow.segment_title != null && String(sbRow.segment_title).trim()) {
    add('剧情段落', `「${String(sbRow.segment_title).trim()}」` + (sbRow.segment_index != null ? `（段序号 ${sbRow.segment_index}）` : ''));
  }
  if (!lines.length) return '(当前无非空结构化字段；请依据剧本与 AUTO_COMPOSED 润色)';
  return ['下列维度在库中均有值——成稿须**全部覆盖**其语义（允许电影化改写，禁止删事实、改秒数、改对白原意）：', ...lines].join('\n');
}

function formatClassicVideoNeighborBlock(label, row) {
  if (!row) return `${label}:\n(none)`;
  const lines = [
    row.storyboard_number != null && row.storyboard_number !== ''
      ? `SHOT_NUM: ${row.storyboard_number}`
      : null,
    row.title ? `TITLE: ${clipClassicCtx(row.title, 180)}` : null,
    row.description ? `DESCRIPTION: ${clipClassicCtx(row.description, 420)}` : null,
    row.action ? `ACTION: ${clipClassicCtx(row.action, 450)}` : null,
    row.dialogue ? `DIALOGUE: ${clipClassicCtx(row.dialogue, 320)}` : null,
    row.narration ? `NARRATION: ${clipClassicCtx(row.narration, 320)}` : null,
    row.video_prompt ? `VIDEO_PROMPT: ${clipClassicCtx(row.video_prompt, 450)}` : null,
    row.universal_segment_text
      ? `UNIVERSAL_SEGMENT_TEXT: ${clipClassicCtx(row.universal_segment_text, 260)}`
      : null,
  ].filter(Boolean);
  return `${label}:\n${lines.length ? lines.join('\n') : '(empty)'}`;
}

/** 全能片段：@图片N 与中英字、引号之间补半角空格，便于模型与接口解析 */
function normalizeUniversalSegmentAtImageSpacing(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(
    /@图片(\d+)(?=[\u4e00-\u9fffA-Za-z「『【（])/gu,
    '@图片$1 '
  );
}


function beginNdjsonStream(res) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  return (obj) => {
    res.write(`${JSON.stringify(obj)}\n`);
  };
}

function assembleImageStyleBlock(styleZh, styleEn) {
  const styleForTokens =
    styleEn ||
    styleZh ||
    'cinematic movie still, anamorphic lens, film grain, dramatic lighting, shallow depth of field, professional cinematography';
  const styleBlockLines = [];
  if (styleZh) styleBlockLines.push(`【画风·最高优先级】${styleZh}`);
  if (styleEn && styleEn !== styleZh) styleBlockLines.push(`MANDATORY ART STYLE: ${styleEn}.`);
  else if (styleEn && !styleZh) styleBlockLines.push(`MANDATORY ART STYLE: ${styleEn}.`);
  else if (!styleZh && !styleEn) styleBlockLines.push(`MANDATORY ART STYLE: ${styleForTokens}.`);
  return { styleForTokens, styleBlockLines };
}

function assembleImagePolishUserPrompt(sb, styleBlock, neighbor, assetNames) {
  return [
    ...styleBlock.styleBlockLines,
    sb.image_prompt ? `PROMPT: ${sb.image_prompt}` : null,
    sb.action ? `ACTION: ${sb.action}` : null,
    sb.dialogue ? `DIALOGUE: ${sb.dialogue}` : null,
    sb.result ? `RESULT: ${sb.result}` : null,
    sb.atmosphere ? `ATMOSPHERE: ${sb.atmosphere}` : null,
    sb.shot_type ? `SHOT_TYPE: ${sb.shot_type}` : null,
    `STYLE_TOKENS (repeat in output): ${styleBlock.styleForTokens}`,
    `ASSETS: ${assetNames || 'none'}`,
    neighbor.prevContinuityState ? `PREV_CONTINUITY_STATE: ${JSON.stringify(neighbor.prevContinuityState)}` : null,
    `CONTEXT_PREV: ${neighbor.prevDesc}`,
    `CONTEXT_NEXT: ${neighbor.nextDesc}`,
    'REMINDER: Output a STATIC SINGLE-FRAME image prompt only. No camera motion, no transitions, no split panels.',
  ].filter(Boolean).join('\n');
}

function newPolishPassStamp() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function assembleUniversalSegmentPolishUserPrompt({ draft, baseUser, scriptText, prevRow, nextRow }) {
  const polishPassStamp = newPolishPassStamp();
  return [
    'TASK: POLISH_UNIVERSAL_OMNI_SEGMENT',
    `POLISH_PASS_STAMP: ${polishPassStamp}`,
    'POLISH_REFRESH（多次点击「润色」时强制）: 在严格遵守 MULTI_BEAT_OUTPUT、子分镜秒数之和=TOTAL_CLIP_SECONDS、IMAGE_SLOT_MAP、不编造剧本外情节的前提下，**本轮输出须与 CURRENT_OMNI_DRAFT 在中文表述上有明显差异**（换动词/语序、合并或拆分从句、加强或收紧运镜与情绪描写均可；**第3行仍须与 LINE3_REQUIRED 完全一致**）。除第3行外，**禁止**与草稿逐字相同或仅标点差异；若 M 与秒数分配不变，子分镜正文也须重写措辞。',
    'DIALOGUE_RETENTION（硬性，与 system 全能润色一致）: BASE_OMNI_CONTRACT 内 STORYBOARD FIELDS 的 DIALOGUE、NARRATION、VIDEO_PROMPT 及 CURRENT_OMNI_DRAFT 中一切对白/旁白/引号句，成稿各「分镜k」行须**逐条以「」或明确旁白写出**，保留笑点、数字、剧名、奖项名等关键信息；禁止用「两人对话」「念词带过」等概括替代具体台词。总秒数与各 Tk 不变前提下提高信息密度：台词与反应优先，少写无推进的纯氛围叠句。',
    'You are refining the CURRENT omni multi-beat prompt for a short drama vertical-video shot.',
    `FULL_EPISODE_SCRIPT（本集完整剧本，用于信息对齐与连戏；不得引入剧本未写的情节）:\n${scriptText || '(本集剧本正文为空，请仅依据下方 STORYBOARD FIELDS 与邻镜信息)'}`,
    '',
    'NEIGHBOR_PREV（上一分镜：含其全能片段与其它提示词字段，供衔接）:',
    formatNeighborShotPolishContext(prevRow),
    '',
    'NEIGHBOR_NEXT（下一分镜）:',
    formatNeighborShotPolishContext(nextRow),
    '',
    'CURRENT_OMNI_DRAFT（用户当前全能片段文本，必须在此基础上增强而非另起无关故事）:',
    draft,
    '',
    '--- BASE_OMNI_CONTRACT（与生成接口相同的约束与分镜字段块）---',
    baseUser,
  ].join('\n');
}

function assembleClassicFieldLines(sbRow) {
  return [
    ['SHOT_NUM', sbRow.storyboard_number],
    ['TITLE', sbRow.title],
    ['DESCRIPTION', sbRow.description],
    ['LOCATION', sbRow.location],
    ['TIME', sbRow.time],
    ['DURATION_SEC', sbRow.duration],
    ['ACTION', sbRow.action],
    ['DIALOGUE', sbRow.dialogue],
    ['NARRATION', sbRow.narration],
    ['RESULT', sbRow.result],
    ['ATMOSPHERE', sbRow.atmosphere],
    ['EMOTION', sbRow.emotion],
    ['EMOTION_INTENSITY', sbRow.emotion_intensity],
    ['SHOT_TYPE', sbRow.shot_type],
    ['ANGLE_H', sbRow.angle_h],
    ['ANGLE_V', sbRow.angle_v],
    ['ANGLE_S', sbRow.angle_s],
    ['ANGLE_LEGACY', sbRow.angle],
    ['MOVEMENT', sbRow.movement],
    ['LIGHTING_STYLE', sbRow.lighting_style],
    ['DEPTH_OF_FIELD', sbRow.depth_of_field],
    ['SEGMENT_INDEX', sbRow.segment_index],
    ['SEGMENT_TITLE', sbRow.segment_title],
    ['IMAGE_PROMPT', sbRow.image_prompt],
    ['POLISHED_IMAGE_PROMPT', sbRow.polished_prompt],
  ]
    .map(([k, v]) => {
      if (v == null || v === '') return null;
      const s = String(v).trim();
      return s ? `${k}: ${s}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

function assembleClassicVideoPolishUserPrompt({
  sbRow,
  styleZh,
  styleEn,
  videoRatio,
  scriptText,
  prevRow,
  nextRow,
  dramaTitle,
  episodeTitle,
  shotTotalInEpisode,
  firstFrameAnchor,
  linkedSceneText,
  autoComposed,
  currentDraft,
}) {
  const fieldLines = assembleClassicFieldLines(sbRow);
  const retentionClauses = extractRetentionClausesFromVideoPrompts(
    currentDraft || '',
    String(autoComposed || '').trim()
  );
  const polishPassStamp = newPolishPassStamp();
  return [
    'TASK: POLISH_CLASSIC_STORYBOARD_STILL_TO_VIDEO_PROMPT',
    `POLISH_PASS_STAMP: ${polishPassStamp}`,
    'POLISH_REFRESH: 用户可多次润色；事实与时长不变，但须明显换表述；禁止与 CURRENT_VIDEO_DRAFT 仅标点或个别虚词差异。',
    'OUTPUT_GOAL: 单段、可直接送图生视频模型的专业提示词；首帧画面已由参考图锁定，文案负责动效、节奏、运镜意图、声画暗示与画风气质。',
    '',
    `PROJECT:\nDRAMA_TITLE: ${dramaTitle || '(unknown)'}\nEPISODE_TITLE: ${episodeTitle || '(unknown)'}`,
    `SHOT_SEQUENCE: 当前镜号 ${sbRow.storyboard_number ?? '?'} / 本集共 ${shotTotalInEpisode || '?'} 镜`,
    `VIDEO_RATIO: ${videoRatio}`,
    '',
    `FULL_EPISODE_SCRIPT（用于人物关系、因果与语气；勿编造剧本未出现的情节）:\n${scriptText || '(本集剧本正文为空)'}`,
    '',
    'NEIGHBOR_PREV（上一镜：用于入戏衔接、情绪与空间连贯）:',
    formatClassicVideoNeighborBlock('PREV', prevRow),
    '',
    'NEIGHBOR_NEXT（下一镜：用于本镜收束与出口暗示，勿剧透下一镜未发生的具体事件）:',
    formatClassicVideoNeighborBlock('NEXT', nextRow),
    '',
    'STORYBOARD_FIELDS（当前镜结构化事实）:',
    fieldLines || '(empty)',
    '',
    'REQUIRED_COVERAGE_DIGEST（下列凡出现「- 维度：」行的，润色成稿必须全部体现其语义；可与邻镜/剧本融合叙述，禁止省略事实、禁止改对白原意、禁止改时长秒数）:',
    buildClassicRequiredCoverageDigest(sbRow, linkedSceneText),
    '',
    `FIRST_FRAME_VISUAL_ANCHOR（分镜参考静帧对应的英文/中文图提示摘要；动效须与此一致，禁止改换装、改人脸特征、改场景时代）:\n${
      firstFrameAnchor || '(无图侧文本；仅依据 STORYBOARD FIELDS 与剧本推断画面)'
    }`,
    '',
    `AUTO_COMPOSED_VIDEO_PROMPT（与程序字段拼装一致，作事实底线）:\n${autoComposed}`,
    '',
    `CURRENT_VIDEO_DRAFT（用户当前 video_prompt，优先在其上润色）:\n${currentDraft || '(empty — use AUTO_COMPOSED + FIELDS)'}`,
    '',
    'RETENTION_CLAUSES_FROM_SOURCE（由 CURRENT_VIDEO_DRAFT / AUTO_COMPOSED 按句号拆出的「标签分句」；每一条中的**全部信息点**须在成稿中出现——含：配乐侧写、音效层次、情绪强度数值、括号内**完整**英文镜头/景深/透视描述、=VideoRatio 画幅；允许调整语序与衔接词，**禁止**把多条合并后只剩笼统氛围描写而导致某类信息消失）:',
    retentionClauses.length
      ? retentionClauses.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(未解析到「场景：/配乐：/镜头角度：/=VideoRatio:」等标签分句；此时须把 CURRENT_VIDEO_DRAFT 全文信息等价写入成稿，禁止删减子句类别。)',
    '',
    `VISUAL_STYLE（须内化进成稿；中文气质描写 + 英文质感词均可）:\nSTYLE_ZH: ${styleZh || '(none)'}\nSTYLE_EN: ${styleEn || '(none)'}`,
  ].join('\n');
}

function classicFirstFrameAnchor(sbRow) {
  return clipClassicCtx(
    (sbRow.polished_prompt && String(sbRow.polished_prompt).trim()) ||
      (sbRow.image_prompt && String(sbRow.image_prompt).trim()) ||
      '',
    980
  );
}

function pickPhotographyParamPatch(row, overwrite) {
  const inferred = angleService.inferPhotographyParams(row);
  if (overwrite) {
    if (inferred.movement || inferred.lighting_style || inferred.depth_of_field) {
      return { mode: 'overwrite', inferred };
    }
    return null;
  }
  const newMovement = row.movement ? null : inferred.movement;
  const newLighting = row.lighting_style ? null : inferred.lighting_style;
  const newDof = row.depth_of_field ? null : inferred.depth_of_field;
  if (newMovement || newLighting || newDof) {
    return { mode: 'fill', newMovement, newLighting, newDof };
  }
  return null;
}

function resolveUpscaleOutputRelativePath(relativePath) {
  const ext = path.extname(relativePath) || '.jpg';
  const baseName = path.basename(relativePath, ext);
  const dirName = path.posix.dirname(relativePath);
  return uploadService.normalizeStorageRelativeReference(
    `${dirName === '.' ? '' : `${dirName}/`}${baseName}_2x${ext}`
  );
}

function assembleImagePolishContext(db, sb, sbId) {
  const style = query.loadMergedDramaStyle(db, sb.episode_id);
  const styleBlock = assembleImageStyleBlock(style.styleZh, style.styleEn);
  const neighbor = query.loadNeighborContinuity(db, sb);
  const assetNames = query.loadCharacterAssetNames(db, sbId);
  const userPrompt = assembleImagePolishUserPrompt(sb, styleBlock, neighbor, assetNames);
  return { style, styleBlock, neighbor, assetNames, userPrompt };
}

function assembleUniversalSegmentPolishContext(db, { draft, baseUser, episodeId, storyboardNumber }) {
  const scriptText = query.loadEpisodeScript(db, episodeId);
  const { prevRow, nextRow } = query.loadNeighborPolishRows(db, episodeId, storyboardNumber);
  return assembleUniversalSegmentPolishUserPrompt({
    draft,
    baseUser,
    scriptText,
    prevRow,
    nextRow,
  });
}

function assembleClassicVideoPolishContext(db, { sbRow, style, autoComposed, currentDraft }) {
  const scriptText = query.loadEpisodeScript(db, sbRow.episode_id);
  const { prevRow, nextRow } = query.loadNeighborPolishRows(db, sbRow.episode_id, sbRow.storyboard_number);
  const project = query.loadClassicProjectContext(db, style.dramaId, sbRow.episode_id);
  const firstFrameAnchor = classicFirstFrameAnchor(sbRow);
  const linkedSceneText = query.loadLinkedSceneText(db, sbRow.scene_id);
  return assembleClassicVideoPolishUserPrompt({
    sbRow,
    styleZh: style.styleZh,
    styleEn: style.styleEn,
    videoRatio: style.videoRatio,
    scriptText,
    prevRow,
    nextRow,
    dramaTitle: project.dramaTitle,
    episodeTitle: project.episodeTitle,
    shotTotalInEpisode: project.shotTotalInEpisode,
    firstFrameAnchor,
    linkedSceneText,
    autoComposed,
    currentDraft,
  });
}

module.exports = {
  formatNeighborShotPolishContext,
  clipClassicCtx,
  extractRetentionClausesFromVideoPrompts,
  movementDisplay,
  lightingDisplay,
  depthDisplay,
  angleCoverageLine,
  buildClassicRequiredCoverageDigest,
  formatClassicVideoNeighborBlock,
  normalizeUniversalSegmentAtImageSpacing,
  beginNdjsonStream,
  assembleImageStyleBlock,
  assembleImagePolishUserPrompt,
  assembleImagePolishContext,
  assembleUniversalSegmentPolishUserPrompt,
  assembleUniversalSegmentPolishContext,
  assembleClassicFieldLines,
  assembleClassicVideoPolishUserPrompt,
  assembleClassicVideoPolishContext,
  classicFirstFrameAnchor,
  pickPhotographyParamPatch,
  resolveUpscaleOutputRelativePath,
};
