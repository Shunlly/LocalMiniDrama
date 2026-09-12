/**
 * 读取画布素材检查器面板及其拆出的子组件源码，供源码合同覆盖完整 UI。
 */
import { readFileSync } from 'node:fs'

export const CANVAS_ASSET_PANEL_FILES = Object.freeze([
  'CanvasAssetPanel.vue',
  'CanvasAssetPanelPreview.vue',
  'CanvasAssetPanelForm.vue',
  'CanvasAssetPanelPanorama.vue',
])

export function readCanvasAssetPanelSource() {
  return CANVAS_ASSET_PANEL_FILES.map((name) => (
    readFileSync(new URL('../../src/components/dramaCanvas/' + name, import.meta.url), 'utf8')
  )).join('\n')
}
