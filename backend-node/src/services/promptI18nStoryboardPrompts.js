/**
 * 分镜系统提示、全能格式说明、用户后缀与解说旁白附加说明。
 * 系统提示词实现见 promptI18nStoryboardSystem.js；本文件再导出 getStoryboardSystemPrompt。
 * 覆盖缓存在 promptI18n.js；由 promptI18nStoryboard.js 注入同一对象并再导出，不另建独立 cache。
 */

const {
  isEnglish,
  buildStoryboardDurationInstruction,
} = require('./promptI18nResolve');
const storyboardSystem = require('./promptI18nStoryboardSystem');

/** 与 promptI18n.js 共享的覆盖缓存引用 */
let _overrideCache = {};

/**
 * 注入 promptI18n.js 的同一份覆盖缓存。
 * @param {Record<string, string>} cache
 */
function setOverrideCacheRef(cache) {
  _overrideCache = cache;
}

/** 供分镜系统提示词读取同一份覆盖缓存。 */
function getOverrideCache() {
  return _overrideCache;
}

const getStoryboardSystemPrompt = (cfg) => storyboardSystem.getStoryboardSystemPrompt(cfg, getOverrideCache);

/**
 * 全能片段描述统一格式说明（分镜批量生成 / 生成全能提示词 / 润色 共用）
 */
function getUniversalOmniMultiBeatFormatSpec(cfg) {
  const { DEFAULT_LINE3 } = require('./universalOmniMultiBeatFormat');
  if (isEnglish(cfg)) {
    return `
[UNIVERSAL_SEGMENT_TEXT — MULTI-BEAT BLOCK FORMAT ONLY]
FORBIDDEN: SoulLens/SEEDANCE single-line rows (主体:/叙事动态:/空间:/[禁BGM]); FORBIDDEN @人物N — use @图片1, @图片2, … only.

Field "universal_segment_text" is a **multi-line string** (use \\n in JSON). Structure:
Line 1: 画面风格和类型: 真人写实, 电影风格, 高清画质, <short style from project>
Line 2: 生成一个由以下M个分镜组成的视频. (M integer 1–8)
Line 3 (copy verbatim): ${DEFAULT_LINE3}
Lines 4..(3+M): 分镜k： Tk秒: <cinematic Chinese prose for that slice; camera motion chain; light; emotion>
Sum(T1..TM) MUST equal this shot's JSON "duration" seconds exactly.

Reference tokens: @图片1 = scene/environment only; @图片2+ = characters in characters[] order; then props if any.
Dialogue: @图片2 says:"verbatim line" or …嗓音…："line". No speech: end with 无对白。
Narration: 旁白（画面无声）："verbatim narration"
Each beat: rich motion picture prose (push in, pull back, rack focus), not a static snapshot caption.`;
  }
  return `
【universal_segment_text — 多子分镜段落格式（与「生成全能提示词」「润色」完全一致）】
**禁止**使用已废弃的灵境/SoulLens **单行**格式（含「主体：」「叙事动态：」「空间：」「镜头：」段标、行末 [禁BGM][禁字幕]、@人物N 指代参考图）。

本字段为 **多行字符串**（JSON 中用 \\n 换行），结构固定：
第1行：画面风格和类型: 真人写实, 电影风格, 高清画质, <可再加项目风格短语>
第2行：生成一个由以下M个分镜组成的视频。（M 为 1–8 的整数，与下文分镜条数一致）
第3行（必须逐字一致）：${DEFAULT_LINE3}
第4行起：分镜1： T1秒: …、分镜2： T2秒: … … 分镜M： TM秒: …
**硬性约束**：T1+T2+…+TM 必须严格等于本镜 JSON 的 duration（秒）；每行一条子分镜，禁止额外说明行。

子分镜正文写法（电影化中文长句，参考产品范例）：
- **参考图**：仅用 @图片1、@图片2…（阿拉伯数字）；@图片1 只写环境/光影/陈设；角色从 @图片2 起按 characters[] 顺序；有道具则继续 @图片3 …
- **运镜**：每段含至少两步运镜（如 缓推、横移、跟拍、拉回、俯拍特写），与人物动作同步。
- **对白**：有 dialogue 时必须写出原文，格式如 @图片2 的嗓音…："对白原文" 或 @图片2 说："对白原文"；无对白则句末写 **无对白。**
- **解说**：有 narration 时写在合适子分镜：**旁白（画面无声）："解说原文"**
- **禁止**：概括式台词（如「他说了一句重要的话」）、@人物N、markdown、SoulLens 段标签

范例结构（勿照抄剧情，仅学排版）：
画面风格和类型: 真人写实, 电影风格, 高清画质, 日本动漫画风
生成一个由以下3个分镜组成的视频。
${DEFAULT_LINE3}
分镜1： 5秒: 镜头从 @图片1 … 无对白。
分镜2： 5秒: … @图片2 …："台词原文"
分镜3： 5秒: … 旁白（画面无声）："解说原文"`;
}

/**
 * 分镜生成「全能分镜模式」：JSON 每镜带 creation_mode + universal_segment_text（多子分镜段落格式）
 */
function getStoryboardUniversalOmniModeSuffix(cfg) {
  const spec = getUniversalOmniMultiBeatFormatSpec(cfg);
  if (isEnglish(cfg)) {
    return `

[HIGHEST PRIORITY — UNIVERSAL OMNI STORYBOARD MODE]
Every shot object MUST also include:
1. "creation_mode": exact string "universal".
2. "universal_segment_text": multi-line block per spec below (NOT a single SoulLens line).
${spec}`;
  }
  return `

【最高优先级——全能分镜模式】
每个镜头在保留上述全部原有字段的同时，还必须额外包含：
1. "creation_mode"：固定字符串 "universal"（不可省略）。
2. "universal_segment_text"：按下列 **多子分镜段落** 规范书写（与后续「生成全能提示词」「润色」同一套版式，禁止单行灵境格式）。
${spec}`;
}

/** 分镜生成勾选「解说旁白」时追加到用户提示词末尾 */
function getStoryboardNarrationExtraInstructions(cfg) {
  if (isEnglish(cfg)) {
    return `

【VO / Narration mode — STRICT (user enabled full VO pipeline)】
- Add string field "narration" to **each** shot. **Every "narration" MUST be a non-empty string** (at least one full sentence), readable within this shot's "duration".
- **Shot with shot_number = 1 MUST** open with narrator lines: set time/place/mood or a hook — never leave empty because the shot is "establishing only".
- **Shot 2** should also carry narration if it is still wide/establishing; do not leave both 1 and 2 empty.
- Third-person / documentary narrator voice — **not** character dialogue (keep spoken lines in "dialogue" only). Do not copy dialogue text into "narration".
- 1–3 short sentences per shot; forbid consecutive shots with empty "narration".`;
  }
  return `

【解说旁白模式 — 硬性要求（用户已开启全片解说管线）】
- 在 "storyboards" 数组的**每一个**镜头对象中必须有字符串字段 "narration"，且 **narration 一律不得为空字符串**（每镜至少一句完整解说，约 10～50 字，须在本镜 duration 秒内能读完）。
- **shot_number 为 1 的第一个镜头**：必须有**开场解说**（交代时间、空间、氛围或悬念钩子），禁止以「纯建立镜头、无对白所以无旁白」为由留空；大远景/远景用旁白描述环境与基调，把观众带进故事。
- **第 2 个镜头**：若仍为远景/大远景/环境铺垫，同样必须写旁白；**禁止第 1、2 镜连续留空**。
- narration 为画外第三人称或纪录片式解说，与角色对白 dialogue 严格区分；对白只写在 dialogue，不要把对白原文复制进 narration。
- 每镜 1～3 句为宜；禁止连续多个镜头的 narration 为空。`;
}

/** 分镜用户提示词后缀：详细输出格式与要求
 * @param {object} cfg - 配置对象
 * @param {number|null} shotDuration - 单镜建议时长（秒），由后端从项目配置或总时长/数量推算后注入
 */
function getStoryboardUserPromptSuffix(cfg, shotDuration) {
  const lang = isEnglish(cfg) ? 'en' : 'zh';
  if (lang === 'en') {
    const durationInstruction = buildStoryboardDurationInstruction(lang, shotDuration);
    return `

**dialogue field**: "Character: \"line\"". Multiple: "A: \"...\" B: \"...\"". Monologue: "(Monologue) content". No dialogue: "".

**scene_id**: Select the most matching background ID from the scene list above, or null if none suitable.

**duration (seconds)**: ${durationInstruction}.

**Audio rule**: bgm_prompt MUST be an empty string or "No BGM". Do not design background music per shot. Put only diegetic ambience, foley, and voice/timbre details in sound_effect, so audio remains consistent across clips.

**Output**: JSON with "storyboards" array. Each item: shot_number, segment_index, segment_title, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters (array of IDs), props (array of prop IDs), is_primary. Return ONLY valid JSON, no markdown.`;
  }
  const _sbUserLocked = `\n\n【输出格式】请以JSON格式输出，包含 "storyboards" 数组。每个镜头包含：shot_number, segment_index, segment_title, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters（角色ID数组）, props（道具ID数组）, is_primary, **layout_description（画面布局与人物站位描述，必填，最高优先级空间合同）**。**必须只返回纯JSON，不要markdown。**`;
  const _sbUserOverride = _overrideCache['storyboard_user_suffix'];
  if (_sbUserOverride) {
    return '\n\n' + _sbUserOverride + _sbUserLocked;
  }
  const durationInstruction = buildStoryboardDurationInstruction(lang, shotDuration);
  return `

【分镜要素】每个分镜聚焦一个叙事节拍（可包含内部多切镜序列），描述要详尽具体：
1. **镜头标题(title)**：用3-5个字概括该镜头的核心内容或情绪
2. **时间**：[清晨/午后/深夜/具体时分+详细光线描述]
3. **地点**：[场景完整描述+空间布局+环境细节]
4. **镜头设计**：**景别(shot_type)**、**镜头角度(angle)**、**运镜方式(movement)**
5. **人物行为**：**详细动作描述**
6. **对话/独白**：提取该镜头中的完整对话或独白内容（如无对话则为空字符串）
7. **画面结果**：动作的即时后果+视觉细节+氛围变化
8. **环境氛围**：光线质感+色调+声音环境+整体氛围
9. **声音设计**：bgm_prompt 必须填空字符串""或"无背景音乐/禁BGM"；**不要为单个片段设计背景音乐**。sound_effect 只写现场环境声、动作音效、对白/旁白音色（如低沉、沙哑、颤抖、冷静、急促等）和口型同步要求
10. **观众情绪**：[情绪类型]（[强度：↑↑↑/↑↑/↑/→/↓]）

**【最高优先级空间合同 - layout_description（必填，最高优先级铁律）】**
这是本分镜的**核心空间锚点 + 真实物体尺度 + 运镜呼吸空间**铁律，用于首帧/尾帧图片生成时在保持一致性的同时，为运镜留出必要空间（尤其是 Seedance 1.5 Pro 等依赖首尾帧的模型）：

- 必须明确写出**主要角色在画面中的核心站位**（画面左/中/右三分、朝向、与关键道具的基本空间关系）。这是硬性锁定。
- **必须同时写出所有主要道具的真实物理尺度与相对比例**（仅描述本分镜/剧本中实际出现的道具，尺度须符合其所属时代与场景；例如古代场景写案几高度、书卷尺寸、铜器体量等，现代场景写对应家具与小物件真实尺寸；所有道具均为次要环境元素）。严禁任何会导致AI把道具做大、立起或当成主导元素的描述；**严禁写入与时代背景不符的道具**（古代/古装分镜不得出现智能手机、遥控器、现代茶几等现代物品）。
- 必须写明**整体构图方式和基本机位距离感**（中景、三分法等）。
- **必须为 declared movement（运镜方式）预留电影化演化空间**：明确说明首尾帧在核心站位和真实尺度保持一致的前提下，允许根据 movement 进行自然的取景微调（例如：缓推时尾帧可比首帧稍紧；手持时允许轻微取景晃动与不完美平衡；横摇/跟拍时允许画面左右自然的进入/退出变化）。目标是让首尾帧既像“同一场同一空间的连续镜头”，又能真正支持运镜产生动态视频，而不是变成几乎定格的画面。
- **严禁写入会导致比例失真或完全锁死运镜的表述**（即使剧本里有相关描述也禁止）："道具作为视觉焦点/占画面主导"、"手持晃动带来纪实感"、"完全相同的构图平衡"等。
- 好示例（古代场景，带运镜空间）："主角坐画面左中榻上，是绝对视觉焦点；右下前景木质案几高约75cm，书卷平放于案面为正常尺寸，铜灯与茶具均为次要环境小物件，绝不可夸大；中景，三分法构图，核心平衡稳定。若 movement 为缓推，尾帧允许人物在画面中占比自然增加、背景稍被压缩；若为手持，允许轻微取景不完美偏移。"
- **执行原则**：首帧按此锚点生成初始画面；尾帧必须保持核心站位、角色与道具的真实尺度与基本空间关系，仅根据 movement 和 result 进行自然的取景演化。违背核心锁定 = 失败；完全没有运镜演化空间也属于不合格结果。

**dialogue字段说明**：角色名："台词内容"。无对话时填空字符串""。
**scene_id**：从上方场景列表中选择最匹配的背景ID，如无合适背景则填null。
**duration时长**：${durationInstruction}。
**声音一致性**：所有镜头默认无BGM；若有对白/旁白，sound_effect 必须补充音色与情绪强度，并与动作节奏、环境声保持一致。

【输出格式】请以JSON格式输出，包含 "storyboards" 数组。每个镜头包含：shot_number, segment_index, segment_title, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters（角色ID数组）, props（道具ID数组）, is_primary。**必须只返回纯JSON，不要markdown。**`;
}

module.exports = {
  setOverrideCacheRef,
  getStoryboardSystemPrompt,
  getUniversalOmniMultiBeatFormatSpec,
  getStoryboardUniversalOmniModeSuffix,
  getStoryboardNarrationExtraInstructions,
  getStoryboardUserPromptSuffix,
};
