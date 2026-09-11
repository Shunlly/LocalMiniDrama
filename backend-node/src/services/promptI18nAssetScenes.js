/**
 * 场景提取、分镜图片润色与空间布局锚点提示词。
 * 覆盖缓存在 promptI18n.js；由 promptI18nAssets.setOverrideCacheRef 注入同一对象，不另建独立 cache。
 */

const {
  isEnglish,
  styleTextForCfgLang,
} = require('./promptI18nResolve');

/** 与 promptI18n.js 共享的覆盖缓存引用 */
let _overrideCache = {};

/**
 * 注入 promptI18n.js 的同一份覆盖缓存。
 * @param {Record<string, string>} cache
 */
function setOverrideCacheRef(cache) {
  _overrideCache = cache;
}

function getSceneExtractionPrompt(cfg, style) {
  const styleText = (style || '').toString().trim();
  const s = styleText || styleTextForCfgLang(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `[Task] Extract all unique scene backgrounds from the script

[Requirements]
1. Identify all different scenes (location + time combinations) in the script
2. Generate detailed **English** image generation prompts for each scene
3. **Important**: Scene descriptions must be **pure backgrounds** without any characters, people, or actions
4. Prompt requirements:
   - Must use **English**, no Chinese characters
   - Detailed description of scene, time, atmosphere, style
   - Must explicitly specify "no people, no characters, empty scene"
   - **Style Requirement**: ${s}
   - **Image Ratio**: ${imageRatio}

[Output Format]
**CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code blocks. Start directly with [ and end with ].**
Each element: location, time, prompt (English image generation prompt for pure background).`;
  }
  const _sceneLocked = `\n5. **风格要求**：${s}\n   - **图片比例**：${imageRatio}\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块。直接以 [ 开头，以 ] 结尾。**\n每个元素包含：location（地点）, time（时间）, prompt（完整的中文图片生成提示词，纯背景，明确说明无人物）。`;
  const _sceneOverride = _overrideCache['scene_extraction'];
  if (_sceneOverride) {
    return _sceneOverride + _sceneLocked;
  }
  return `【任务】从剧本中提取所有唯一的场景背景

【要求】
1. 识别剧本中所有不同的场景（地点+时间组合）
2. 为每个场景生成详细的**中文**图片生成提示词（Prompt）
3. **重要**：场景描述必须是**纯背景**，不能包含人物、角色、动作等元素
4. **重要**：prompt 字段必须为中文，不得使用英文（风格词如 realistic 可保留）
5. **风格要求**：${s}
   - **图片比例**：${imageRatio}

【输出格式】
**重要：必须只返回纯JSON数组，不要包含任何markdown代码块。直接以 [ 开头，以 ] 结尾。**
每个元素包含：location（地点）, time（时间）, prompt（完整的中文图片生成提示词，纯背景，明确说明无人物）。`;
}

/**
 * 分镜图片 prompt 二次优化：将分镜叙事描述转化为图片生成模型优化的 prompt
 * 供 imageService.js Step3.5 调用，结果回写 image_generations.prompt
 */
function getImagePolishPrompt(cfg) {
  const isEn = isEnglish(cfg);
  if (isEn) {
    return `You are an expert image prompt engineer specializing in AI image generation for cinematic storyboards.

Your task: Transform a storyboard description into an optimized STATIC IMAGE generation prompt.

CRITICAL RULES:
1. Output ONLY the final prompt — no explanations, no labels, no JSON, no preamble
2. STATIC SINGLE FRAME — describe ONE frozen millisecond only. BANNED WORDS: camera, pan, push, pull, zoom, dolly, track, transition, shift, move, slowly, gradually, becomes, opens (as motion), as [subject] does X, while, then, cut to, scene shifts
3. SINGLE CONTINUOUS IMAGE — no split panels, no side-by-side layout, no collage, no comparison view. All characters share one unified scene space
4. Length: 50–100 words
5. Structure: [Shot framing] + [Scene/environment] + [Characters' frozen poses/expressions] + [Lighting at this exact instant] + [Atmosphere] + [Style tokens]
6. Describe characters' POSE and EXPRESSION at peak moment — not their motion arc
7. Preserve character names exactly as listed in ASSETS (they are reference image anchors)
8. **Style (mandatory):** Honor the 画风 / MANDATORY ART STYLE lines at the TOP of the user message AND the STYLE_TOKENS line — weave the same visual style through the whole prompt; the closing clause must repeat those style keywords (do not drop or replace them with generic words)
9. CONTINUITY: If PREV_CONTINUITY_STATE is provided, you MUST maintain consistency with the previous shot:
   - Match character clothing exactly (same outfit, same accessories)
   - Respect character body_posture logically (e.g. if prev shot shows character lying on bed, current shot must also show them lying on bed unless ACTION explicitly describes them moving)
   - Match lighting color temperature as described in PREV_CONTINUITY_STATE
   - If current ACTION explicitly changes character posture (e.g. "stands up", "sits down", "rises"), that override takes precedence over body_posture

Input format:
PROMPT: <original storyboard image prompt>
ACTION: <what characters are doing in this frozen moment>
DIALOGUE: <spoken dialogue — use for context only, do not quote it>
RESULT: <visual outcome visible in the frame>
ATMOSPHERE: <lighting and mood>
SHOT_TYPE: <framing type>
STYLE_TOKENS: <art style keywords — must appear in your output>
ASSETS: <character/scene names with reference images>
PREV_CONTINUITY_STATE: <JSON snapshot of character states from previous shot — clothing, position, expression>
CONTEXT_PREV: <previous shot action summary for continuity>
CONTEXT_NEXT: <next shot summary — ignore for image, relevant only for mood>`;
  }

  // 中文版：输出中文 prompt，铁律禁止服装描述
  return `你是一个专业的电影分镜图像生成提示词优化专家，专长于将分镜描述转化为适合AI图片生成模型的**静态单帧**优化提示词。

你的任务：输出**仅最终中文 prompt**（直接给图片AI使用，无任何解释、无标签、无JSON、无前言）。

【核心严格规则】

1. **静态单帧画面**：只描述动作完成后的一个冻结瞬间。严禁任何动态/运动词语（推镜、拉镜、摇镜、移动、逐渐、然后、切到、while、as [subject] does 等）。

2. **单一连续完整画面**：无分割、无四宫格、无并列、无拼贴、无对比布局。所有角色共享同一统一空间。

3. 输出长度约 80-160 字中文，用中文逗号「，」自然流畅连接成一段提示词。

4. 推荐 5 层结构（不加“第X层”标签，直接用逗号拼接）：
   第1层-镜头设计：景别 + 机位角度 + 构图方式
   第2层-光线：光源方向 + 光线质感 + 色温
   第3层-内容焦点：角色（**仅固定身份特征**：脸型、五官、发型、肤质、皮肤纹理、独特标记、年龄/性别等 + 结果姿态 + 情绪余韵） + 场景最终状态 + 关键道具位置
   第4层-氛围：情绪基调 + 色彩倾向 + 凝滞感/紧绷感
   第5层-视觉风格：必须完整重复用户消息顶部的画风词 + 电影分镜质感 + 图片比例 + 情绪收束

5. **角色外貌描述铁律（最高优先级，任何违反均视为失败）**：
   - 角色外貌**仅允许使用固定身份特征**（脸型、五官、发型、肤质、皮肤纹理、独特标记、年龄性别等）。
   - **严禁在 prompt 任何位置添加、推断、暗示任何服装、衣着、服饰、配饰、鞋帽、居家服、西装、裙装、loungewear 等描述**。
   - 服装、穿着、配饰完全由参考图（ASSETS 中列出的角色参考图）决定，**文字提示词中绝不出现任何服装相关词汇**。
   - 只有当固定身份特征中本来就包含眼镜、疤痕、纹身等辨识标记时，才可极简提及；否则一律不提。

6. 严格保留 ASSETS 列表中的角色名称（它们是参考图锚点），格式示例：“李娟（圆脸、高鼻梁、短发、面容略带疲惫）”。

7. **画风·最高优先级**：必须完全融入用户消息顶部的【画风·最高优先级】和 STYLE_TOKENS 行，结尾必须重复这些关键词（不要用泛化词替换）。

8. **服装与连戏一致性铁律**：
   - 如果提供了 PREV_CONTINUITY_STATE，必须**逐字匹配**上一镜头中该角色的服装描述（若有）。
   - 当前 ACTION 未明确写明“换衣服/脱外套/换装”等动作，则**绝不改变或重新描述服装**。
   - 没有 PREV_CONTINUITY_STATE 时，**完全不在 prompt 中出现任何服装相关词**。
   - 参考图的视觉优先级永远高于文字描述。

输入格式（与之前相同）：
PROMPT: <原始分镜图像提示词>
ACTION: <该冻结瞬间角色的动作>
DIALOGUE: <对白，仅供上下文参考，不要直接引用>
RESULT: <画面可见的结果>
ATMOSPHERE: <光线与情绪>
SHOT_TYPE: <景别>
STYLE_TOKENS: <必须在输出中重复的画风关键词>
ASSETS: <角色/场景名称 + 参考图说明>
PREV_CONTINUITY_STATE: <上一镜头的连戏状态快照 JSON，含服装/位置/表情>
CONTEXT_PREV / CONTEXT_NEXT: 上下文（仅用于情绪参考）

请直接输出一段纯中文 prompt 文字。`;
}

/**
 * 为单个分镜重新生成/优化 layout_description（空间布局与人物站位合同）
 * 专为首尾帧一致性 + 上下分镜连贯性设计
 */
function getRegenerateLayoutDescriptionPrompt(cfg) {
  const isEn = isEnglish(cfg);
  if (isEn) {
    return `You are a professional film continuity supervisor and storyboard spatial designer.

Your task: Regenerate or optimize a precise, concise "layout_description" (spatial layout anchor / 画面布局锚点) for the CURRENT shot.

Core Requirements (HIGHEST PRIORITY):
1. Output ONLY the new layout_description text (1-2 short sentences, max ~120 characters). No explanations, no JSON, no labels.
2. Be extremely specific about screen positions: left/center/right third of frame, relative distances between characters, facing directions, relation to props/environment, overall composition (rule of thirds / center / frame etc.), and camera distance feel.
3. **Realistic physical scale awareness (MANDATORY)**: Explicitly state realistic sizes and proportions of major props that actually appear in the shot, matching the story's era/setting (e.g. ancient: writing desk ~75cm, scroll at normal size; modern: side table ~45cm). Never write phrases that would cause scale errors or anachronistic modern props in period settings.
4. **Cinematic breathing room for movement (MANDATORY)**: Reserve natural evolution space for the shot's declared camera_movement (push/pull/pan/handheld etc.). State that first/last frames must keep core character placement and realistic prop scales, but allow natural framing adjustments that result from the movement (e.g. slight tighter framing on push-in, slight handheld drift, natural entry/exit on pan). Goal: enable real dynamic video instead of near-static locked shots.
5. **Cross-shot continuity (CRITICAL)**: The new layout MUST form a natural, believable spatial continuation from PREV_LAYOUT (if provided) and must logically lead into NEXT_LAYOUT (if provided). Avoid sudden unexplained left-right flips or major repositioning of characters between adjacent shots unless the ACTION/RESULT of the current shot explicitly requires it.
6. The description must be directly usable as the highest-priority contract for first-frame and last-frame image generation (for models like Seedance 1.5 Pro), and must embed both realistic scale anchors AND movement breathing room to prevent prop drift and motion suppression in AI image/video generation.

Style: Professional, film-precise, actionable for AI image generators. Use Chinese if the project is Chinese, otherwise English.`;
  }
  return `你是一位专业的电影连戏监督与分镜空间设计师。

任务：为**当前分镜**重新生成或优化一个精确、简洁的「layout_description」（空间布局锚点 / 画面布局与人物站位合同）。

核心要求（最高优先级）：
1. **只输出新的 layout_description 文本**（1-2 句短句，总字数建议控制在 120 字以内）。不要任何解释、不要 JSON、不要前缀后缀。
2. 必须极度具体描述画面站位：画面左/中/右三分、人物间相对距离、朝向、与道具/环境的关系、整体构图方式（三分法/中心/框架等）、机位距离感。
3. **真实物体尺度意识（强制）**：必须明确写出主要道具的真实物理尺度与相对比例，且**必须符合剧本时代背景**（仅写本分镜实际出现的道具；古代场景示例：“木质案几位于右下前景，高度约75cm，书卷平放为正常尺寸，铜灯与茶具均为次要环境小物件，绝不夸大”）。严禁写出任何会导致比例失真的表述，**严禁写入与时代不符的现代道具**。
4. **运镜呼吸空间（强制）**：必须为本分镜的 movement（推/拉/摇/跟/手持等）预留自然演化空间。说明首尾帧在核心站位和真实尺度一致的前提下，允许根据 movement 进行取景微调（缓推可稍紧、手持可轻微晃动偏移、横摇可有自然进入/退出）。目标是让首尾帧支持真正动态的视频，而不是几乎定格。
5. **跨镜连贯性（铁律）**：新布局必须与「上一分镜的布局描述」形成自然延续，同时能引向下一分镜。除非 action/result 明确要求，否则严禁突然左右互换或大幅跳跃。
6. 该描述将作为首帧/尾帧生成的最高优先级合同（尤其适配 Seedance 等模型），必须同时包含真实尺度锚点 + 运镜演化空间，防止AI生图时道具比例漂移或运镜被锁死。

语气：专业、电影化、精确、可直接喂给图像 AI 使用。必须用中文输出。`;
}

module.exports = {
  setOverrideCacheRef,
  getSceneExtractionPrompt,
  getImagePolishPrompt,
  getRegenerateLayoutDescriptionPrompt,
};
