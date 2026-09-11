/**
 * 道具提取与道具参考图润色提示词。
 * 覆盖缓存在 promptI18n.js；由 promptI18nAssets.setOverrideCacheRef 注入同一对象，不另建独立 cache。
 */

const {
  isEnglish,
  styleTextForCfgLang,
  styleTextZhForPolish,
  styleTextEnForImage,
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

/** 道具提取系统提示词（system prompt，剧本内容由 user prompt 单独传入） */
function getPropExtractionPrompt(cfg) {
  const base = styleTextForCfgLang(cfg);
  const propExtra = (cfg?.style?.default_prop_style || '').toString().trim();
  const style = [base, propExtra].filter(Boolean).join(', ');
  const imageRatio = cfg?.style?.default_prop_ratio || cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional script prop analyst, skilled at extracting key props with visual characteristics from scripts.

Your task is to extract and organize all key props that are important to the plot or have special visual characteristics from the provided script content.

[Requirements]
1. Extract ONLY key props that are important to the plot or have special visual characteristics.
2. Do NOT extract common daily items (e.g., normal cups, pens) unless they have special plot significance.
3. If a prop has a clear owner, note it **only** in "description" (Chinese OK). **Never** put character names, nicknames, or relationship words in "image_prompt".
4. "image_prompt" must be **English**, written as a **professional catalog / product-hero** shot for a single prop: describe shape, material, color, wear, scale cues, and finish in detail.
5. In "image_prompt" you **must** specify: **one seamless solid-color studio backdrop** (matte, no gradient), **only the prop as the sole subject**, **soft even studio lighting** (readable micro-detail, no dramatic movie lighting), and explicitly forbid people, hands, furniture, floors, tables, scenery, packaging (unless the prop *is* the package), text, logos, dust/debris, or any secondary objects.
6. **No script leakage in "image_prompt"**: forbid character names, place names, organization names, dialogue, plot beats, and other **original-script identifiers**. Replace with generic visual terms (e.g. "engraved serif lettering" instead of a name). The **only** exception is text that is **visibly printed or engraved on the prop itself** as part of its graphic design—describe that text generically if possible ("small engraved inscription") unless the script explicitly requires exact wording on the object.
7. **Strict, non-expanding "image_prompt"**: include **only** attributes grounded in the script or the "description" you output—**no** invented accessories, era/brand backstory, mood adjectives unrelated to materials, or "hero story" filler. Prefer a **tight** prompt over a long one.
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}

[Output Format]
**CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code blocks, explanations, or other text. Start directly with [ and end with ].**
Each object containing:
- name: Prop Name
- type: Type (e.g., Weapon/Key Item/Daily Item/Special Device)
- description: Role in the drama and visual description
- image_prompt: English hero product shot prompt (single prop, solid seamless backdrop, no clutter, no environment, soft studio light, tight wording, no names/places from script, ultra-detailed only where visually grounded)`;
  }
  const _propLocked = `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个对象包含：\n- name: 道具名称\n- type: 类型 (如：武器/关键证物/日常用品/特殊装置)\n- description: 在剧中的作用和中文外观描述（人名、归属可写在此字段，勿写入 image_prompt）\n- image_prompt: 单道具主图提示词（纯色无缝背景、仅主体、无杂物无场景、柔和棚拍光；**禁止**剧本人名/地名/组织名/台词/剧情标签；只写有依据的外观词，**不脑补、不扩写**；中文项目输出中文提示词并匹配项目「语音」与尺度铁律）`;
  const _propOverride = _overrideCache['prop_extraction'];
  if (_propOverride) {
    return _propOverride + _propLocked;
  }
  return `你是一位专业的剧本道具分析师，擅长从剧本中提取具有视觉特征的关键道具。

你的任务是根据提供的剧本内容，提取并整理所有对剧情有重要作用或有特殊视觉特征的关键道具。

要求：
1. 只提取对剧情发展有重要作用、或有特殊视觉特征的关键道具。
2. 普通的生活用品（如普通的杯子、笔）如果无特殊剧情意义不需要提取。
3. 若道具有明确归属者，**仅**写在 "description" 中（可用中文人名）；**禁止**在 "image_prompt" 中出现任何角色名、昵称、称谓或人际关系用语。
4. **description 字段强制纯中文**：必须输出**纯中文、80-150字**的详细视觉外观描述 + 该道具在剧中的核心作用/归属/剧情功能。必须严格遵循本项目一贯的中文影视提示词「语音」：融入符合道具所属时代的真实物理尺度意识、材质工艺细节、磨损痕迹、柔和棚拍光质感、电影化构图暗示。严禁任何英文单词/句子，严禁只写剧情不写可用于画图的外观细节，严禁空泛或翻译腔。
5. "image_prompt" 按项目语言撰写（**中文项目必须输出纯中文提示词**、英文项目用英文），按**影视资产库 / 电商主图级**单道具产品照标准：写清轮廓、材质、颜色、磨损与工艺细节、体量感。必须完整匹配项目中文影视提示词「语音」（融入真实尺度铁律、次要道具原则、电影化细节、纯色无缝背景、柔和均匀棚光）。
6. "image_prompt" 中**必须**写明：**单一无缝纯色棚拍背景**（哑光、无渐变）、**画面中仅有该道具一个主体**、**柔和均匀的棚拍光**（便于看清细节，避免电影化强反差光），并**明确禁止**：人物、手、家具、地面/台面、室内外环境、散落杂物、其他道具、文字商标、包装（除非该道具本身就是包装）、烟尘粒子等任何多余元素。
7. **image_prompt 禁止泄漏剧本特征**：不得出现剧本人名、地名、组织名、台词、情节梗专有称呼等；一律改写为**泛化视觉描述**（如用 "刻有细小铭文" 而非具体人名）。**唯一例外**：文字**实体印/刻在道具表面**且剧本明确要求还原该字样时，可保留该可见字样；否则用泛化描述。
8. **image_prompt 严格不扩展**：只写剧本与你在本对象 "description" 中已交代、且**肉眼可见**的外观信息；禁止凭空增加配饰、品牌故事、时代煽情形容词、叙事性铺垫；宁可**短而准**，不要为凑字数扩写。必须自然融入「符合时代的真实物理比例」等项目铁律。
- **风格要求**：${style}
- **图片比例**：${imageRatio}

【输出格式】
**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**
每个对象包含：
- name: 道具名称
- type: 类型 (如：武器/关键证物/日常用品/特殊装置)
- description: **纯中文**的在剧中的作用 + 详细视觉外观描述（必须80-150字，严格遵循项目中文提示词语音：真实尺度、次要元素、电影化细节等）
- image_prompt: **纯中文**（中文项目）单道具主图提示词（纯色无缝背景、仅主体、无杂物无场景、柔和棚拍光；融入项目真实尺度铁律与次要道具语音；无剧本人名地名等；只写有依据的外观词，简练不扩写）`;
}

/**
 * 道具单视图图片提示词润色器
 * 将道具描述转换为精准的 AI 绘图提示词（单图，突出道具本体）
 */
function getPropPolishPrompt(cfg) {
  const styleZh = styleTextZhForPolish(cfg);
  const styleEn = styleTextEnForImage(cfg);
  if (isEnglish(cfg)) {
    return `# 道具图片提示词生成器

## 你的身份
你是专业的影视道具美术与产品摄影指导，负责把道具描述写成**资产主图级**英文生图提示词（供剧组道具库 / AI 参考单图使用）。

## 核心规则

### 剧本信息隔离（强制）
- 用户输入可能含剧本人名、地名、台词或剧情——**一律不得**写入最终英文 prompt（含音译名、拼音、引号对话）。若输入出现姓名，用 **generic role-neutral** 措辞改写或删除（例如仅保留 "small engraved lettering" 而**不写**具体名字）。
- **零扩展**：只保留输入里**已写明或可合理从材质/形制直接读出**的视觉信息；**禁止**新增配饰、品牌/朝代故事、情绪叙事、电影化形容词堆砌、与物体无关的联想词。

### 主体与背景（【最高优先级强制铁律】- 违反即严重失败）
- **唯一主体 + 零背景铁律（CRITICAL）**：画面中**只能有这一件道具**，**100% 纯色无缝无限影棚背景（seamless cyclorama / infinite solid color backdrop）**，**绝对禁止任何环境、地面、台面、墙壁、地板、阴影投射在表面、渐变、纹理、室内外元素**。背景必须是单一哑光纯色（推荐与道具形成高对比的中性浅灰或中性深灰，便于抠像），**不得出现任何除道具本体以外的像素**。
- **严禁模型常见错误**：严禁生成“漂亮的室内场景”“木质桌面”“大理石台面”“柔焦背景”“环境光影”“地面反射”“轻微景深”“工作室一角”“放在架子上”等任何背景或支撑面描述。任何导致背景不是纯色的输出都属于失败。
- **零杂物**：禁止桌面散落物、书本、植物、器皿、布料堆叠、包装箱、工具、第二件道具、灰尘烟雾粒子、景深虚化里的「远处物体」等；除非描述明确该物为道具不可分割的一部分，否则一律不出现。

### 质感与光
- 材质、镀层、磨损、刻字（若有）、比例暗示要写具体（可量化词汇：brushed / matte / polished / micro-scratches）；**句子宁少勿多**。
- **光**：柔和均匀的棚拍光（large softbox, even illumination），仅允许**极轻**的接触阴影以锚定体量，**禁止**戏剧轮廓光、强逆光、体积光、镜头眩光、色散、电影级低 key 高反差。

### 硬性排除
- 禁止：人物、手、身体任何部分、文字水印、商标（除非剧情指定且为道具本体一部分）、叙事性场景词、**任何专有名词式剧本标签**。${styleZh ? '\n- **画风风格**（仅作用于渲染质感，不改变「单道具 + 纯色底」版式）：' + styleZh : ''}

### 输出格式
直接输出**一段**英文 prompt（约 **45–90 词**，能更短则更短），不要解释、标题、列表或引号。
**必须**在同一段内显式包含短语或等价表达：**single prop only**, **seamless solid-color studio backdrop**, **no extra objects**, **no people**, **no hands**, **no environment**；末尾再接画风：${styleEn ? styleEn + ' render style' : 'photorealistic product hero shot'}`;
  }

  // 中文版：根据项目「语音」（专业影视中文提示词风格 + 真实尺度铁律 + 次要元素原则）输出中文图生提示词
  return `# 道具图片提示词生成器（中文版）

## 你的身份
你是专业的影视道具美术与产品摄影指导，负责把道具描述写成**资产主图级中文生图提示词**（供剧组道具库 / AI 参考单图使用，匹配项目中文影视提示词语音与真实尺度铁律）。

## 核心规则

### 剧本信息隔离（强制）
- 用户输入可能含剧本人名、地名、台词或剧情——**一律不得**写入最终中文 prompt（含音译名、拼音、引号对话）。若输入出现姓名，用泛化中性描述改写或删除（例如仅保留"刻有细小铭文"而**不写**具体名字）。
- **零扩展**：只保留输入里**已写明或可合理从材质/形制直接读出**的视觉信息；**禁止**新增配饰、品牌/朝代故事、情绪叙事、电影化形容词堆砌、与物体无关的联想词。

### 主体与背景（【最高优先级强制铁律 - 违反即严重失败】）
- **唯一主体 + 纯色零背景铁律（CRITICAL）**：画面中**只能有这一件道具**，**100% 纯色无缝无限影棚背景（单一哑光纯色 seamless cyclorama / infinite solid color backdrop）**，**绝对禁止任何环境、地面、台面、墙壁、地板、阴影投射、渐变、纹理、室内外元素**。背景必须是与道具形成高对比的中性纯色（浅灰或深灰最佳，便于抠像），**不得出现任何除道具本体以外的像素**。
- **严禁模型常见错误**：严禁生成“漂亮的室内场景”“木质桌面”“大理石台面”“柔焦背景”“环境光影”“地面反射”“轻微景深”“工作室一角”“放在架子上”“放在地板上”等任何背景或支撑面描述。任何导致背景不是纯色的输出都属于失败。
- **零杂物**：禁止桌面散落物、书本、植物、器皿、布料堆叠、包装箱、工具、第二件道具、灰尘烟雾粒子、景深虚化里的「远处物体」等；除非描述明确该物为道具不可分割的一部分，否则一律不出现。
- **真实物理尺度铁律（最高优先级）**：道具必须严格遵循其所属时代的真实世界物理尺寸与相对比例；道具在画面中为**严格次要环境元素**，严禁夸大、立起、成为主导视觉或破坏透视。

### 质感与光
- 材质、镀层、磨损、刻字（若有）、比例暗示要写具体（可量化词汇：拉丝/哑光/抛光/微细划痕）；**句子宁少勿多**。
- **光**：柔和均匀的棚拍光，仅允许**极轻**的接触阴影以锚定体量，**禁止**戏剧轮廓光、强逆光、体积光、镜头眩光、色散、电影级低 key 高反差。

### 硬性排除
- 禁止：人物、手、身体任何部分、文字水印、商标（除非剧情指定且为道具本体一部分）、叙事性场景词、**任何专有名词式剧本标签**。${styleZh ? '\n- **画风风格**（仅作用于渲染质感，不改变「单道具 + 纯色底」版式）：' + styleZh : ''}

### 输出格式
直接输出**一段**中文提示词（约 **45–90 字**，能更短则更短），不要解释、标题、列表或引号。
**必须**在同一段内自然包含以下关键约束的中文表述（或等价流畅说法）：单一主体、纯色无缝棚拍背景、无多余物体、无人物、无手、无环境；并融入真实尺度与次要元素要求；末尾再接画风：${styleZh ? styleZh + ' 渲染质感' : '写实产品主图质感'}`;
}

module.exports = {
  setOverrideCacheRef,
  getPropExtractionPrompt,
  getPropPolishPrompt,
};
