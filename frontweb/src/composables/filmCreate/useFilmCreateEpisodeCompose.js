import { ElMessage } from 'element-plus'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'

export function useFilmCreateEpisodeCompose(deps = {}) {
  const {
    store,
    dramaId,
    currentEpisodeId,
    dramaAPI,
    genStore,
    pollTask,
    captureDramaRefresh,
    loadDrama,
    composeActionDisabledReason,
    currentEpisodeVideoUrl,
    videoErrorMsg,
    videoSubtitle,
    videoBurnDialogue,
    videoWatermark,
    videoWatermarkText,
  } = deps

  function getFinalizeMergeOptions() {
    return {
      burn_narration_subtitles: !!videoSubtitle.value,
      burn_dialogue_audio: !!videoBurnDialogue.value,
      watermark_text: videoWatermark.value ? String(videoWatermarkText.value || '').trim().slice(0, 200) : '',
    }
  }

  async function onGenerateVideo() {
    if (composeActionDisabledReason.value) {
      ElMessage.warning(composeActionDisabledReason.value)
      return
    }
    const epId = currentEpisodeId.value
    const did = dramaId.value
    const dramaTitle = store.drama?.title || ''
    const epNum = store.currentEpisode?.episode_number
    const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
    const mergeMeta = {
      dramaId: did,
      episodeId: epId,
      dramaTitle,
      episodeNumber: epNum,
      resourceType: GEN_RESOURCE.EPISODE_MERGE,
      resourceId: epId,
      label: `${epLabel} 合成视频`,
    }
    store.setVideoStatus('generating', did, epId)
    store.setVideoProgress(5, did, epId)
    genStore.markRunning(mergeMeta)
    videoErrorMsg.value = ''
    try {
      const result = await dramaAPI.finalizeEpisode(epId, getFinalizeMergeOptions())
      if (result?.task_id != null) {
        store.setVideoProgress(10, did, epId)
        ElMessage.success(result?.message || '视频合成任务已提交，请稍后查看')
        const pollResult = await pollTask(result.task_id, captureDramaRefresh(), mergeMeta)
        await loadDrama()
        if (pollResult?.status === 'completed') {
          store.setVideoProgress(100, did, epId)
          if (currentEpisodeVideoUrl.value) {
            store.setVideoStatus('done', did, epId)
            ElMessage.success('视频生成完成')
          } else {
            store.setVideoStatus('error', did, epId)
            videoErrorMsg.value = '视频生成完成但未获取到播放地址，请稍后刷新'
            ElMessage.warning(videoErrorMsg.value)
          }
        } else if (pollResult?.status === 'failed') {
          store.setVideoStatus('error', did, epId)
          videoErrorMsg.value = pollResult?.error || '视频生成失败'
        } else if (pollResult?.status === 'timeout') {
          store.setVideoStatus('generating', did, epId)
          videoErrorMsg.value = '任务仍在排队或生成中，请稍后刷新查看'
          ElMessage.warning(videoErrorMsg.value)
        }
      } else {
        store.setVideoStatus('error', did, epId)
        const msg = result?.message || '本集没有可合成的视频片段'
        videoErrorMsg.value = msg
        ElMessage.warning(msg)
      }
    } catch (e) {
      videoErrorMsg.value = e.message || '生成失败'
      store.setVideoStatus('error', did, epId)
    } finally {
      if (store.getVideoStatus(did, epId) !== 'generating') {
        genStore.markDone(mergeMeta)
      }
    }
  }

  return {
    getFinalizeMergeOptions,
    onGenerateVideo,
  }
}
