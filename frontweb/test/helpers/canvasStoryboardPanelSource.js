/**
 * 读取画布分镜检查器面板及其拆出的子组件源码，供源码合同覆盖完整 UI。
 */
import { readFileSync } from 'node:fs'

export const CANVAS_STORYBOARD_PANEL_FILES = Object.freeze([
  'CanvasStoryboardPanel.vue',
  'CanvasStoryboardPanelHeader.vue',
  'CanvasStoryboardPanelRelations.vue',
  'CanvasStoryboardPanelReferences.vue',
  'CanvasStoryboardPanelFrames.vue',
  'CanvasStoryboardPanelActions.vue',
])

export function readCanvasStoryboardPanelSource() {
  return CANVAS_STORYBOARD_PANEL_FILES.map((name) => (
    readFileSync(new URL(`../../src/components/dramaCanvas/${name}`, import.meta.url), 'utf8')
  )).join('\n')
}
