import { computed, ref } from 'vue'
import { formatEpisodeContextLabel } from '@/utils/filmCreateContext'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'

/** 剧本工作台、小说导入、当前集选择等页面本地状态（不含已有工作台动作入口） */
export const FILM_CREATE_SCRIPT_NOVEL_REF_KEYS = [
  'storyInput',
  'storyStyle',
  'storyType',
  'storyEpisodeCount',
  'storyGenerating',
  'scriptWorkbenchMode',
  'showSelectScriptDialog',
  'selectScriptLoading',
  'selectScriptImporting',
  'selectScriptDramas',
  'selectPreviewEpisodeId',
  'showNovelImport',
  'novelImportMode',
  'novelText',
  'novelFileName',
  'novelFileContent',
  'novelMaxChapters',
  'novelAiSummarize',
  'novelImporting',
  'scriptTitle',
  'selectedEpisodeId',
  'episodeSwitching',
  'savedCurrentEpisodeNumber',
  'scriptLanguage',
  'scriptStoryboardStyle',
  'scriptGenerating',
  'scriptDraftStatus',
]

export function snapshotFilmCreateScriptNovelState(state) {
  const snapshot = {}
  for (const key of FILM_CREATE_SCRIPT_NOVEL_REF_KEYS) {
    const value = state?.[key]?.value
    snapshot[key] = Array.isArray(value) ? [...value] : value
  }
  return snapshot
}

export function applyFilmCreateScriptNovelStateSnapshot(state, snapshot = {}) {
  for (const key of FILM_CREATE_SCRIPT_NOVEL_REF_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue
    const value = snapshot[key]
    state[key].value = Array.isArray(value) ? [...value] : value
  }
}

export function useFilmCreateScriptNovelState({ store, genStore } = {}) {
  const storyInput = ref('')
  const storyStyle = ref('')
  const storyType = ref('')
  const storyEpisodeCount = ref(1)
  const storyGenerating = ref(false)
  /** 剧本工作台：create 创作 | select 选择预览 */
  const scriptWorkbenchMode = ref('create')
  const showSelectScriptDialog = ref(false)
  const selectScriptLoading = ref(false)
  const selectScriptImporting = ref(false)
  const selectScriptDramas = ref([])
  /** 选择剧本弹窗列表：排除当前打开的项目，避免误点「导入」到自身 */
  const selectableScriptDramas = computed(() => {
    const cur = store?.dramaId
    const list = selectScriptDramas.value || []
    if (cur == null) return list
    return list.filter((d) => Number(d.id) !== Number(cur))
  })
  const selectPreviewEpisodeId = ref('')
  const showNovelImport = ref(false)
  const novelImportMode = ref('text')
  const novelText = ref('')
  const novelFileName = ref('')
  const novelFileContent = ref('')
  const novelMaxChapters = ref(10)
  const novelAiSummarize = ref(false)
  const novelImporting = ref(false)
  const scriptTitle = ref('')
  const selectedEpisodeId = ref(null)
  const episodeSwitching = ref(false)
  const selectedEpisodeContextLabel = computed(() => {
    const episodes = store?.drama?.episodes || []
    const index = episodes.findIndex((episode) => (
      Number(episode?.id) === Number(selectedEpisodeId.value)
    ))
    if (index < 0) return '未选择剧集'
    return formatEpisodeContextLabel(episodes[index], index)
  })
  /** 保存剧本后用于恢复选中集（后端重插后 id 会变，用 episode_number 匹配） */
  const savedCurrentEpisodeNumber = ref(1)
  const scriptLanguage = ref('zh')
  const scriptStoryboardStyle = ref('')
  const scriptGenerating = ref(false)
  const scriptDraftStatus = ref('saved')
  const scriptDraftStatusLabel = computed(() => ({
    dirty: '未保存',
    saving: '自动保存中',
    saved: '已保存',
    error: '自动保存失败',
  }[scriptDraftStatus.value] || '已保存'))
  const isStoryGenRunning = computed(() => {
    if (storyGenerating.value || scriptGenerating.value) return true
    const tasks = genStore?.getAllRunningTasks?.() || []
    return tasks.some(
      (t) => Number(t.dramaId) === Number(store?.dramaId) && t.resourceType === GEN_RESOURCE.GENERATE_STORY,
    )
  })

  return {
    storyInput,
    storyStyle,
    storyType,
    storyEpisodeCount,
    storyGenerating,
    scriptWorkbenchMode,
    showSelectScriptDialog,
    selectScriptLoading,
    selectScriptImporting,
    selectScriptDramas,
    selectableScriptDramas,
    selectPreviewEpisodeId,
    showNovelImport,
    novelImportMode,
    novelText,
    novelFileName,
    novelFileContent,
    novelMaxChapters,
    novelAiSummarize,
    novelImporting,
    scriptTitle,
    selectedEpisodeId,
    episodeSwitching,
    selectedEpisodeContextLabel,
    savedCurrentEpisodeNumber,
    scriptLanguage,
    scriptStoryboardStyle,
    scriptGenerating,
    scriptDraftStatus,
    scriptDraftStatusLabel,
    isStoryGenRunning,
  }
}
