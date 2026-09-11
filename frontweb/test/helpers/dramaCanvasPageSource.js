/**
 * 读取画布页及其拆出的控件接线源码，供源码合同覆盖完整 UI。
 */
import { readFileSync } from 'node:fs'

export const DRAMA_CANVAS_PAGE_FILES = Object.freeze([
  '../../src/views/DramaCanvas.vue',
  '../../src/views/DramaCanvas.css',
  '../../src/components/dramaCanvas/CanvasPageHeader.vue',
  '../../src/components/dramaCanvas/CanvasProductionSidebar.vue',
  '../../src/components/dramaCanvas/CanvasLoadFailureCard.vue',
  '../../src/components/dramaCanvas/CanvasEmptyOverlays.vue',
  '../../src/components/dramaCanvas/CanvasEmptyState.vue',
  '../../src/components/dramaCanvas/FreeCanvasEmptyStart.vue',
  '../../src/components/dramaCanvas/CanvasFlowControls.vue',
  '../../src/components/dramaCanvas/CanvasUnknownOutcomeBar.vue',
  '../../src/components/dramaCanvas/CanvasFlowStage.vue',
  '../../src/components/dramaCanvas/CanvasWorkspace.vue',
  '../../src/components/dramaCanvas/CanvasOverlayHost.vue',
  '../../src/components/dramaCanvas/CanvasPageChrome.vue',
  '../../src/components/dramaCanvas/CanvasDesktopToolbar.vue',
  '../../src/components/dramaCanvas/dramaCanvasControlBindings.js',
  '../../src/components/dramaCanvas/dramaCanvasProjectRequest.js',
  '../../src/components/dramaCanvas/dramaCanvasBillableMedia.js',
  '../../src/components/dramaCanvas/dramaCanvasRoute.js',
  '../../src/components/dramaCanvas/dramaCanvasDerivedState.js',
  '../../src/components/dramaCanvas/dramaCanvasFocusSync.js',
  '../../src/components/dramaCanvas/dramaCanvasContextMenu.js',
  '../../src/components/dramaCanvas/dramaCanvasBatchGenerate.js',
  '../../src/components/dramaCanvas/dramaCanvasNavigation.js',
  '../../src/components/dramaCanvas/dramaCanvasLeaveHelpers.js',
  '../../src/components/dramaCanvas/dramaCanvasLeaveProtection.js',
  '../../src/components/dramaCanvas/dramaCanvasRouteFocus.js',
  '../../src/components/dramaCanvas/dramaCanvasProjectActions.js',
])

export const DRAMA_CANVAS_COMPOSABLE_FILES = Object.freeze([
  '../../src/composables/useDramaCanvasFreeCanvas.js',
  '../../src/composables/useDramaCanvasFreeCanvasMedia.js',
  '../../src/composables/useDramaCanvasFreeCanvasClipboard.js',
  '../../src/composables/useDramaCanvasPersist.js',
  '../../src/composables/useDramaCanvasProjectLoad.js',
  '../../src/composables/useDramaCanvasWorkflow.js',
  '../../src/composables/useDramaCanvasGraph.js',
  '../../src/composables/useDramaCanvasViewport.js',
  '../../src/composables/useDramaCanvasDisplayState.js',
  '../../src/composables/useDramaCanvasPageBindings.js',
])

function readPageFile(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

export function readDramaCanvasPageSource() {
  return DRAMA_CANVAS_PAGE_FILES.map(readPageFile).join('\n')
}

export function readDramaCanvasRuntimeSource() {
  return [
    ...DRAMA_CANVAS_PAGE_FILES,
    ...DRAMA_CANVAS_COMPOSABLE_FILES,
  ].map(readPageFile).join('\n')
}