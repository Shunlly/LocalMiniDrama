/**
 * 剧集详情的批量导入、删除和保存载荷。
 * 写回始终走项目 ID，不把分集 ID 当成项目 ID。
 */
import { ref } from 'vue'

export function toDramaDetailEpisodeSavePayload(episodes = []) {
  return episodes.map((ep, i) => ({
    episode_number: ep.episode_number ?? i + 1,
    title: ep.title || '第' + (ep.episode_number ?? i + 1) + '集',
    script_content: ep.script_content || '',
    description: ep.description ?? null,
    duration: ep.duration ?? 0,
  }))
}

export function dramaDetailEpisodeDeletedNextStep(remainingCount) {
  if (Number(remainingCount) <= 0) return '当前没有剧集，请新增一集或批量导入剧本。'
  return '可继续制作剩余剧集，或再新增一集。'
}

export function dramaDetailEpisodeDeletedMessage(label, remainingCount) {
  return label + ' 已删除。' + dramaDetailEpisodeDeletedNextStep(remainingCount)
}

export function createDramaDetailEpisodeActions({
  dramaId,
  episodes,
  dramaAPI,
  ElMessage,
  ElMessageBox,
  loadDrama,
  episodeBatchImportDialogRef,
  dramaDetailUserError,
  scrollToSection,
} = {}) {
  const addingEpisode = ref(false)
  const deletingEpisodeId = ref(null)

  function openEpisodeBatchImport() {
    episodeBatchImportDialogRef.value?.openDialog?.()
  }

  async function onBatchImportEpisodes(importedEpisodes) {
    const current = toDramaDetailEpisodeSavePayload(episodes.value)
    await dramaAPI.saveEpisodes(dramaId, [...current, ...importedEpisodes])
    await loadDrama()
  }

  async function onDeleteEpisode(ep) {
    const label = '第 ' + (ep.episode_number ?? '?') + ' 集「' + (ep.title || '未命名') + '」'
    try {
      await ElMessageBox.confirm('确定删除 ' + label + '？此操作不可恢复。', '删除确认', {
        type: 'warning', confirmButtonText: '删除该集', cancelButtonText: '取消删除'
      })
    } catch { return }
    deletingEpisodeId.value = ep.id
    try {
      const remaining = toDramaDetailEpisodeSavePayload(episodes.value.filter((e) => e.id !== ep.id))
      await dramaAPI.saveEpisodes(dramaId, remaining)
      ElMessage.success(dramaDetailEpisodeDeletedMessage(label, remaining.length))
      await loadDrama()
      if (remaining.length === 0) scrollToSection?.('episode-list')
    } catch (e) {
      ElMessage.error(dramaDetailUserError(e, '删除失败'))
    } finally {
      deletingEpisodeId.value = null
    }
  }

  return {
    addingEpisode,
    deletingEpisodeId,
    openEpisodeBatchImport,
    onBatchImportEpisodes,
    onDeleteEpisode,
  }
}
