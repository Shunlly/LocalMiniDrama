import { ElMessage, ElMessageBox } from 'element-plus'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'
import { buildExtractTaskMeta } from '@/composables/useGenerationTaskSync'

export function useFilmCreateStoryboardCrud(deps = {}) {
  const {
    currentEpisodeId,
    dramaId,
    store,
    dramaAPI,
    storyboardsAPI,
    genStore,
    pollTask,
    captureDramaRefresh,
    loadDrama,
    getSelectedStyle,
    getStoryboardCountForApi,
    getVideoDurationForApi,
    projectAspectRatio,
    storyboardIncludeNarration,
    storyboardUniversalOmni,
    sbTruncatedWarning,
    sbTruncatedDismissed,
    polishUniversalSegmentsAfterGeneration,
    trackFilmCreateAction,
  } = deps

  /** 生成期间轻量刷新分镜列表（只更新指定集 storyboards，不重载整个 drama） */
  async function refreshStoryboardsForEpisode(episodeId) {
    if (!episodeId) return
    try {
      const res = await dramaAPI.getStoryboards(episodeId)
      const list = Array.isArray(res) ? res : (res?.storyboards ?? null)
      if (!Array.isArray(list)) return
      if (Number(store.currentEpisode?.id) === Number(episodeId)) {
        store.currentEpisode.storyboards = list
      }
      const epInDrama = store.drama?.episodes?.find((e) => Number(e.id) === Number(episodeId))
      if (epInDrama) {
        epInDrama.storyboards = list
      }
    } catch (_) { /* 静默忽略，不影响主流程 */ }
  }

  /** @deprecated 使用 refreshStoryboardsForEpisode */
  async function refreshStoryboardsOnly() {
    return refreshStoryboardsForEpisode(currentEpisodeId.value)
  }

  async function onGenerateStoryboard() {
    trackFilmCreateAction('generate_storyboard_click')
    const epId = currentEpisodeId.value
    if (!epId) return
    if ((store.storyboards || []).length > 0) {
      try {
        await ElMessageBox.confirm(
          '重新生成会覆盖当前分镜脚本和已有分镜图、视频进度。确定继续？',
          '重新生成分镜',
          { confirmButtonText: '重新生成', cancelButtonText: '取消', type: 'warning' },
        )
      } catch {
        return
      }
    }
    const meta = buildExtractTaskMeta(store, dramaId.value, epId, GEN_RESOURCE.GENERATE_STORYBOARD, 'AI生成分镜')
    genStore.markRunning(meta)
    // 生成期间每 2 秒刷新该集分镜列表，让已解析的分镜逐步出现（切集后仍更新原集缓存）
    const refreshTimer = setInterval(() => refreshStoryboardsForEpisode(epId), 2000)
    try {
      const res = await dramaAPI.generateStoryboard(epId, {
        model: undefined,
        style: getSelectedStyle(),
        storyboard_count: getStoryboardCountForApi(),
        video_duration: getVideoDurationForApi(),
        aspect_ratio: projectAspectRatio.value || '16:9',
        include_narration: !!storyboardIncludeNarration.value,
        universal_omni_storyboard: !!storyboardUniversalOmni.value,
      })
      const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
      if (taskId) {
        const pollRes = await pollTask(taskId, captureDramaRefresh(), meta)
        // failed / timeout：pollTask 内已展示对应提示，直接返回，不显示「完成」
        if (pollRes?.status !== 'completed') return
        if (pollRes?.result?.truncated) {
          sbTruncatedWarning.value = true
          sbTruncatedDismissed.value = false
        }
      }
      await loadDrama()
      // 生成完成后静默补全空缺的摄影参数（只填未填字段，不覆盖 AI 已填的）
      storyboardsAPI.batchInferParams(epId, false).catch(() => {})
      const polishRes = await polishUniversalSegmentsAfterGeneration({})
      const polishedN = polishRes?.polished ?? 0
      ElMessage.success(
        storyboardUniversalOmni.value
          ? polishedN > 0
            ? `全能分镜生成完成，已自动润色 ${polishedN} 条片段`
            : '全能分镜生成完成'
          : '分镜生成完成'
      )
      trackFilmCreateAction('generate_storyboard_complete', {
        extra: { storyboard_count: (store.storyboards || []).length },
      })
    } catch (e) {
      // HTTP 错误由 request 拦截器统一展示，此处仅处理拦截器未覆盖的异常
      if (!e.response && !isUserFacingAbort(e)) ElMessage.error(toUserFacingError(e, '生成失败'))
    } finally {
      clearInterval(refreshTimer)
      genStore.markDone(meta)
    }
  }

  async function onAddSingleStoryboard(){
    if (!currentEpisodeId.value) {
      ElMessage.warning('请先选择集')
      return
    }
    try {
      // 获取当前最大序号（仅计算当前集的分镜）
      const maxNum = (store.storyboards || [])
        .filter(sb => sb.episode_id === currentEpisodeId.value)
        .reduce((max, sb) => Math.max(max, sb.storyboard_number || 0), 0)
      await storyboardsAPI.create({
        episode_id: currentEpisodeId.value,
        storyboard_number: maxNum + 1,
        title: `镜头 ${maxNum + 1}`,
        description: '',
      })
      ElMessage.success('添加成功')
      await loadDrama() // 刷新列表
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '添加失败'))
    }
  }

  async function onDeleteSingleStoryboard(id){
    try {
      await ElMessageBox.confirm('确定要删除这个分镜吗？', '提示', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      })
      await storyboardsAPI.delete(id)
      ElMessage.success('删除成功')
      await loadDrama() // 刷新列表
    } catch (e) {
      if (e !== 'cancel') {
        ElMessage.error(toUserFacingError(e, '删除失败'))
      }
    }
  }

  async function onInsertStoryboardBefore(sb) {
    try {
      await storyboardsAPI.insertBefore(sb.id)
      ElMessage.success('已在此位置前新增空白分镜')
      await loadDrama()
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '新增失败'))
    }
  }

  return {
    refreshStoryboardsForEpisode,
    refreshStoryboardsOnly,
    onGenerateStoryboard,
    onAddSingleStoryboard,
    onDeleteSingleStoryboard,
    onInsertStoryboardBefore,
  }
}
