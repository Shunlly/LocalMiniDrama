import { generationStyleOptions, stylePromptMetadataForSave } from '@/constants/styleOptions'

export function useFilmCreateStylePrompts(deps = {}) {
  const { generationStyle } = deps
  /** 根据 value 查找样式选项对象 */
  function _findStyleOption(val) {
    for (const group of generationStyleOptions) {
      const found = group.options.find(o => o.value === val)
      if (found) return found
    }
    return null
  }

  /** 传给图像/视频 AI 用的英文 prompt（效果最好）；
   *  找不到 promptEn 时降级到 prompt，再降级到原始值 */
  function getSelectedStylePrompt() {
    const val = (generationStyle.value || '').toString().trim()
    if (!val) return undefined
    const opt = _findStyleOption(val)
    if (opt) return opt.promptEn || opt.prompt || val
    return val
  }

  /** 中文风格描述（用于界面展示或中文场景提示词拼接） */
  function getSelectedStylePromptZh() {
    const val = (generationStyle.value || '').toString().trim()
    if (!val) return undefined
    const opt = _findStyleOption(val)
    if (opt) return opt.prompt || opt.promptEn || val
    return val
  }

  function projectStylePromptMetadata() {
    return stylePromptMetadataForSave(generationStyle.value)
  }
  function getSelectedStyle() {
    return getSelectedStylePrompt()
  }
  return {
    getSelectedStylePrompt,
    getSelectedStylePromptZh,
    projectStylePromptMetadata,
    getSelectedStyle,
  }
}
