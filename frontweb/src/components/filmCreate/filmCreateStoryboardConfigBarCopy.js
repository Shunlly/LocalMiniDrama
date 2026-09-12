/** 分镜配置条宫格、首尾帧与全能模式读屏文案 */

export function describeStoryboardConfigControls(input = {}) {
  const useFirstLast = Boolean(input.storyboardUseFirstLastFrame)
  const gridModeDisabledReason = useFirstLast ? '首尾帧模式下使用单张图，序列宫格暂不可用' : ''
  return {
    gridModeDisabledReason,
    gridModeHint: gridModeDisabledReason || '四/九宫格自动按视角拆分',
    gridModeAriaLabel: gridModeDisabledReason
      ? `分镜序列图模式不可用：${gridModeDisabledReason}`
      : '分镜序列图模式',
    firstLastFrameAriaLabel: '首尾帧参考图（生成首帧和尾帧，帮助视频保持镜头衔接）',
    universalOmniAriaLabel: '全能模式（每镜生成可直接用于长提示词的分段描述）',
  }
}
