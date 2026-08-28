import { nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { episodesListToPlainScript, parseScriptIntoEpisodes } from '@/utils/scriptEpisodes'

export function useFilmCreateScriptWorkspace(deps = {}) {
  const {
    store,
    dramaAPI,
    router,
    route,
    loadDrama,
    scrollToAnchor,
    saveScriptToBackend,
    flushScriptDraft,
    markScriptDraftSaved,
    trackFilmCreateAction,
    scriptTitle,
    scriptContent,
    scriptGenerating,
    savedCurrentEpisodeNumber,
    selectedEpisodeId,
    selectPreviewEpisodeId,
    showSelectScriptDialog,
    scriptWorkbenchMode,
    showCharLibrary,
    resourcePanelCollapsed,
    charactersBlockCollapsed,
    selectScriptLoading,
    selectScriptDramas,
    selectScriptImporting,
    novelText,
    novelFileName,
    novelFileContent,
    novelImportMode,
    novelImporting,
    novelMaxChapters,
    novelAiSummarize,
    showNovelImport,
  } = deps

  function openSelectScriptDialog() {
    showSelectScriptDialog.value = true
  }

  async function returnToScriptCreation() {
    showSelectScriptDialog.value = false
    scriptWorkbenchMode.value = 'create'
    await nextTick()
    scrollToAnchor('anchor-script')
  }

  async function returnToCharacterPanel() {
    showCharLibrary.value = false
    resourcePanelCollapsed.value = false
    charactersBlockCollapsed.value = false
    await nextTick()
    scrollToAnchor('anchor-characters')
  }

  async function loadSelectScriptList() {
    selectScriptLoading.value = true
    try {
      const res = await dramaAPI.list({ page: 1, page_size: 100 })
      const items = res?.items ?? []
      selectScriptDramas.value = items.filter((d) => d?.metadata?.script_template === true)
    } catch {
      selectScriptDramas.value = []
    } finally {
      selectScriptLoading.value = false
    }
  }

  /**
   * 将源剧本的梗概 + 各集剧本写入当前工程（不跳转、不导入角色/分镜/视频）。
   * 在「新建故事」且尚未落库时，会创建新项目并跳转。
   */
  async function onPickScriptFromDialog(sourceId) {
    if (!sourceId || selectScriptImporting.value) return
    const srcNum = Number(sourceId)
    const routeId = route.params.id
    const targetFromRoute = routeId && routeId !== 'new' ? Number(routeId) : null
    const targetId = store.dramaId ?? targetFromRoute ?? null

    if (targetId != null && Number(targetId) === srcNum) {
      ElMessage.info('当前打开的就是该项目')
      return
    }

    if (targetId != null) {
      try {
        await ElMessageBox.confirm(
          '将把所选剧本的「故事梗概」与「各集剧本正文」写入当前工程。不会导入角色、场景、分镜与视频。若源剧本集数更少，多出来的分集将从本工程移除（原分镜可能失效）。是否继续？',
          '导入剧本到当前工程',
          { type: 'warning', confirmButtonText: '导入', cancelButtonText: '取消' }
        )
      } catch {
        return
      }
    }

    selectScriptImporting.value = true
    try {
      const src = await dramaAPI.get(srcNum)
      const rawEps = [...(src.episodes || [])].sort(
        (a, b) => (Number(a.episode_number) || 0) - (Number(b.episode_number) || 0)
      )
      const summary = (src.description || '').toString().trim()
      const episodesPayload = rawEps.map((ep, i) => ({
        episode_number: ep.episode_number != null ? Number(ep.episode_number) : i + 1,
        title: (ep.title || '').toString(),
        script_content: ep.script_content ?? '',
        description: ep.description ?? null,
        duration: ep.duration ?? 0,
      }))

      if (!targetId) {
        if (episodesPayload.length === 0 && !summary) {
          ElMessage.warning('所选剧本没有可导入的梗概或分集正文')
          return
        }
        const title = (src.title || '新故事').toString().trim() || '新故事'
        const created = await dramaAPI.create({
          title,
          description: summary || undefined,
          metadata: {},
        })
        const workId = created.id
        store.setDrama({ id: workId })
        if (episodesPayload.length > 0) {
          await dramaAPI.saveEpisodes(workId, episodesPayload)
        }
        if (summary) {
          await dramaAPI.saveOutline(workId, { summary }).catch(() => {})
        }
        showSelectScriptDialog.value = false
        router.replace('/film/' + workId)
        ElMessage.success('已根据所选剧本创建项目并导入梗概与正文')
        scriptWorkbenchMode.value = 'select'
        return
      }

      if (summary) {
        await dramaAPI.saveOutline(targetId, { summary }).catch(() => {})
      }
      if (episodesPayload.length > 0) {
        await dramaAPI.saveEpisodes(targetId, episodesPayload)
      } else if (!summary) {
        ElMessage.warning('所选剧本没有可导入的梗概或分集正文')
        return
      }

      showSelectScriptDialog.value = false
      await loadDrama()
      ElMessage.success('已导入故事梗概与剧本（当前工程未切换）')
      scriptWorkbenchMode.value = 'select'
    } catch (e) {
      ElMessage.error(e.message || '导入失败')
    } finally {
      selectScriptImporting.value = false
    }
  }

  watch(
    () => [store.drama?.episodes, selectedEpisodeId.value],
    () => {
      const eps = store.drama?.episodes || []
      if (eps.length > 1) {
        const cur = selectedEpisodeId.value
        const hit = cur != null && eps.some((e) => Number(e.id) === Number(cur))
        selectPreviewEpisodeId.value = hit ? String(cur) : String(eps[0].id)
      } else {
        selectPreviewEpisodeId.value = ''
      }
    },
    { deep: true, immediate: true }
  )

  function novelImportReset() {
    novelText.value = ''
    novelFileName.value = ''
    novelFileContent.value = ''
  }

  function onNovelFileChange(file) {
    novelFileName.value = file.name
    const reader = new FileReader()
    reader.onload = (ev) => { novelFileContent.value = ev.target.result }
    reader.readAsText(file.raw || file, 'utf-8')
  }

  async function onImportNovel() {
    const text = novelImportMode.value === 'file' ? novelFileContent.value : novelText.value
    if (!text?.trim()) {
      ElMessage.warning('请输入或上传小说内容')
      return
    }
    novelImporting.value = true
    try {
      const formData = new FormData()
      if (novelImportMode.value === 'file' && novelFileContent.value) {
        const blob = new Blob([novelFileContent.value], { type: 'text/plain' })
        formData.append('file', blob, novelFileName.value || 'novel.txt')
      } else {
        formData.append('text', text)
      }
      formData.append('title', scriptTitle.value || '导入小说')
      formData.append('max_chapters', String(novelMaxChapters.value))
      formData.append('ai_summarize', String(novelAiSummarize.value))
      if (store.dramaId) {
        formData.append('drama_id', String(store.dramaId))
        formData.append('start_workflow', 'false')
      }
      const { default: axios } = await import('axios')
      const baseURL = (await import('@/utils/request')).default.defaults.baseURL || '/api/v1'
      const res = await axios.post(`${baseURL}/dramas/import-novel`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      let chapters = res.data?.data?.chapters || res.data?.chapters || []
      if (!chapters.length) {
        ElMessage.warning('未能识别到章节内容')
        return
      }
      // 若后端只识别出 1 章，但正文里有多处「第N集」行首标题，用前端规则再拆（与保存剧本一致）
      const clientParsed = parseScriptIntoEpisodes(text)
      if (clientParsed.split && clientParsed.episodes.length > chapters.length) {
        chapters = clientParsed.episodes.map((e, i) => ({
          index: i + 1,
          title: e.title,
          content: e.script_content,
          script: e.script_content,
        }))
      }
      const toEpisodeRow = (ch, i) => ({
        episode_number: i + 1,
        title: (ch.title && String(ch.title).trim()) || '第' + (i + 1) + '集',
        script_content: String(ch.script ?? ch.content ?? '').trimEnd(),
        description: null,
        duration: 0,
      })
      const rows = chapters.map(toEpisodeRow)
      const plainScript = episodesListToPlainScript(
        rows.map((r) => ({ title: r.title, script_content: r.script_content }))
      )
      if (store.dramaId && rows.length >= 2) {
        await dramaAPI.saveEpisodes(store.dramaId, rows)
        await loadDrama()
        ElMessage.success(`已导入并拆分为 ${rows.length} 集`)
      } else {
        store.setScriptContent(plainScript || rows[0]?.script_content || '')
        ElMessage.success(
          rows.length >= 2
            ? `已导入 ${rows.length} 个章节（保存剧本时将写入多集）`
            : `成功导入 ${rows.length} 个章节，请继续编辑剧本`
        )
      }
      showNovelImport.value = false
      novelImportReset()
    } catch (e) {
      ElMessage.error(e.message || '导入失败')
    } finally {
      novelImporting.value = false
    }
  }

  async function onGenerateScript() {
    trackFilmCreateAction('save_script_click')
    const content = (scriptContent.value ?? store.scriptContent ?? '').toString().trim()
    if (!content) {
      ElMessage.warning('请先在「故事生成」中点击 AI 生成，或手动输入剧本内容')
      return
    }
    scriptGenerating.value = true
    try {
      await flushScriptDraft()
      const result = await saveScriptToBackend(content)
      if (result?.created) {
        ElMessage.success('项目已创建，剧本已保存')
      } else {
        ElMessage.success('剧本已保存')
      }
      markScriptDraftSaved()
      trackFilmCreateAction('save_script_complete', {
        extra: { created_project: !!result?.created },
      })
    } catch (e) {
      ElMessage.error(e.message || '保存失败')
    } finally {
      scriptGenerating.value = false
    }
  }

  async function onAddEpisode() {
    if (!store.dramaId) return
    const list = store.drama?.episodes || []
    const nextNum = list.length > 0
      ? Math.max(...list.map((e) => Number(e.episode_number) || 0), 0) + 1
      : 1
    const updated = list.map((ep, i) => ({
      episode_number: ep.episode_number ?? i + 1,
      title: ep.title || '第' + (ep.episode_number ?? i + 1) + '集',
      script_content: ep.script_content || '',
      description: ep.description,
      duration: ep.duration
    }))
    updated.push({
      episode_number: nextNum,
      title: '第' + nextNum + '集',
      script_content: '',
      description: null,
      duration: 0
    })
    try {
      await dramaAPI.saveEpisodes(store.dramaId, updated)
      savedCurrentEpisodeNumber.value = nextNum
      await loadDrama()
      ElMessage.success('已添加第' + nextNum + '集')
    } catch (e) {
      ElMessage.error(e.message || '添加失败')
    }
  }

  return {
    openSelectScriptDialog,
    returnToScriptCreation,
    returnToCharacterPanel,
    loadSelectScriptList,
    onPickScriptFromDialog,
    novelImportReset,
    onNovelFileChange,
    onImportNovel,
    onGenerateScript,
    onAddEpisode,
  }
}
