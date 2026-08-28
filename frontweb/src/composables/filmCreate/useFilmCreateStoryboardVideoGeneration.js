import { ElMessage, ElMessageBox } from 'element-plus'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'
import { submitStoryboardVideoAfterAccepted } from '@/utils/storyboardMedia'
import {
  buildStoryboardVideoRequest,
  videoConfigSupportsGridReference,
} from '@/utils/storyboardVideoRequest'

export function useFilmCreateStoryboardVideoGeneration(deps = {}) {
  const {
    dramaId,
    videosAPI,
    storyboardsAPI,
    genStore,
    pollTask,
    captureStoryboardMediaRefresh,
    sbVideoGenerationDisabledReason,
    isSbUniversalMode,
    sbVideoReferenceImageId,
    getSbVideoReferenceGrid,
    getActiveVideoAiConfig,
    canUseUniversalOmniVideoApi,
    confirmUniversalNonSeedance2Video,
    toAbsoluteImageUrl,
    assetImageUrl,
    collectSbOmniReferenceAbsoluteUrls,
    collectSbSceneOnlyReferenceAbsoluteUrls,
    collectSbFreeReferenceAbsoluteUrls,
    getSbFirstFrameUrl,
    getSbPrimaryReferenceAbsoluteUrl,
    generatingSbVideoIds,
    buildSbGenMeta,
    sbVideoErrors,
    buildStoryboardVideoReferencePayload,
    assertStoryboardMediaReady,
    buildSbVideoPromptForApi,
    getSelectedStyle,
    projectAspectRatio,
    videoResolution,
    getSbVideoDurationForApi,
    sbSelectedVideoId,
    userFacingVideoGenerationError,
  } = deps

  async function onGenerateSbVideo(sb) {
    if (!dramaId.value || !sb?.id) return
    const mediaRefresh = captureStoryboardMediaRefresh(sb.id)
    const disabledReason = sbVideoGenerationDisabledReason(sb)
    if (disabledReason) {
      ElMessage.warning(disabledReason)
      return
    }
    const universal = isSbUniversalMode(sb.id)
    const selectedGridId = Number(sbVideoReferenceImageId.value[sb.id] || sb.video_reference_image_id)
    const selectedGrid = getSbVideoReferenceGrid(sb)
    if (selectedGridId > 0 && !selectedGrid) {
      ElMessage.error('选中的宫格视频参考图不存在，请重新选择')
      return
    }
    const videoCfg = universal || selectedGrid ? await getActiveVideoAiConfig() : null
    if (selectedGrid && !videoConfigSupportsGridReference(videoCfg)) {
      await ElMessageBox.alert(
        '当前视频模型未声明支持宫格整图参考。请在 AI 配置的高级设置中启用 supports_grid_reference，或改回主图/首帧。',
        '宫格参考不受支持',
        { confirmButtonText: '知道了', type: 'warning' }
      )
      return
    }
    let universalOmniApi = universal
    if (universal) {
      if (!canUseUniversalOmniVideoApi(videoCfg)) {
        try {
          await confirmUniversalNonSeedance2Video()
        } catch {
          return
        }
        universalOmniApi = false
      }
    }
    const gridAbsoluteUrl = selectedGrid ? toAbsoluteImageUrl(assetImageUrl(selectedGrid)) : ''
    const omniRefs = universalOmniApi
      ? [gridAbsoluteUrl, ...collectSbOmniReferenceAbsoluteUrls(sb)].filter(Boolean)
      : []
    const sceneOnlyRefs = universal && !universalOmniApi ? collectSbSceneOnlyReferenceAbsoluteUrls(sb) : []
    const freeRefs = collectSbFreeReferenceAbsoluteUrls(sb)
    const hasClassicFrame = !!(gridAbsoluteUrl || getSbFirstFrameUrl(sb) || getSbPrimaryReferenceAbsoluteUrl(sb))
    let hasAnyImage = false
    if (universalOmniApi) {
      hasAnyImage = omniRefs.length > 0
    } else if (universal) {
        hasAnyImage = hasClassicFrame || sceneOnlyRefs.length > 0 || freeRefs.length > 0
    } else {
      hasAnyImage = hasClassicFrame
    }
    if (!hasAnyImage) {
      if (!universal) {
        await ElMessageBox.alert(
          '当前为传统模式，生视频需要分镜参考图。请先生成或上传分镜图片后再试。',
          '传统模式缺少分镜图',
          { confirmButtonText: '知道了', type: 'warning' }
        )
        return
      }
      try {
        await ElMessageBox.confirm(
          universalOmniApi
            ? '当前没有可用的参考图（场景/角色/道具等；不含经典分镜主图），将按纯文案提交 Omni-Video（模型以 AI 配置为准），效果可能不稳定。确认继续？'
            : '当前没有分镜主图且无场景参考图，将仅按文字提示词生成视频，效果可能不稳定。确认继续？',
          universalOmniApi ? '全能模式无参考图' : '全能降级无参考图',
          { confirmButtonText: '继续生成', cancelButtonText: '取消', type: 'warning' }
        )
      } catch {
        return
      }
    }
    generatingSbVideoIds.add(sb.id)
    const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
    genStore.markRunning(meta)
    sbVideoErrors.value[sb.id] = ''
    try {
      const referencePayload = await buildStoryboardVideoReferencePayload(sb, {
        universal,
        universalOmni: universalOmniApi,
        selectedGrid,
      })
      const vFirst = referencePayload.firstFrameUrl || referencePayload.absoluteUrl
      const vLast = referencePayload.lastFrameUrl
      const preferClassicPrompt = universal && !universalOmniApi
      const res = await submitStoryboardVideoAfterAccepted({
        createVideo: () => {
          assertStoryboardMediaReady()
          return videosAPI.create(buildStoryboardVideoRequest({
            dramaId: dramaId.value,
            storyboard: sb,
            prompt: buildSbVideoPromptForApi(sb, { preferClassicPrompt }),
            universalOmni: universalOmniApi,
            firstFrameUrl: vFirst,
            lastFrameUrl: vLast,
            referenceImageUrls: referencePayload.referenceUrls,
            style: getSelectedStyle(),
            aspectRatio: projectAspectRatio.value || '16:9',
            resolution: videoResolution.value,
            duration: getSbVideoDurationForApi(sb),
            videoReferenceImageId: selectedGrid?.id,
          }))
        },
        clearSelection: () => {
          if (sbSelectedVideoId.value[sb.id] == null) return
          const next = { ...sbSelectedVideoId.value }
          delete next[sb.id]
          sbSelectedVideoId.value = next
        },
        clearPersistedSelection: () => storyboardsAPI.update(sb.id, { video_url: null }).catch(() => {}),
      })
      if (res?.task_id) {
        const pollRes = await pollTask(res.task_id, mediaRefresh, meta)
        if (pollRes?.status === 'failed') {
          sbVideoErrors.value[sb.id] = userFacingVideoGenerationError(pollRes.error)
        } else if (pollRes?.status === 'completed') {
          sbVideoErrors.value[sb.id] = ''
          ElMessage.success('视频生成完成')
        }
      } else {
        await mediaRefresh()
        ElMessage.success('视频生成已提交，请稍后查看')
      }
    } catch (e) {
      const message = userFacingVideoGenerationError(e?.message, '视频生成提交失败，请稍后重试。')
      sbVideoErrors.value[sb.id] = message
      ElMessage.error(message)
    } finally {
      generatingSbVideoIds.delete(sb.id)
      genStore.markDone(meta)
      await mediaRefresh()
    }
  }

  return {
    onGenerateSbVideo,
  }
}
