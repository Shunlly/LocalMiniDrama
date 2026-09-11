'use strict';

/**
 * 帧提示词用户可见文案。路由和服务仍通过 framePromptService 调用，本模块不改变公开 API。
 */

const FRAME_PROMPT_MESSAGES = Object.freeze({
  STORYBOARD_NOT_FOUND: '分镜不存在',
  STORYBOARD_INFO_NOT_FOUND: '分镜信息不存在',
  UNSUPPORTED_FRAME_TYPE: '不支持的帧类型，可选：首帧、关键帧、尾帧、宫格、动作',
  UNSUPPORTED_FRAME_TYPE_SHORT: '不支持的帧类型',
  LAYOUT_TOO_SHORT: 'AI 返回的布局描述过短或无效',
  GENERATE_FAILED: '生成帧提示词失败，请稍后重试',
  GENERATING: '正在生成帧提示词...',
  FIRST_FRAME_DESC: '镜头开始的静态画面，展示初始状态',
  KEY_FRAME_DESC: '动作高潮瞬间，展示关键动作',
  LAST_FRAME_DESC: '镜头结束画面，展示最终状态和结果',
  PANEL_DESC: '分镜板组合提示词',
  ACTION_DESC: '动作序列组合提示词',
});

function frameKindDescription(frameKind) {
  if (frameKind === 'last') return FRAME_PROMPT_MESSAGES.LAST_FRAME_DESC;
  if (frameKind === 'key') return FRAME_PROMPT_MESSAGES.KEY_FRAME_DESC;
  return FRAME_PROMPT_MESSAGES.FIRST_FRAME_DESC;
}

module.exports = {
  FRAME_PROMPT_MESSAGES,
  frameKindDescription,
};