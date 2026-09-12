/** 影像风格选项：目录在 styleOptionsCatalog.js，本文件保留查询与旧项目回填 */
import { generationStyleOptions } from './styleOptionsCatalog.js'

export { generationStyleOptions }

/**
 * 根据 value 查找风格选项对象
 * @param {string} val
 * @returns {object|null}
 */
export function findStyleOption(val) {
  for (const group of generationStyleOptions) {
    const found = group.options.find(o => o.value === val)
    if (found) return found
  }
  return null
}

/**
 * 获取传给图像/视频 AI 用的英文 prompt（效果最好）
 * @param {string} val - 风格 value
 * @returns {string|undefined}
 */
export function getStylePromptEn(val) {
  const v = (val || '').toString().trim()
  if (!v) return undefined
  const opt = findStyleOption(v)
  if (opt) return opt.promptEn || opt.prompt || v
  return v
}

/**
 * 获取中文风格描述（用于界面展示或中文场景提示词拼接）
 * @param {string} val - 风格 value
 * @returns {string|undefined}
 */
export function getStylePromptZh(val) {
  const v = (val || '').toString().trim()
  if (!v) return undefined
  const opt = findStyleOption(v)
  if (opt) return opt.prompt || opt.promptEn || v
  return v
}

/**
 * 保存剧集 metadata 时用：与后端约定字段 style_prompt_zh / style_prompt_en。
 * 未选风格时返回空串，写入后可覆盖旧 metadata 中的画风字段。
 */
export function stylePromptMetadataForSave(styleValue) {
  const v = (styleValue || '').toString().trim()
  if (!v) return { style_prompt_zh: '', style_prompt_en: '' }
  const opt = findStyleOption(v)
  if (!opt) return { style_prompt_zh: v, style_prompt_en: v }
  return {
    style_prompt_zh: opt.prompt || opt.promptEn || '',
    style_prompt_en: opt.promptEn || opt.prompt || '',
  }
}

/**
 * 旧项目只有 dramas.style（value）而 metadata 里没有画风长文案时，自动 saveOutline 合并写入，
 * 便于后端 mergeCfgStyleWithDrama 能拿到 default_style_en。不覆盖已有 style_prompt_en。
 * @returns {Promise<object>} 更新后的剧集对象（失败或未改则原样返回 drama）
 */
export async function backfillDramaStylePromptMetadataIfNeeded(dramaAPI, dramaId, drama) {
  if (!drama || dramaId == null) return drama
  const styleVal = (drama.style || '').toString().trim()
  if (!styleVal) return drama
  const hasEn = (drama.metadata?.style_prompt_en || '').toString().trim()
  if (hasEn) return drama
  const patch = stylePromptMetadataForSave(styleVal)
  if (!(patch.style_prompt_en || '').toString().trim()) return drama
  try {
    await dramaAPI.saveOutline(dramaId, { metadata: patch })
    return await dramaAPI.get(dramaId)
  } catch (_) {
    return drama
  }
}
