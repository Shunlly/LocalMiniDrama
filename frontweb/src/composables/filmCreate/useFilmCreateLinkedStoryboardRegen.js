import { ElMessage, ElMessageBox } from 'element-plus'
import { isStoryboardMediaStateError } from '@/utils/storyboardMedia'

export function useFilmCreateLinkedStoryboardRegen(deps = {}) {
  const {
    dramaId,
    imagesAPI,
    taskAPI,
    assertStoryboardMediaReady,
    captureStoryboardMediaRefresh,
    storyboardUseFirstLastFrame,
    isSbUniversalMode,
    ensureProfessionalFramePrompt,
    getSelectedStyle,
    projectAspectRatio,
    regenSbImagesForAsset,
    regenSbImagesProgress,
    sbSelectedImgId,
  } = deps

  /** 对关联分镜批量重新生成图片 */
  async function onRegenAffectedSbImages(assetKey, affectedBoards) {
    if (!affectedBoards.length || regenSbImagesForAsset.has(assetKey)) return
    try {
      assertStoryboardMediaReady()
    } catch (error) {
      ElMessage.warning(error.message)
      return
    }
    try {
      await ElMessageBox.confirm(
        `将为 ${affectedBoards.length} 个关联分镜重新生成图片（#${affectedBoards.map((s) => s.storyboard_number).join('、#')}），原有图片将被覆盖，是否继续？`,
        '重新生成关联分镜图',
        { confirmButtonText: '确认生成', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
    try {
      assertStoryboardMediaReady()
    } catch (error) {
      ElMessage.warning(error.message)
      return
    }
    regenSbImagesForAsset.add(assetKey)
    // 用 Map 存进度以便响应式更新
    if (!regenSbImagesProgress.value) regenSbImagesProgress.value = {}
    regenSbImagesProgress.value[assetKey] = { current: 0, total: affectedBoards.length }
    let failed = 0
    try {
      for (let i = 0; i < affectedBoards.length; i++) {
        regenSbImagesProgress.value[assetKey] = { current: i + 1, total: affectedBoards.length }
        const sb = affectedBoards[i]
        const mediaRefresh = captureStoryboardMediaRefresh(sb.id)
        try {
          const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
          let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
          let frameTypeForCreate = undefined
          if (useFirstLast) {
            // 首尾帧模式下，关联资源触发的批量重新生成也必须走专业首帧提示词
            prompt = await ensureProfessionalFramePrompt(sb, 'first')
            frameTypeForCreate = 'storyboard_first'
          }
          assertStoryboardMediaReady()
          const res = await imagesAPI.create({
            storyboard_id: sb.id,
            drama_id: dramaId.value,
            prompt,
            style: getSelectedStyle(),
            frame_type: frameTypeForCreate,
            aspect_ratio: projectAspectRatio.value || '16:9',
          })
          if (res?.task_id) {
            const pollRes = await new Promise((resolve) => {
              const maxAttempts = 180
              let attempts = 0
              const tick = async () => {
                attempts++
                try {
                  const t = await taskAPI.get(res.task_id)
                  if (t.status === 'completed') { await mediaRefresh(); return resolve({ status: 'completed' }) }
                  if (t.status === 'failed') return resolve({ status: 'failed', error: t.error || '任务失败' })
                } catch (_) {}
                if (attempts < maxAttempts) setTimeout(tick, 2000)
                else resolve({ status: 'timeout' })
              }
              setTimeout(tick, 2000)
            })
            if (pollRes?.status !== 'completed') failed++
          } else {
            await mediaRefresh()
          }
          if (useFirstLast) {
            delete sbSelectedImgId.value[sb.id]
          }
        } catch (e) {
          if (isStoryboardMediaStateError(e)) throw e
          failed++
        }
        if (i < affectedBoards.length - 1) await new Promise((r) => setTimeout(r, 500))
      }
      if (failed === 0) ElMessage.success(`已重新生成 ${affectedBoards.length} 张关联分镜图`)
      else ElMessage.warning(`完成，${failed}/${affectedBoards.length} 条失败`)
    } catch (error) {
      if (isStoryboardMediaStateError(error)) {
        ElMessage.warning(error.message)
        return
      }
      throw error
    } finally {
      regenSbImagesForAsset.delete(assetKey)
      if (regenSbImagesProgress.value) delete regenSbImagesProgress.value[assetKey]
    }
  }

  return {
    onRegenAffectedSbImages,
  }
}
