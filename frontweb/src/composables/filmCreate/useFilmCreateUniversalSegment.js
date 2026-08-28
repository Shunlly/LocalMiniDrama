import { ElMessage } from 'element-plus'

export function useFilmCreateUniversalSegment(deps = {}) {
  const {
    store,
    storyboardsAPI,
    generatingUniversalSegmentIds,
    sbUniversalSegmentText,
    sbUniversalSegmentTrimmed,
    universalSegmentDurationSecForSb,
    isSbUniversalMode,
    storyboardUniversalOmni,
    universalOmniPolishRunning,
    universalOmniPolishAbort,
    universalOmniPolishProgress,
    pipelineRest,
    onSaveUniversalSegmentField,
    // 未注入编辑区 ref 时回退为空对象，避免生成路径抛出英文 ReferenceError
    sbTitle = { value: {} },
    sbLocation = { value: {} },
    sbTime = { value: {} },
    sbAction = { value: {} },
    sbDialogue = { value: {} },
    sbNarration = { value: {} },
    sbResult = { value: {} },
    sbAtmosphere = { value: {} },
    sbShotType = { value: {} },
    sbMovement = { value: {} },
    sbLayoutDescription = { value: {} },
  } = deps

  function buildUniversalSegmentFieldOverrides(sb) {
    if (!sb?.id) return {}
    const id = sb.id
    const trimOrNull = (v) => {
      const s = (v ?? '').toString().trim()
      return s || null
    }
    return {
      title: trimOrNull(sbTitle.value[id] ?? sb.title),
      description: trimOrNull(sb.description),
      location: trimOrNull(sbLocation.value[id] ?? sb.location),
      time: trimOrNull(sbTime.value[id] ?? sb.time),
      action: trimOrNull(sbAction.value[id] ?? sb.action),
      dialogue: trimOrNull(sbDialogue.value[id] ?? sb.dialogue),
      narration: trimOrNull(sbNarration.value[id] ?? sb.narration),
      result: trimOrNull(sbResult.value[id] ?? sb.result),
      atmosphere: trimOrNull(sbAtmosphere.value[id] ?? sb.atmosphere),
      shot_type: trimOrNull(sbShotType.value[id] ?? sb.shot_type),
      movement: trimOrNull(sbMovement.value[id] ?? sb.movement),
      layout_description: trimOrNull(sbLayoutDescription.value[id] ?? sb.layout_description),
    }
  }

  /** 全能片段：@图片N 转 Grok 占位符 <IMAGE_N> */
  function universalSegmentAtImageToGrokTags(text) {
    return (text || '').replace(/@图片(\d+)/g, '<IMAGE_$1>')
  }

  function onUniversalSegmentToGrokVideoTags(sb) {
    if (!sb?.id) return
    const raw = (sbUniversalSegmentText.value[sb.id] ?? '').toString()
    if (!raw.trim()) {
      ElMessage.warning('请先填写或生成片段描述')
      return
    }
    const next = universalSegmentAtImageToGrokTags(raw)
    if (next === raw) {
      ElMessage.info('未找到 @图片N 标记，无需转换')
      return
    }
    sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: next }
    void onSaveUniversalSegmentField(sb)
    ElMessage.success('已改为 Grok 视频占位符格式（<IMAGE_N>）')
  }

  function onUniversalSegmentPromptMenu(sb, cmd) {
    if (cmd === 'generate') onGenerateUniversalSegmentPrompt(sb, {})
    else if (cmd === 'generate-force') onGenerateUniversalSegmentPrompt(sb, { forceWithoutReferenceImages: true })
    else if (cmd === 'polish') onPolishUniversalSegmentPromptStream(sb, {})
    else if (cmd === 'polish-force') onPolishUniversalSegmentPromptStream(sb, { forceWithoutReferenceImages: true })
    else if (cmd === 'to-grok-video-tags') onUniversalSegmentToGrokVideoTags(sb)
  }

  /** 全能模式：根据当前分镜结构化字段流式生成片段描述（NDJSON） */
  async function onGenerateUniversalSegmentPrompt(sb, opts = {}) {
    if (!sb?.id || generatingUniversalSegmentIds.has(sb.id)) return
    const force = !!opts.forceWithoutReferenceImages
    generatingUniversalSegmentIds.add(sb.id)
    let live = ''
    try {
      const durationSec = universalSegmentDurationSecForSb(sb)
      const data = await storyboardsAPI.generateUniversalSegmentPromptStream(
        sb.id,
        {
          duration: durationSec,
          field_overrides: buildUniversalSegmentFieldOverrides(sb),
          ...(force ? { force_without_reference_images: true } : {}),
        },
        (delta) => {
          live += delta
          sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: live }
        }
      )
      const text = (data?.universal_segment_text ?? '').toString().trim()
      if (!text) {
        ElMessage.warning('未收到完整生成结果，请重试')
        return
      }
      sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: text }
      const list = store.currentEpisode?.storyboards
      if (Array.isArray(list)) {
        const row = list.find((x) => Number(x.id) === Number(sb.id))
        if (row) row.universal_segment_text = text
      }
      ElMessage.success(force ? '已强制生成全能片段提示词（无图模式）' : '已根据分镜生成全能片段提示词')
    } catch (e) {
      ElMessage.error(e.message || '生成失败，请检查文本模型配置')
    } finally {
      generatingUniversalSegmentIds.delete(sb.id)
    }
  }

  /** 全能模式：结合剧本与邻镜流式润色片段描述（服务端 NDJSON） */
  async function onPolishUniversalSegmentPromptStream(sb, opts = {}) {
    if (!sb?.id || generatingUniversalSegmentIds.has(sb.id)) return
    const force = !!opts.forceWithoutReferenceImages
    const draft = sbUniversalSegmentTrimmed(sb)
    if (!draft) {
      ElMessage.warning('请先填写或生成片段描述后再润色')
      return
    }
    generatingUniversalSegmentIds.add(sb.id)
    let live = ''
    try {
      const durationSec = universalSegmentDurationSecForSb(sb)
      const data = await storyboardsAPI.polishUniversalSegmentPromptStream(
        sb.id,
        {
          duration: durationSec,
          draft_universal_segment_text: draft,
          field_overrides: buildUniversalSegmentFieldOverrides(sb),
          ...(force ? { force_without_reference_images: true } : {}),
        },
        (delta) => {
          live += delta
          sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: live }
        }
      )
      const text = (data?.universal_segment_text ?? '').toString().trim()
      if (!text) {
        ElMessage.warning('未收到完整润色结果，请重试')
        return
      }
      sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: text }
      const list = store.currentEpisode?.storyboards
      if (Array.isArray(list)) {
        const row = list.find((x) => Number(x.id) === Number(sb.id))
        if (row) row.universal_segment_text = text
      }
      ElMessage.success(force ? '全能片段已强制润色并保存（无图模式）' : '全能片段提示词已润色并保存')
    } catch (e) {
      ElMessage.error(e.message || '润色失败，请检查文本模型配置')
    } finally {
      generatingUniversalSegmentIds.delete(sb.id)
    }
  }

  /**
   * 分镜脚本生成完成后：按镜序逐个流式润色全能片段（服务端已落库）。
   * @param {{ checkPause?: () => Promise<void>, onShotProgress?: (cur:number,total:number,sb:object)=>void, onShotError?: (sb:object,msg:string)=>void }} opts
   */
  async function polishUniversalSegmentsAfterGeneration(opts = {}) {
    const checkPause = typeof opts.checkPause === 'function' ? opts.checkPause : async () => {}
    const onShotProgress = typeof opts.onShotProgress === 'function' ? opts.onShotProgress : null
    const onShotError = typeof opts.onShotError === 'function' ? opts.onShotError : null

    if (!storyboardUniversalOmni.value) return { polished: 0, skipped: true }

    const rawList = store.currentEpisode?.storyboards || []
    const list = rawList.slice().sort((a, b) => (Number(a.storyboard_number) || 0) - (Number(b.storyboard_number) || 0))
    const targets = list.filter((sb) => sb?.id && isSbUniversalMode(sb.id) && sbUniversalSegmentTrimmed(sb))

    if (!targets.length) return { polished: 0, skipped: true }

    universalOmniPolishRunning.value = true
    universalOmniPolishAbort.value = false
    universalOmniPolishProgress.value = { current: 0, total: targets.length, label: '' }
    let polished = 0
    try {
      for (let i = 0; i < targets.length; i++) {
        if (universalOmniPolishAbort.value) break
        await checkPause()
        const sb = targets[i]
        const cur = i + 1
        const label = '#' + (sb.storyboard_number ?? cur) + (sb.title ? ' ' + String(sb.title).slice(0, 20) : '')
        universalOmniPolishProgress.value = { current: cur, total: targets.length, label }
        if (onShotProgress) onShotProgress(cur, targets.length, sb)

        const draft = sbUniversalSegmentTrimmed(sb)
        if (!draft) continue

        generatingUniversalSegmentIds.add(sb.id)
        let live = ''
        try {
          const durationSec = universalSegmentDurationSecForSb(sb)
          const data = await storyboardsAPI.polishUniversalSegmentPromptStream(
            sb.id,
            {
              duration: durationSec,
              draft_universal_segment_text: draft,
              field_overrides: buildUniversalSegmentFieldOverrides(sb),
              force_without_reference_images: true,
            },
            (delta) => {
              live += delta
              sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: live }
            }
          )
          const text = (data?.universal_segment_text ?? '').toString().trim()
          if (text) {
            polished += 1
            sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: text }
            const storyList = store.currentEpisode?.storyboards
            if (Array.isArray(storyList)) {
              const row = storyList.find((x) => Number(x.id) === Number(sb.id))
              if (row) row.universal_segment_text = text
            }
          }
        } catch (e) {
          const msg = e?.message || String(e)
          if (onShotError) onShotError(sb, msg)
          else ElMessage.warning(`分镜 #${sb.storyboard_number ?? sb.id} 全能润色失败：${msg}`)
        } finally {
          generatingUniversalSegmentIds.delete(sb.id)
        }
        await pipelineRest()
      }
    } finally {
      universalOmniPolishRunning.value = false
      universalOmniPolishProgress.value = { current: 0, total: 0, label: '' }
    }
    return { polished, skipped: false }
  }

  return {
    buildUniversalSegmentFieldOverrides,
    universalSegmentAtImageToGrokTags,
    onUniversalSegmentToGrokVideoTags,
    onUniversalSegmentPromptMenu,
    onGenerateUniversalSegmentPrompt,
    onPolishUniversalSegmentPromptStream,
    polishUniversalSegmentsAfterGeneration,
  }
}
