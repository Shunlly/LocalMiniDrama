import { ElMessage } from 'element-plus'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'
import { isStoryboardMediaStateError, submitStoryboardVideoAfterAccepted } from '@/utils/storyboardMedia'
import {
  buildStoryboardVideoRequest,
  videoConfigSupportsGridReference,
} from '@/utils/storyboardVideoRequest'

export function useFilmCreateBatchGeneration(deps = {}) {
  const {
    currentEpisodeId,
    dramaId,
    store,
    pipelineRunning,
    pipelineConcurrency,
    pipelineVideoConcurrency,
    storyboardMediaActionReason,
    batchImageRunning,
    batchImageStopping,
    batchImageErrors,
    batchImageProgress,
    batchVideoRunning,
    batchVideoStopping,
    batchVideoErrors,
    batchVideoProgress,
    sbImages,
    sbVideos,
    sbSelectedImgId,
    sbSelectedVideoId,
    gridMode,
    storyboardUseFirstLastFrame,
    videoFrameContiguity,
    projectAspectRatio,
    videoResolution,
    generatingSbVideoIds,
    loadStoryboardMedia,
    hasSbImage,
    isSbUniversalMode,
    ensureProfessionalFramePrompt,
    assertStoryboardMediaReady,
    imagesAPI,
    videosAPI,
    storyboardsAPI,
    uploadAPI,
    pollTask,
    captureStoryboardMediaRefresh,
    refreshStoryboardMediaForCurrentContext,
    restoreSelectionsFromBackend,
    getSelectedStyle,
    getSbVideoReferenceGrid,
    sbCanSubmitVideo,
    getSbFirstFrameUrl,
    collectSbSceneOnlyReferenceAbsoluteUrls,
    collectSbOmniReferenceAbsoluteUrls,
    getSbPrimaryReferenceAbsoluteUrl,
    toAbsoluteImageUrl,
    assetImageUrl,
    recordHasPlayableVideoUrl,
    buildStoryboardVideoReferencePayload,
    buildSbVideoPromptForApi,
    getSbVideoDurationForApi,
    captureVideoLastFrame,
    buildSbGenMeta,
    refreshVideoGenerationCapability,
    canUseUniversalOmniVideoApi,
  } = deps

  async function startBatchImageGeneration() {
    if (!currentEpisodeId.value || batchImageRunning.value || pipelineRunning.value) return
    if (storyboardMediaActionReason.value) {
      ElMessage.warning(storyboardMediaActionReason.value)
      return
    }
    batchImageErrors.value = []
    batchImageStopping.value = false
    batchImageRunning.value = true
    try {
      // 仅当媒体数据尚未加载时才全量拉取，避免点击时触发大量冗余请求
      if (Object.keys(sbImages.value).length === 0) {
        await loadStoryboardMedia({ failClosed: true })
      }
      const boards = store.storyboards || []
      const todo = boards.filter((sb) => !hasSbImage(sb))
      if (todo.length === 0) {
        ElMessage.info('所有分镜均已有图片，无需重新生成')
        return
      }
      batchImageProgress.value = { current: 0, total: todo.length, failed: 0 }
      const concurrency = pipelineConcurrency.value || 3
      let doneCount = 0

      // 并发执行，使用与 pipeline 相同的并发模型
      let queueIdx = 0
      const worker = async () => {
        while (queueIdx < todo.length) {
          if (batchImageStopping.value) break
          const sb = todo[queueIdx++]
          const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
          try {
            let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
            let frameTypeForCreate = gridMode.value !== 'single' ? gridMode.value : undefined
            if (useFirstLast) {
              // 首尾帧模式下，批量生成分镜图也必须走专业首帧提示词（含 layout_description 空间合同、专用 system prompt 等）
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
              const pollRes = await pollTask(res.task_id, captureStoryboardMediaRefresh(sb.id))
              if (pollRes?.status === 'failed') {
                batchImageErrors.value.push(`#${sb.storyboard_number ?? sb.id}: ${pollRes.error || '生成失败'}`)
                batchImageProgress.value = { ...batchImageProgress.value, failed: batchImageProgress.value.failed + 1 }
              }
            } else {
              await refreshStoryboardMediaForCurrentContext(sb.id)
            }
            // 成功后清理手动选中，让服务器 first_frame_image_id 成为权威（与单条生成首帧的清理逻辑一致）
            if (useFirstLast) {
              delete sbSelectedImgId.value[sb.id]
            }
          } catch (e) {
            if (isStoryboardMediaStateError(e)) throw e
            batchImageErrors.value.push(`#${sb.storyboard_number ?? sb.id}: ${e.message || '提交失败'}`)
            batchImageProgress.value = { ...batchImageProgress.value, failed: batchImageProgress.value.failed + 1 }
          }
          doneCount++
          batchImageProgress.value = { ...batchImageProgress.value, current: doneCount }
        }
      }
      const workerResults = await Promise.allSettled(
        Array.from({ length: Math.min(concurrency, todo.length) }, () => worker()),
      )
      const mediaStateFailure = workerResults.find(
        (result) => result.status === 'rejected' && isStoryboardMediaStateError(result.reason),
      )
      if (mediaStateFailure) throw mediaStateFailure.reason
      if (!batchImageStopping.value) {
        // 最终统一恢复选中状态，确保所有首帧生成后服务器绑定立即生效（与单条生成路径一致）
        restoreSelectionsFromBackend()
        if (batchImageProgress.value.failed === 0) ElMessage.success(`分镜图批量生成完成（共 ${todo.length} 条）`)
        else ElMessage.warning(`批量完成，${batchImageProgress.value.failed}/${todo.length} 条失败`)
      } else {
        ElMessage.info('批量生成已停止')
      }
    } finally {
      batchImageRunning.value = false
    }
  }

  async function startBatchVideoGeneration() {
    if (!currentEpisodeId.value || batchVideoRunning.value || pipelineRunning.value) return
    if (storyboardMediaActionReason.value) {
      ElMessage.warning(storyboardMediaActionReason.value)
      return
    }
    const videoCapability = await refreshVideoGenerationCapability()
    if (storyboardMediaActionReason.value) {
      ElMessage.warning(storyboardMediaActionReason.value)
      return
    }
    if (!videoCapability.ready) {
      ElMessage.warning(videoCapability.reason)
      return
    }
    const batchVideoCfg = videoCapability.config
    const batchUniversalOmni = canUseUniversalOmniVideoApi(batchVideoCfg)
    batchVideoErrors.value = []
    batchVideoStopping.value = false
    batchVideoRunning.value = true
    try {
      // 仅当媒体数据尚未加载时才全量拉取，避免点击时触发大量冗余请求
      if (Object.keys(sbVideos.value).length === 0) {
        await loadStoryboardMedia({ failClosed: true })
      }
      const boards = store.storyboards || []
      // 只处理：有参考图（经典=分镜主图；全能=场景/角色/道具，不含经典主图）且 还没有已完成视频 的分镜
      const todo = boards.filter((sb) => {
        const vidList = sbVideos.value[sb.id] || []
        if (vidList.some((v) => v.status === 'completed' && recordHasPlayableVideoUrl(v))) return false
        const selectedGrid = getSbVideoReferenceGrid(sb)
        if (selectedGrid) return true
        if (isSbUniversalMode(sb.id)) {
          if (!sbCanSubmitVideo(sb)) return false
          if (batchUniversalOmni) return true
          return !!(getSbFirstFrameUrl(sb) || collectSbSceneOnlyReferenceAbsoluteUrls(sb).length)
        }
        return !!getSbFirstFrameUrl(sb)
      })
      if (todo.length === 0) {
        ElMessage.info('没有需要生成视频的分镜（分镜缺少图片，或视频已全部生成）')
        return
      }
      batchVideoProgress.value = { current: 0, total: todo.length, failed: 0 }
      const contiguity = videoFrameContiguity.value
      // 连贯帧模式强制顺序（concurrency=1），普通模式并发
      const videoConcurrency = contiguity ? 1 : (pipelineVideoConcurrency.value || 2)
      let videoDoneCount = 0
      let prevVideoItem = null  // 连贯帧：保存上一条已完成的视频记录

      let videoQueueIdx = 0
      const videoWorker = async () => {
        while (videoQueueIdx < todo.length) {
          if (batchVideoStopping.value) break
          const sb = todo[videoQueueIdx++]
          const mediaRefresh = captureStoryboardMediaRefresh(sb.id)
          const universal = isSbUniversalMode(sb.id)
          const universalOmni = universal && batchUniversalOmni
          const selectedGrid = getSbVideoReferenceGrid(sb)
          if (selectedGrid && !videoConfigSupportsGridReference(batchVideoCfg)) {
            batchVideoErrors.value.push(`#${sb.storyboard_number ?? sb.id}: 当前视频模型不支持宫格整图参考`)
            batchVideoProgress.value = { ...batchVideoProgress.value, failed: batchVideoProgress.value.failed + 1 }
            videoDoneCount++
            batchVideoProgress.value = { ...batchVideoProgress.value, current: videoDoneCount }
            continue
          }
          const gridAbsoluteUrl = selectedGrid ? toAbsoluteImageUrl(assetImageUrl(selectedGrid)) : ''
          const omniRefs = universalOmni
            ? [gridAbsoluteUrl, ...collectSbOmniReferenceAbsoluteUrls(sb)].filter(Boolean)
            : []
          if (!universal && !gridAbsoluteUrl && !getSbFirstFrameUrl(sb) && !getSbPrimaryReferenceAbsoluteUrl(sb)) {
            videoDoneCount++
            batchVideoProgress.value = { ...batchVideoProgress.value, current: videoDoneCount }
            continue
          }
          if (universalOmni && !omniRefs.length && !sbCanSubmitVideo(sb)) {
            videoDoneCount++
            batchVideoProgress.value = { ...batchVideoProgress.value, current: videoDoneCount }
            continue
          }
          try {
            generatingSbVideoIds.add(sb.id)
            const seedPayload = await buildStoryboardVideoReferencePayload(sb, {
              universal,
              universalOmni,
              selectedGrid,
            })
            const absoluteUrl = seedPayload.absoluteUrl || ''
            // 连贯帧：提取上一条视频末帧作为参考（全能模式不走连贯帧替换）
            let contiguityFirstFrameUrl = absoluteUrl
            if (contiguity && prevVideoItem && !universal && !selectedGrid) {
              const prevVideoUrl = prevVideoItem.local_path
                ? toAbsoluteImageUrl('/static/' + prevVideoItem.local_path.replace(/^\//, ''))
                : prevVideoItem.video_url
              if (prevVideoUrl) {
                try {
                  const lastFrameBlob = await captureVideoLastFrame(prevVideoUrl)
                  if (lastFrameBlob) {
                    const file = new File([lastFrameBlob], 'continuity_frame.jpg', { type: 'image/jpeg' })
                    const uploadRes = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
                    if (uploadRes?.local_path) {
                      contiguityFirstFrameUrl = toAbsoluteImageUrl('/static/' + uploadRes.local_path.replace(/^\//, ''))
                    }
                  }
                } catch (_) {}
              }
            }
            const referencePayload = await buildStoryboardVideoReferencePayload(sb, {
              universal,
              universalOmni,
              selectedGrid,
              contiguityFirstFrameUrl: contiguityFirstFrameUrl || undefined,
            })
            const vFirst = referencePayload.firstFrameUrl
            const vLast = referencePayload.lastFrameUrl
            const refUrls = referencePayload.referenceUrls
            const res = await submitStoryboardVideoAfterAccepted({
              createVideo: () => {
                assertStoryboardMediaReady()
                return videosAPI.create(buildStoryboardVideoRequest({
                  dramaId: dramaId.value,
                  storyboard: sb,
                  prompt: buildSbVideoPromptForApi(sb, { preferClassicPrompt: universal && !universalOmni }),
                  universalOmni,
                  firstFrameUrl: vFirst,
                  lastFrameUrl: vLast,
                  referenceImageUrls: refUrls,
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
              const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
              const pollRes = await pollTask(res.task_id, mediaRefresh, meta)
              if (pollRes?.status === 'failed') {
                batchVideoErrors.value.push(`#${sb.storyboard_number ?? sb.id}: ${pollRes.error || '生成失败'}`)
                batchVideoProgress.value = { ...batchVideoProgress.value, failed: batchVideoProgress.value.failed + 1 }
                prevVideoItem = null
              } else if (contiguity && pollRes?.status === 'completed') {
                // 连贯帧：保存本条视频用于下一条
                const vList = sbVideos.value[sb.id] || []
                prevVideoItem = vList.find((v) => v.status === 'completed') || null
              }
            } else {
              await mediaRefresh()
              if (contiguity) {
                const vList = sbVideos.value[sb.id] || []
                prevVideoItem = vList.find((v) => v.status === 'completed') || null
              }
            }
          } catch (e) {
            if (isStoryboardMediaStateError(e)) throw e
            batchVideoErrors.value.push(`#${sb.storyboard_number ?? sb.id}: ${e.message || '提交失败'}`)
            batchVideoProgress.value = { ...batchVideoProgress.value, failed: batchVideoProgress.value.failed + 1 }
            if (contiguity) prevVideoItem = null
          } finally {
            generatingSbVideoIds.delete(sb.id)
          }
          videoDoneCount++
          batchVideoProgress.value = { ...batchVideoProgress.value, current: videoDoneCount }
        }
      }
      const workerResults = await Promise.allSettled(
        Array.from({ length: Math.min(videoConcurrency, todo.length) }, () => videoWorker()),
      )
      const mediaStateFailure = workerResults.find(
        (result) => result.status === 'rejected' && isStoryboardMediaStateError(result.reason),
      )
      if (mediaStateFailure) throw mediaStateFailure.reason
      if (!batchVideoStopping.value) {
        if (batchVideoProgress.value.failed === 0) ElMessage.success(`分镜视频批量生成完成（共 ${todo.length} 条）`)
        else ElMessage.warning(`批量完成，${batchVideoProgress.value.failed}/${todo.length} 条失败`)
      } else {
        ElMessage.info('批量生成已停止')
      }
    } finally {
      batchVideoRunning.value = false
    }
  }

  return {
    startBatchImageGeneration,
    startBatchVideoGeneration,
  }
}
