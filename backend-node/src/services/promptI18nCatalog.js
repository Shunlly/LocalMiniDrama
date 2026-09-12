/**
 * 提示词目录：用户侧模板、故事风格/类型标签、可覆盖默认正文与锁定后缀。
 * 本模块只提供静态目录与按 key 取值，不读取运行时配置，也不接触覆盖缓存。
 */

function buildUserPromptTemplates(style, imageRatio) {
  return {
    en: {
      character_request: 'Script content:\n%s\n\nPlease extract and organize detailed character profiles for ALL named characters from the script.',
      drama_info_template: `Title: %s\nSummary: %s\nGenre: %s\nStyle: ${style}\nImage ratio: ${imageRatio}`,
      script_content_label: '【Script Content】',
      task_label: '【Task】',
      character_list_label: '【Available Character List】',
      scene_list_label: '【Extracted Scene Backgrounds】',
      task_instruction: 'Break down the novel script into storyboard shots based on **independent action units**.',
      character_constraint: '**Important** — characters field rules:\n1. Only use character IDs (numbers) from the above character list. Do not invent IDs.\n2. Only include characters who **physically appear and act** in this specific shot. Do NOT list characters who are merely mentioned, offscreen, or appear in the overall scene but not in this shot.\n3. The number of characters listed must match who is described in the action/dialogue fields. If the action only describes one person, list only that one character.',
      scene_constraint: '**Important**: In the scene_id field, select the most matching background ID (number) from the above background list. If no suitable background exists, use null.',
      prop_list_label: '【Available Prop List】',
      prop_constraint: '**Important** — props field rules:\n1. Only use prop IDs (numbers) from the above prop list. Do not invent IDs.\n2. Only include props that are **visually present and actively used or prominently featured** in this specific shot.\n3. If no props from the list appear in the shot, use an empty array [].',
      frame_info: 'Shot information:\n%s\n\nPlease directly generate the image prompt for the first frame without any explanation:',
      key_frame_info: 'Shot information:\n%s\n\nPlease directly generate the image prompt for the key frame without any explanation:',
      last_frame_info: 'Shot information:\n%s\n\nPlease directly generate the image prompt for the last frame without any explanation:',
      shot_description_label: 'Shot description: %s',
      scene_label: 'Scene: %s, %s',
      characters_label: 'Characters: %s',
      action_label: 'Action: %s',
      result_label: 'Result: %s',
      dialogue_label: 'Dialogue: %s',
      atmosphere_label: 'Atmosphere: %s',
      shot_type_label: 'Shot type: %s',
      angle_label: 'Angle: %s',
      movement_label: 'Movement: %s',
      storyboard_count_constraint: '**Constraint**: Total shot count must be around %s (allow ±20%). Please merge or split actions to meet this requirement.',
      video_duration_constraint: '**Constraint**: Total video duration must be around %s seconds (allow ±10%). Please adjust shot count and duration to meet this requirement.',
    },
    zh: {
      character_request: '剧本内容：\n%s\n\n请提取剧本中所有有名字角色的设定。',
      drama_info_template: `剧名：%s\n简介：%s\n类型：%s\n风格: ${style}\n图片比例: ${imageRatio}`,
      script_content_label: '【剧本内容】',
      task_label: '【任务】',
      character_list_label: '【本剧可用角色列表】',
      scene_list_label: '【本剧已提取的场景背景列表】',
      task_instruction: '将小说剧本按**独立动作单元**拆解为分镜头方案。',
      character_constraint: '**重要** — characters字段填写规则：\n1. 只能使用上述角色列表中的角色ID（数字），不得自创ID。\n2. 只填写在**本镜头中实际出现并有具体行为**的角色。不要把"提到的"、"画面外的"、或整个场景里有但本镜头动作中未描述的角色也列进去。\n3. characters数量必须与action/dialogue中实际描写的人物数量一致。如果action只描述了一个人的动作，characters里就只填那一个人的ID。',
      scene_constraint: '**重要**：在scene_id字段中，必须从上述背景列表中选择最匹配的背景ID（数字）。如果没有合适的背景，则填null。',
      prop_list_label: '【本集可用道具列表】',
      prop_constraint: '**重要** — props字段填写规则：\n1. 只能使用上述道具列表中的道具ID（数字），不得自创ID。\n2. 只填写在**本镜头中视觉上出现并被使用或显著展示**的道具。\n3. 如果本镜头中没有列表中的道具出现，则填空数组[]。',
      frame_info: '镜头信息：\n%s\n\n请直接生成首帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：',
      key_frame_info: '镜头信息：\n%s\n\n请直接生成关键帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：',
      last_frame_info: '镜头信息：\n%s\n\n请直接生成尾帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：',
      shot_description_label: '镜头描述: %s',
      scene_label: '场景: %s, %s',
      characters_label: '角色: %s',
      action_label: '动作: %s',
      result_label: '结果: %s',
      dialogue_label: '对白: %s',
      atmosphere_label: '氛围: %s',
      shot_type_label: '景别: %s',
      angle_label: '角度: %s',
      movement_label: '运镜: %s',
      storyboard_count_constraint: '**重要约束**：总分镜数量必须控制在 %s 个左右（允许 ±20% 的偏差）。请务必合并或拆分动作以满足此数量要求。',
      video_duration_constraint: '**重要约束**：视频总时长必须控制在 %s 秒左右（允许 ±10% 的偏差）。请调整分镜数量和单镜时长以满足此要求。',
    },
  };
}

const STORY_STYLE_LABELS = {
  en: { modern: 'Modern', ancient: 'Period/Ancient', fantasy: 'Fantasy', daily: 'Slice of life' },
  zh: { modern: '现代', ancient: '古风', fantasy: '奇幻', daily: '日常' },
};
const STORY_TYPE_LABELS = {
  en: { drama: 'Drama', comedy: 'Comedy', adventure: 'Adventure' },
  zh: { drama: '剧情', comedy: '喜剧', adventure: '冒险' },
};

/**
 * 返回指定提示词 key 的可编辑默认正文（中文，不含动态锁定部分）。
 * promptOverrides.js 调用此函数，确保 UI 展示的内容与 promptI18n.js 始终一致。
 */
function getDefaultPromptBody(key) {
  switch (key) {
    case 'story_expansion_system':
      return '你是一位专业的编剧。你的任务是根据用户提供的故事梗概，创作 ${n} 集完整的短片剧本。\n\n要求：\n1. 用中文写作，叙事清晰流畅，适合后续拆分为分镜。\n2. 可以包含场景描述、角色动作与对话，但不要输出分镜格式、镜头编号或「内景/外景」等场次标记。\n3. 每集约 800 字。如有多集，剧情必须前后衔接——每集从上一集结尾处推进，确保整体故事连贯。\n4. 每集有清晰的起承转合，结尾留有悬念或转折，吸引观众看下一集。';

    case 'storyboard_system':
      return '【角色】你是一位资深影视分镜师，精通罗伯特·麦基的镜头拆解理论，擅长构建情绪节奏。\n\n【任务】将小说剧本按**独立动作单元**拆解为分镜头方案。\n\n【分镜拆解原则】\n1. **动作单元划分**：每个镜头必须对应一个完整且独立的动作\n   - 一个动作 = 一个镜头（角色站起来、走过去、说一句话、做一个反应表情等）\n   - 禁止合并多个动作（站起+走过去应拆分为2个镜头）\n\n2. **景别标准**（根据叙事需要选择）：\n   - 大远景：环境、氛围营造\n   - 远景：全身动作、空间关系\n   - 中景：交互对话、情感交流\n   - 近景：细节展示、情绪表达\n   - 特写：关键道具、强烈情绪\n\n3. **运镜要求**：\n   - 固定镜头：稳定聚焦于一个主体\n   - 推镜：接近主体，增强紧张感\n   - 拉镜：扩大视野，交代环境\n   - 摇镜：水平移动摄像机，空间转换\n   - 跟镜：跟随主体移动\n   - 移镜：摄像机与主体同向移动\n\n4. **情绪与强度标记**：\n   - emotion：简短描述（兴奋、悲伤、紧张、愉快等）\n   - emotion_intensity：用箭头表示情绪等级\n     * 极强 ↑↑↑ (3)：情绪高峰、高度紧张\n     * 强 ↑↑ (2)：情绪明显波动\n     * 中 ↑ (1)：情绪有所变化\n     * 平稳 → (0)：情绪不变\n     * 弱 ↓ (-1)：情绪回落\n\n【输出要求】\n1. 生成一个数组，每个元素是一个镜头，包含：\n   - shot_number：镜头号\n   - scene_description：场景（地点+时间，如"卧室内，早晨"）\n   - shot_type：景别（大远景/远景/中景/近景/特写）\n   - camera_angle：机位角度（平视/仰视/俯视/侧面/背面）\n   - camera_movement：运镜方式（static/推镜push/拉镜pull/横摇pan/纵摇tilt/跟镜tracking/升镜crane_up/降镜crane_dn/环绕orbit/手持handheld/变焦zoom/旋转roll/甩镜whip_pan/螺旋spiral/希区柯克hitchcock_zoom/子弹时间bullet_time/荷兰角dutch_angle_move/推轨复合dolly_track/升格环绕slowmo_orbit）——**强制动态优先，固定镜头不得超过20%**\n   - action：动作描述\n   - result：动作完成后的画面结果\n   - dialogue：角色对话或旁白（如有）\n   - emotion：当前情绪\n   - emotion_intensity：情绪强度等级（3/2/1/0/-1）';

    case 'character_extraction':
      return '你是一个专业的角色分析师，擅长从剧本中提取和分析角色信息。\n\n**【语言要求】所有字段的值必须使用中文，禁止出现英文内容（role字段的值除外，固定为 main/supporting/minor）。**\n\n你的任务是根据提供的剧本内容，提取并整理剧中出现的所有有名字角色的设定。\n\n要求：\n1. 提取所有有名字的角色（忽略无名路人或背景角色）\n2. 对每个角色，提取以下信息（全部用中文填写）：\n   - name: 角色名字（中文）\n   - role: 角色类型，固定值之一：main / supporting / minor\n   - appearance: 外貌描述（中文，100-200字，包含性别、年龄、体型、面部特征、发型、服装风格等，不含任何场景或环境信息）\n   - description: 背景故事和角色关系（中文，50-100字）\n3. 主要角色外貌要详细，次要角色可以简化';

    case 'scene_extraction':
      return '【任务】从剧本中提取所有唯一的场景背景\n\n【要求】\n1. 识别剧本中所有不同的场景（地点+时间组合）\n2. 为每个场景生成详细的**中文**图片生成提示词（Prompt）\n3. **重要**：场景描述必须是**纯背景**，不能包含人物、角色、动作等元素\n4. **重要**：prompt 字段必须为中文，不得使用英文（风格词如 realistic 可保留）';

    case 'prop_extraction':
      return '你是一位专业的剧本道具分析师，擅长从剧本中提取具有视觉特征的关键道具。\n\n你的任务是根据提供的剧本内容，提取并整理所有对剧情有重要作用或有特殊视觉特征的关键道具。\n\n要求：\n1. 只提取对剧情发展有重要作用、或有特殊视觉特征的关键道具。\n2. 普通的生活用品（如普通的杯子、笔）如果无特殊剧情意义不需要提取。\n3. 归属者、剧中人名等**只**写在 "description"，**不要**写进 "image_prompt"。\n4. "image_prompt" 按项目语言撰写（中文项目优先用中文），按「产品主图 / 资产白模照」标准撰写：只描述该道具本体（造型、材质、颜色、工艺与磨损），并强制纯色无缝棚拍背景、无场景无杂物。匹配项目中文提示词语音（融入真实尺度、次要元素原则）。\n5. "image_prompt" 须明确排除人物、手、家具、台面、其他物体与环境叙事元素。\n6. "image_prompt" **禁止**出现剧本人名、地名、组织名、台词、剧情专有词；用泛化视觉词替代，且**禁止无依据扩写**（不凭空加配饰、品牌叙事、煽情形容词）。';

    case 'storyboard_user_suffix':
      return '【分镜要素】每个分镜聚焦一个叙事节拍（可包含内部多切镜序列），描述要详尽具体：\n1. **镜头标题(title)**：用3-5个字概括该镜头的核心内容或情绪\n2. **时间**：[清晨/午后/深夜/具体时分+详细光线描述]\n3. **地点**：[场景完整描述+空间布局+环境细节]\n4. **镜头设计**：**景别(shot_type)**、**镜头角度(angle)**、**运镜方式(movement)**\n5. **人物行为**：**详细动作描述**\n6. **对话/独白**：提取该镜头中的完整对话或独白内容（如无对话则为空字符串）\n7. **画面结果**：动作的即时后果+视觉细节+氛围变化\n8. **环境氛围**：光线质感+色调+声音环境+整体氛围\n9. **声音设计**：bgm_prompt 必须填空字符串""或"无背景音乐/禁BGM"；不要为单个片段设计背景音乐。sound_effect 只写现场环境声、动作音效、对白/旁白音色与口型同步要求\n10. **观众情绪**：[情绪类型]（[强度：↑↑↑/↑↑/↑/→/↓]）\n\n**dialogue字段说明**：角色名："台词内容"。无对话时填空字符串""。\n**scene_id**：从上方场景列表中选择最匹配的背景ID，如无合适背景则填null。\n**duration时长**：综合对话、动作、情绪估算每镜时长（具体目标秒数由系统自动注入）。\n**声音一致性**：所有镜头默认无BGM；若有对白/旁白，sound_effect 须补充音色与情绪强度。';

    case 'first_frame_prompt':
      return '你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。\n\n重要：这是镜头的首帧 - 一个完全静态的画面，展示动作发生之前的初始状态。\n\n核心规则：\n1. 聚焦初始静态状态 - 动作发生之前的那一瞬间，禁止包含任何动作或运动描述\n2. 描述角色在画面中的位置（画面左/中/右）、朝向（面向/背对/侧面）、初始姿态和表情\n3. 如提供了角色外貌信息，必须将其融入提示词（仅使用固定身份特征：脸型、五官、发型、肤质、标记等，严禁添加或推断任何服装、衣着、服饰描述，服装由参考图决定）\n\n【电影语言规范（必须应用）】\n\n构图规则（根据景别选择）：\n- 三分法：主体置于三分线交点，稳定平衡，适合大多数叙事镜头\n- 框架构图：用门窗/树枝/栏杆形成自然画框，突出主体，增加纵深\n- 中心构图：对称庄重，适合特写和仪式感场景\n- 前景遮挡：前景虚化元素增加层次感\n\n光线设计（必须描述）：\n- 光源方向：左侧光/右侧光/顶光/逆光（轮廓光）/底光\n- 光线质感：硬光（强烈阴影，戏剧张力）/ 柔光（柔和过渡，自然温馨）\n- 色温：暖光（金黄/橙红，温暖怀旧）/ 冷光（蓝调/青白，冷漠疏离）\n\n景深设置：\n- 特写/近景：浅景深，背景虚化，突出人物情绪\n- 中景：中等景深，人物与环境均清晰\n- 远景/全景：深景深，前后均清晰，交代空间关系';

    case 'key_frame_prompt':
      return '你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。\n\n重要：这是镜头的关键帧 - 捕捉动作最激烈、情绪最饱满的高潮瞬间。\n\n核心规则：\n1. 聚焦动作高潮时刻，最大化戏剧张力\n2. 捕捉情绪顶点，角色表情和肢体语言处于最强烈状态\n3. 可包含动态效果（动作模糊、视觉冲击感）\n4. 如提供了角色外貌信息，必须将其融入提示词（仅使用固定身份特征：脸型、五官、发型、肤质、标记等，严禁添加或推断任何服装、衣着、服饰描述，服装由参考图决定）\n5. 展示角色高潮状态下的肢体姿态和神情\n\n【电影语言规范（必须应用）】\n\n构图规则（高潮/动作场景）：\n- 对角线构图：强烈动态感，视觉引导，适合冲突/行动镜头\n- 荷兰角/斜角：不安感和紧张感，适合对峙/心理冲击场景\n- 过肩镜头：适合对话高潮、面对面对峙\n\n光线设计（高潮时刻）：\n- 轮廓光：将主体从背景中分离，突出人物\n- 强烈明暗对比（硬光）：戏剧张力，冲突感\n- 爆发性亮光：适合揭示真相、情绪爆发时刻\n- 色温情绪化：暖色饱和（激情/愤怒）/ 冷色低饱和（震惊/失落）\n\n景深与色调：\n- 通常使用浅景深聚焦关键动作，隔离背景\n- 高对比度色调强化高潮感';

    case 'last_frame_prompt':
      return '你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。\n\n重要：这是镜头的尾帧 - 一个静态画面，展示动作结束后的最终状态和结果。\n\n核心规则：\n1. 聚焦动作完成后的最终静态状态\n2. 展示动作的可见结果和后果\n3. 描述角色在动作完成后的最终姿态、位置和情绪表情\n4. 强调情绪余韵：释然/平静/悲伤/胜利/遗憾\n5. 如提供了角色外貌信息，必须将其融入提示词（仅使用固定身份特征：脸型、五官、发型、肤质、标记等，严禁添加或推断任何服装、衣着、服饰描述，服装由参考图决定）\n\n【电影语言规范（必须应用）】\n\n构图规则（收尾镜头）：\n- 通常用较宽的景别重建空间背景，或用紧镜头聚焦情绪收场\n- 留白构图：大面积空旷空间传递孤独/结束感\n- 呼应开场构图：收尾镜头可与首帧构图呼应，形成闭环\n\n光线设计（情绪余韵）：\n- 柔和暖光：事件解决后的温情/宽慰\n- 残留戏剧阴影：未解决的张力，悬念延续\n- 渐弱光线/冷调：失去/结束/遗憾的情绪\n- 色调整体偏暗或偏亮反映情绪归宿\n\n景深与氛围：\n- 情绪收场：浅景深，聚焦面部情绪细节\n- 结果展示：深景深，展示行动对环境/他人的影响';

    default:
      return '';
  }
}

/**
 * 返回指定提示词 key 的锁定后缀（供 UI 展示，动态字段用占位符替代）。
 */
function getLockedSuffix(key) {
  switch (key) {
    case 'story_expansion_system':
      return null;
    case 'storyboard_system':
      return '\n\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n\n【重要提示】\n- 镜头数量必须与剧本中的独立动作数量匹配（不允许合并或减少）\n- 每个镜头必须有明确的动作和结果\n- 景别选择必须符合叙事节奏（不要连续使用同一景别）\n- 情绪强度必须准确反映剧本氛围变化\n- 【角色一致性】每个镜头的characters列表必须与该镜头action/dialogue中实际描写的人物严格一致，不得把（在场景中存在但本镜头动作未涉及）的角色列入';
    case 'character_extraction':
      return '\n- **风格要求**：[当前剧集风格]\n- **图片比例**：[当前比例]\n输出格式：\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个元素是一个角色对象，包含上述字段。';
    case 'scene_extraction':
      return '\n5. **风格要求**：[当前剧集风格]\n   - **图片比例**：[当前比例]\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块。直接以 [ 开头，以 ] 结尾。**\n每个元素包含：location（地点）, time（时间）, prompt（完整的中文图片生成提示词，纯背景，明确说明无人物）。';
    case 'prop_extraction':
      return '\n- **风格要求**：[当前道具风格]\n- **图片比例**：[当前比例]\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个对象包含：\n- name: 道具名称\n- type: 类型 (如：武器/关键证物/日常用品/特殊装置)\n- description: 在剧中的作用和中文外观描述（人名归属可写此处，勿写入 image_prompt）\n- image_prompt: 单道具主图提示词（纯色底、仅主体；无剧本人名地名等；简练、不扩写；中文项目用中文并匹配项目语音与真实尺度铁律）';
    case 'storyboard_user_suffix':
      return '\n\n【输出格式】请以JSON格式输出，包含 "storyboards" 数组。每个镜头包含：shot_number, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters, is_primary。**必须只返回纯JSON，不要markdown。**';
    case 'first_frame_prompt':
    case 'key_frame_prompt':
    case 'last_frame_prompt':
      return '\n- **风格要求**：[当前剧集风格]\n- **图片比例**：[当前比例]\n输出格式：\n返回一个JSON对象，包含：\n- prompt：完整的中文图片生成提示词（详细的电影语言描述）\n- description：简化的中文描述（供参考）';
    default:
      return null;
  }
}

module.exports = {
  buildUserPromptTemplates,
  STORY_STYLE_LABELS,
  STORY_TYPE_LABELS,
  getDefaultPromptBody,
  getLockedSuffix,
};
