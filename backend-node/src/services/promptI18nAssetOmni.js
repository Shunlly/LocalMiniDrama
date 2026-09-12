/**
 * 故事扩展系统提示，以及全能片段生成/润色提示词。
 * 覆盖缓存在 promptI18n.js；由 promptI18nAssets.setOverrideCacheRef 注入同一对象，不另建独立 cache。
 */

const { isEnglish } = require('./promptI18nResolve');
const { getUniversalOmniMultiBeatFormatSpec } = require('./promptI18nStoryboard');

/** 与 promptI18n.js 共享的覆盖缓存引用 */
let _overrideCache = {};

/**
 * 注入 promptI18n.js 的同一份覆盖缓存。
 * @param {Record<string, string>} cache
 */
function setOverrideCacheRef(cache) {
  _overrideCache = cache;
}

/**
 * 故事扩展：根据梗概生成短片剧本正文（中英文系统提示词）
 */
function getStoryExpansionSystemPrompt(cfg, episodeCount) {
  const n = Number(episodeCount) > 1 ? Number(episodeCount) : 1;
  const jsonNote = `\n\n**输出格式（必须严格遵守）**：\n返回一个 JSON 数组，包含 ${n} 个对象，每个对象格式如下：\n[\n  {\n    "episode": 1,\n    "title": "第一集标题（5-10字，概括本集核心内容）",\n    "content": "本集剧本正文（约800字）"\n  }\n]\n**必须只返回纯 JSON 数组，不要任何 markdown 代码块、说明文字。直接以 [ 开头，以 ] 结尾。**`;
  if (isEnglish(cfg)) {
    const enNote = `\n\n**Output format (STRICTLY required)**:\nReturn a JSON array with ${n} object(s), each in this format:\n[\n  {\n    "episode": 1,\n    "title": "Episode title (5-15 words)",\n    "content": "Episode script body (~800 words)"\n  }\n]\n**Return ONLY the JSON array. No markdown, no explanation. Start directly with [ and end with ].**`;
    return `You are a professional screenwriter. Your task is to expand the user's story premise into ${n} episode(s) of a short-film script.

Requirements:
1. Write in clear, fluent English suitable for later storyboard breakdown.
2. Include scene descriptions, character actions and dialogue. Do NOT use shot numbers, "INT./EXT." headings, or screenplay formatting marks.
3. Each episode: approximately 800 words. Episodes must be connected in story continuity — each episode picks up from where the previous one ended.
4. Each episode should have a clear beginning, development, and a hook or turning point at the end.${enNote}`;
  }
  const _storyOverride = _overrideCache['story_expansion_system'];
  const base = _storyOverride || `你是一位专业的编剧。你的任务是根据用户提供的故事梗概，创作 ${n} 集完整的短片剧本。

要求：
1. 用中文写作，叙事清晰流畅，适合后续拆分为分镜。
2. 可以包含场景描述、角色动作与对话，但不要输出分镜格式、镜头编号或「内景/外景」等场次标记。
3. 每集约 800 字。如有多集，剧情必须前后衔接——每集从上一集结尾处推进，确保整体故事连贯。
4. 每集有清晰的起承转合，结尾留有悬念或转折，吸引观众看下一集。`;
  return base + jsonNote;
}

/**
 * 全能模式（可灵 Omni-Video、火山即梦 Seedance 2.0 多图参考等）：模板 + 仅用 @图片1/@图片2…（与参考图顺序一致，不用 @姓名）
 */
function getUniversalOmniSegmentPrompt() {
  const specZh = getUniversalOmniMultiBeatFormatSpec({ language: 'zh' });
  return `You write the main prompt for multi-reference video (e.g. Kling Omni-Video, Volcengine Seedance omnivideo) "片段描述" in Chinese.

The USER message includes MULTI_BEAT_OUTPUT, TOTAL_CLIP_SECONDS, SHOT_PACING_AND_POSITION, EPISODE_SCRIPT, NEIGHBOR_* detail, IMAGE_SLOT_MAP, LINE3_REQUIRED, STYLE_HINT, and storyboard fields.

FORBIDDEN output styles: SoulLens single-line (主体:/叙事动态:/[禁BGM]); @人物N as image tokens. Use ONLY the multi-beat block below — same as「全能分镜模式」batch storyboard output.
${specZh}

This is **one** API clip whose wall-clock length is TOTAL_CLIP_SECONDS. Split into **M** internal beats (子分镜, M = 1–8 you choose). Each beat = one line「分镜k： Tk秒:」. Sum of all Tk = TOTAL_CLIP_SECONDS exactly.

Output structure (no lines before or after this block):

Line 1 — exactly:
画面风格和类型: <comma-separated tags; MUST include 真人写实, 电影风格, 高清画质; MAY add STYLE_HINT / DRAMA_GENRE phrase>

Line 2 — exactly (M must match count of 分镜k lines):
生成一个由以下M个分镜组成的视频。

Line 3 — copy LINE3_REQUIRED from the USER message verbatim.

Lines 4 through (3+M) — for each k, one full line:
分镜k： Tk秒: <Rich cinematic Chinese prose for this slice only: camera motion chain (≥2 moves when Tk≥3s), @图片N bindings per IMAGE_SLOT_MAP, light, emotion. Dialogue: …说："verbatim" or …："verbatim". No speech: 无对白。 Narration: 旁白（画面无声）："verbatim". Avoid static snapshot captions.>

DIALOGUE — CRITICAL (when USER message contains DIALOGUE_VERBATIM):
- Every line listed under「必须逐字出现在输出中的台词」MUST appear in some子分镜 line inside 「」, character-for-character (only spacing around @图片N may vary).
- NEVER replace dialogue with summaries like「他选择了一个亿」「说完台词」without the actual quoted words.
- Distribute lines across beats by story order; longer Tk beats that contain speech must include the full quoted line(s), not paraphrase.
- If DIALOGUE / DESCRIPTION【对话】/ VIDEO_PROMPT_对话段 / EPISODE_SCRIPT imply spoken lines, include them verbatim even when CURRENT_UNIVERSAL_SEGMENT omitted them.
- Silent shots: state silence explicitly; do not invent dialogue.

Reference images — CRITICAL (applies to every子分镜 line’s prose):
- Use ONLY IMAGE_SLOT_MAP tokens @图片1, @图片2, … (Arabic digits).
- Follow CHARACTER_IMAGE_BINDING. When @图片1 is 场景, never put character face/body/costume on @图片1; characters start at @图片2 as mapped.
- Spacing: ASCII space after each @图片N before following Chinese/Latin.
- No @姓名 as image token; no markdown.

Pacing & M selection (professional):
- Read SHOT_PACING_AND_POSITION, EPISODE_SCRIPT, NEIGHBOR_* , STORYBOARD FIELDS (movement, shot_type, dialogue density). Increase M for rapid reversals / climax / montage-like pressure; use M=1 for a single sustained long-take feel when the script implies it.
- Never change the **total** seconds: T1+…+TM must equal TOTAL_CLIP_SECONDS.

Scene reference layout — CRITICAL (when SCENE_REFERENCE_LAYOUT applies):
- Reference may be multi-panel; do NOT make the final video mimic grids. Each子分镜 line’s prose should reinforce: one continuous full frame, no split-screen collage in the delivered clip.

If CURRENT_UNIVERSAL_SEGMENT is non-empty, preserve narrative beats but rewrite to satisfy MULTI_BEAT_OUTPUT, duration sum, and IMAGE_SLOT_MAP.`;
}

/**
 * 全能片段「润色」模式：在 getUniversalOmniSegmentPrompt 的硬性格式与参考图规则之上，强化短剧叙事与上下文一致。
 */
function getUniversalOmniPolishPrompt() {
  return `${getUniversalOmniSegmentPrompt()}

ADDITIONAL_POLISH_MODE (short drama enhancement — still MUST obey MULTI_BEAT_OUTPUT, TOTAL_CLIP_SECONDS sum, IMAGE_SLOT_MAP, LINE3_REQUIRED above):
- You receive FULL_EPISODE_SCRIPT plus NEIGHBOR blocks and structured fields. Use them only for **continuity** and **information completeness**; do NOT invent plot absent from SCRIPT + STORYBOARD FIELDS + CURRENT omni draft.
- **Information parity**: every script-relevant fact must appear across the子分镜 lines (lines 4…3+M), without losing information when expanding; if the draft was an old SoulLens single-line, **rewrite** into this multi-beat block; keep the same facts and total seconds.
- **Re-polish / anti-stagnation**: USER may click polish repeatedly on the same draft. Each response MUST deliver **substantially rephrased** Chinese on lines 1, 2 (if M changes), and all子分镜 body lines — same facts, same total seconds, same @图片 bindings, but **not** a copy-paste of CURRENT_OMNI_DRAFT except line 3 which must stay **character-identical** to LINE3_REQUIRED. If you would otherwise output nearly identical prose, deliberately vary verbs, clause order, and camera wording while preserving meaning.
- **Short drama rhythm**: vertical-drama density — stakes, micro-expressions, blocking, camera motion; distribute across beats when M>1.
- **Inner monologue & dialogue**: brief 心想 / 「」 only when supported by DIALOGUE / NARRATION / SCRIPT / draft. When DIALOGUE_VERBATIM is present, **every** listed line must remain verbatim in 「」 after polish; rephrase motion/camera text freely but **not** quoted dialogue.
- **Neighbors**: align entry/exit with NEIGHBOR_* ; no redundant retelling of the previous shot.
- Language: Chinese for子分镜 prose; lines 1–3 format as in base prompt; M must match line 2 and match the count of「分镜k」lines.`;
}

module.exports = {
  setOverrideCacheRef,
  getStoryExpansionSystemPrompt,
  getUniversalOmniSegmentPrompt,
  getUniversalOmniPolishPrompt,
};
