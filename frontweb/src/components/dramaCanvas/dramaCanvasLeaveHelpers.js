/**
 * 画布离开屏障中的生成等待确认。工作流离开确认见 dramaCanvasLeaveProtection.js。
 */
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'

export function createDramaCanvasLeaveHelpers(ctx = {}) {
  async function ensureEpisodeGenerationFinished() {
    if (!ctx.episodeGenerating.value) return true
    try {
      await ElMessageBox.confirm(
        '离开会停止当前页面继续等待和显示进度，但已提交的后台任务及供应商计费可能继续。是否仍要离开？',
        '批量生成仍在执行',
        { type: 'warning', confirmButtonText: '停止等待并离开', cancelButtonText: '继续等待' },
      )
    } catch (_) {
      return false
    }
    ctx.abortEpisodeGenerate()
    return true
  }

  async function ensureNodeGenerationFinished() {
    if (!ctx.nodeGenerationCoordinator.hasActive()) return true
    try {
      await ElMessageBox.confirm(
        '离开会停止当前页面继续等待和显示进度，但已提交的后台任务及供应商计费可能继续。是否仍要离开？',
        '单节点生成仍在执行',
        { type: 'warning', confirmButtonText: '停止等待并离开', cancelButtonText: '继续等待' },
      )
    } catch (_) {
      return false
    }
    ctx.nodeGenerationCoordinator.stopWaiting('页面已离开，后台任务和供应商计费可能继续')
    return true
  }

  function ensureFreeCanvasUploadFinished() {
    if (!ctx.freeCanvasUploading.value) return true
    ElMessage.warning('素材正在上传，请等待完成后再离开')
    return false
  }

  return {
    ensureEpisodeGenerationFinished,
    ensureNodeGenerationFinished,
    ensureFreeCanvasUploadFinished,
  }
}
