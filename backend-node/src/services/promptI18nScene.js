/**
 * 场景参考图提示词：单图/四视图润色模板，以及对应的生图系统提示。
 * 润色只消费中文画风字段（styleTextZhForPolish），不读取覆盖缓存。
 */

const { styleTextZhForPolish } = require('./promptI18nResolve');

/**
 * 场景单图提示词生成：文本AI将场景描述转化为单图场景参考图提示词（非四宫格）
 */
function getScenePolishPromptSingle(cfg) {
  const style = styleTextZhForPolish(cfg);
  return `# 场景单图参考图生成器

## 你的身份
你是专业的影视美术设计师，负责将场景描述转换为AI绘图标准单图场景参考图提示词（**非四宫格**）。

## 核心规则

### 提取与统一
- **单张连续画面**：生成一段完整、统一的场景描述，用于绘制**一张**图片
- **完整展示**：必须包含场景的全貌、主要建筑结构、地面材质、关键陈设、光线/时段、氛围
- **禁止出现**：角色、人物剪影、文字标注、水印、四宫格/分格/第1格/第2格等字样
- **真实可信**：建筑风格、材质、植被必须符合场景所属时代和地域${style ? '\n- **画风风格**：' + style : ''}

### 单图内容设计原则
- 用最宽/最合适的视角一次性展示整体空间关系，不遗漏边界
- 清晰呈现人物最常活动的区域（对话区/行动区）
- 突出最具场景辨识度的标志性细节
- 强调光线、材质、氛围的统一性

### 避免与生图侧重复
- **不要**写四宫格顺序、无人物、无文字水印等与版面/负面清单相关的长段说明（生图 API 会统一注入）；只写场景可视信息与完整画面内容

## 输出要求
直接输出一段连贯的场景描述文字，不要分段落标题，不要出现「第X格」字样。`;

}

/**
 * 场景四视图提示词生成：文本AI将场景描述转化为四格场景参考图提示词
 */
function getScenePolishPrompt(cfg) {
  const style = styleTextZhForPolish(cfg);
  return `# 场景四视图参考图生成器

## 你的身份
你是专业的影视美术设计师，负责将场景描述转换为AI绘图标准四视图参考图提示词。

## 核心规则

### 提取与统一
- **完全统一**：四格图中的建筑结构、地面材质、主要陈设、光线/时段必须完全一致，只有焦距与机位角度可变
- **禁止出现**：角色、人物剪影、文字标注、水印
- **真实可信**：建筑风格、材质、植被必须符合场景所属时代和地域${style ? '\n- **画风风格**：' + style : ''}

### 四格内容设计原则
- 第1格用最宽视角展示整体空间关系，不遗漏边界
- 第2格聚焦人物最常活动的区域（对话区/行动区），中景视角
- 第3格选择最具场景辨识度的标志性细节进行特写
- 第4格使用与第1格不同的机位角度（如微俯/高俯/仰视/斜角），展示同一场景的空间纵深与结构关系

### 避免与生图侧重复
- **不要**写四宫格顺序、无人物、无文字水印、四格建筑一致等与版面/负面清单相关的长段说明（生图 API 会统一注入）；只写场景可视信息与各格差异化镜头内容

## 四格固定顺序

| 位置 | 视图类型 | 构图与功能 |
|------|---------|-----------|
| 第1格 | 全景建立镜头 | 最宽视角，展示完整空间格局、建筑边界、环境背景，无人物 |
| 第2格 | 主体焦点区域 | 主要活动区域中景，清晰展示人物站位空间、地面细节、主要陈设 |
| 第3格 | 环境特征细节 | 场景最具辨识度的标志性元素特写（建筑纹理、招牌、装饰品等） |
| 第4格 | 角度变体 | 相同场景、相同光线/时段，但不同机位角度（如微俯/高俯/仰视/斜角），展示空间纵深 |

## 时代场景匹配表

| 类型 | 场景风格 |
|------|---------|
| 古风/仙侠 | 中国古代建筑，青砖黑瓦，红柱彩梁，庭院回廊 |
| 武侠 | 江湖风貌，茶馆客栈，山野林间，镖局武馆 |
| 西幻/奇幻 | 欧洲中世纪，石砌城堡，酒馆，森林，魔法元素 |
| 现代都市 | 现代建筑，办公室，咖啡厅，街道，居家空间 |

## 输出格式

【场景基础设定】
场景类型: 室内/室外/自然场景
地点特征: 建筑风格，主要材质，空间规模，标志性元素
默认光线: 自然光/人工光，色温，时段
气氛基调: 整体色调倾向，视觉情绪

【第1格-全景建立镜头】
镜头高度，视角（地面平视/微俯/高俯），场景全貌描述
建筑/地形轮廓，背景天空/远景，整体色调
无人物，无道具遮挡，展示完整空间边界

【第2格-主体焦点区域】
活动核心区、地面与陈设；中景、光线落点；功能（对话区/打斗区等，勿复述「无人物」等禁令）

【第3格-环境特征细节】
标志性元素的材质/纹理/色彩；特写与景深；该元素的指示意义

【第4格-角度变体】
与第1格不同的机位高度与视角（如微俯/高俯/仰视/斜角）；保持与前三格相同的光线/时段/天气；展示空间纵深与建筑结构关系`;
}

/**
 * 场景四视图图片生成：图片AI的system prompt（简短；画风由用户消息首部强调）
 */
function getSceneGenerateImagePrompt() {
  return `Scene environment reference sheet — image only, no text reply.

ONE image: 2×2 grid. TL=establishing wide (full space, boundaries, context). TR=main activity zone medium shot (floor, key furnishings). BL=signature environmental detail close-up. BR=alternate angle view (same place, same lighting/time/weather, different camera angle such as elevated/low/high/oblique).

No people: no characters, silhouettes, human shadows. No text/labels/watermarks/location lettering. Same architecture, terrain, ground materials, and key props across all panels; same light, time, and weather; only focal length and camera angle may change. Unified palette and depth; high detail. Follow ART STYLE / 画风 block at the start of the user message if present.`;
}

/**
 * 场景单图提示词生成：图片AI的system prompt（单图场景，非四宫格）
 */
function getSceneGenerateSingleImagePrompt() {
  return `Scene environment reference — image only, no text reply.

ONE single continuous image (no grid, no split panels, no collage).
Show the complete scene in one unified view: wide establishing shot capturing the full space, key architectural features, lighting, atmosphere, and environmental details.
No people: no characters, silhouettes, human shadows. No text/labels/watermarks/location lettering.
Follow ART STYLE / 画风 block at the start of the user message if present.`;
}

module.exports = {
  getScenePolishPrompt,
  getScenePolishPromptSingle,
  getSceneGenerateImagePrompt,
  getSceneGenerateSingleImagePrompt,
};
