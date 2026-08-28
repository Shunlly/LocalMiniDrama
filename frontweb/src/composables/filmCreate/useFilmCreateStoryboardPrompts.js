import { ElMessage, ElMessageBox } from 'element-plus'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'

export function useFilmCreateStoryboardPrompts(deps = {}) {
  const {
    currentEpisodeId,
    storyboards,
    storyboardsAPI,
    loadDrama,
    refreshStoryboardsOnly,
    editingSbImagePromptId,
    editingSbImagePromptText,
    sbPromptTarget,
    sbPromptImageText,
    sbPromptPolishedText,
    sbPromptVideoText,
    showSbPromptDialog,
    sbPromptPolishing,
    sbPromptSaving,
    editingSbVideoPromptId,
    editingSbVideoPromptText,
    sbTitle,
    sbLocation,
    sbTime,
    sbDuration,
    sbAction,
    sbDialogue,
    sbNarration,
    sbAtmosphere,
    sbResult,
    sbAngle,
    sbAngleH,
    sbAngleV,
    sbAngleS,
    sbMovement,
    sbLighting,
    sbDof,
    sbShotType,
    sbLayoutDescription,
    sbCreationMode,
    sbUniversalSegmentText,
    sbVideoReferenceImageId,
    regeneratingLayoutSbIds,
    inferringParams,
    videoParamsTarget,
    showVideoParamsDialog,
    videoParamsSaving,
    splitByAudioLoading,
  } = deps

  function onEditSbImagePrompt(sb) {
    if (!sb?.id) return
    editingSbImagePromptId.value = sb.id
    editingSbImagePromptText.value = (sb.image_prompt || '').toString()
  }

  async function onOpenSbPromptDialog(sb) {
    if (!sb?.id) return
    sbPromptTarget.value = sb
    sbPromptImageText.value = (sb.image_prompt || '').toString()
    sbPromptPolishedText.value = (sb.polished_prompt || '').toString()
    const rawVideo = (sb.video_prompt || '').toString()
    sbPromptVideoText.value = formatVideoPromptForEdit(rawVideo)
    showSbPromptDialog.value = true
    try {
      const fresh = await storyboardsAPI.get(sb.id)
      if (fresh?.id) {
        sbPromptTarget.value = fresh
        sbPromptImageText.value = (fresh.image_prompt || '').toString()
        sbPromptPolishedText.value = (fresh.polished_prompt || '').toString()
        sbPromptVideoText.value = formatVideoPromptForEdit((fresh.video_prompt || '').toString())
      }
    } catch (_) {}
  }

  function formatVideoPromptForEdit(text) {
    if (!text) return ''
    // 按「主体：」「运动：」等分段做换行，方便阅读
    return text
      .replace(/([。；])\s*(主体|运动|环境|运镜|美学|声音|时长)：/g, '$1\n$2：')
      .replace(/^\s+|\s+$/g, '')
  }

  async function onPolishSbPrompt() {
    const sb = sbPromptTarget.value
    if (!sb?.id) return
    sbPromptPolishing.value = true
    try {
      const res = await storyboardsAPI.polishPrompt(sb.id)
      if (res?.polished_prompt) {
        sbPromptPolishedText.value = res.polished_prompt
        ElMessage.success('通用优化提示词已生成')
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '生成失败，请检查文本模型配置'))
    } finally {
      sbPromptPolishing.value = false
    }
  }

  async function onSaveSbPromptDialog() {
    const sb = sbPromptTarget.value
    if (!sb?.id) return
    sbPromptSaving.value = true
    try {
      const normalizedVideo = (sbPromptVideoText.value || '').replace(/\s+/g, ' ').trim()
      await storyboardsAPI.update(sb.id, {
        image_prompt: sbPromptImageText.value.trim() || null,
        polished_prompt: sbPromptPolishedText.value.trim() || null,
        video_prompt: normalizedVideo || null,
      })
      await loadDrama()
      showSbPromptDialog.value = false
      ElMessage.success('提示词已保存')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    } finally {
      sbPromptSaving.value = false
    }
  }

  async function onSaveSbImagePrompt(sb) {
    if (!sb?.id) return
    try {
      await storyboardsAPI.update(sb.id, { image_prompt: (editingSbImagePromptText.value || '').toString().trim() || null })
      await loadDrama()
      editingSbImagePromptId.value = null
      ElMessage.success('图片提示词已保存')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    }
  }

  function onEditSbVideoPrompt(sb) {
    if (!sb?.id) return
    editingSbVideoPromptId.value = sb.id
    editingSbVideoPromptText.value = (sb.video_prompt || '').toString()
  }

  /** 将结构化视角三元组转为英文描述片段 + 中文标签（与 angleService.js 保持一致） */
  function angleToPromptFragment(h, v, s) {
    const hDesc = { front:'shooting from the front', front_left:'shooting from front-left at 45-degree angle', left:'shooting from the left side, profile view', back_left:'shooting from back-left at 135-degree angle', back:"shooting from behind, character's back to camera", back_right:'shooting from back-right at 135-degree angle', right:'shooting from the right side, profile view', front_right:'shooting from front-right at 45-degree angle' }
    const vDesc = { worm:"extreme low-angle worm's eye view, camera near ground pointing sharply upward, strong upward perspective distortion, background shows sky/ceiling", low:'low-angle upward shot, camera below eye-line, slight upward tilt, empowering perspective', eye_level:'eye-level shot, neutral perspective, natural horizontal framing', high:"high-angle bird's eye view, camera above looking down, background shows floor/ground with downward perspective distortion" }
    const sDesc = { close_up:'close-up shot (face/bust framing), subject fills most of frame, shallow depth of field, background softly blurred', medium:'medium shot (waist-up to full body), character and immediate surroundings visible, moderate depth of field', wide:'wide shot (full body with environment), subject small relative to scene, deep depth of field, environment context prominent' }
    const hLabel = { front:'正面', front_left:'前左', left:'左侧', back_left:'后左', back:'背面', back_right:'后右', right:'右侧', front_right:'前右' }
    const vLabel = { worm:'虫眼仰', low:'仰拍', eye_level:'平视', high:'俯拍' }
    const sLabel = { close_up:'特写', medium:'中景', wide:'远景' }
    const fragment = [sDesc[s] || sDesc.medium, vDesc[v] || vDesc.eye_level, hDesc[h] || hDesc.front].join(', ')
    const label = `${sLabel[s] || '中景'}·${vLabel[v] || '平视'}·${hLabel[h] || '正面'}`
    return { fragment, label }
  }

  async function onSaveSbVideoFields(sb) {
    if (!sb?.id) return
    try {
      await storyboardsAPI.update(sb.id, {
        title: (sbTitle.value[sb.id] || '').toString().trim() || null,
        location: (sbLocation.value[sb.id] || '').toString().trim() || null,
        time: (sbTime.value[sb.id] || '').toString().trim() || null,
        duration: Number(sbDuration.value[sb.id]) || 5,
        action: (sbAction.value[sb.id] || '').toString().trim() || null,
        dialogue: (sbDialogue.value[sb.id] || '').toString().trim() || null,
        narration: (sbNarration.value[sb.id] || '').toString().trim() || null,
        atmosphere: (sbAtmosphere.value[sb.id] || '').toString().trim() || null,
        result: (sbResult.value[sb.id] || '').toString().trim() || null,
        angle: (sbAngle.value[sb.id] || '').toString().trim() || null,
        angle_h: sbAngleH.value[sb.id] || null,
        angle_v: sbAngleV.value[sb.id] || null,
        angle_s: sbAngleS.value[sb.id] || null,
        movement: (sbMovement.value[sb.id] || '').toString().trim() || null,
        lighting_style: sbLighting.value[sb.id] || null,
        depth_of_field: sbDof.value[sb.id] || null,
        shot_type: (sbShotType.value[sb.id] || '').toString().trim() || null,
        layout_description: (sbLayoutDescription.value[sb.id] || '').toString().trim() || null,
        creation_mode: sbCreationMode.value[sb.id] === 'universal' ? 'universal' : 'classic',
        universal_segment_text: (sbUniversalSegmentText.value[sb.id] || '').toString().trim() || null,
        video_reference_image_id: sbVideoReferenceImageId.value[sb.id] || null,
      })
      const rebuilt = await storyboardsAPI.rebuildVideoPrompt(sb.id)
      const newVp = (rebuilt?.video_prompt && String(rebuilt.video_prompt).trim()) || ''
      if (newVp) {
        videoParamsTarget.value = { ...sb, video_prompt: newVp }
      }
      await loadDrama()
      ElMessage.success('已保存，视频提示词已按最新规则自动生成')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    }
  }

  async function onSaveSbVideoPrompt(sb) {
    if (!sb?.id) return
    try {
      await storyboardsAPI.update(sb.id, { video_prompt: (editingSbVideoPromptText.value || '').toString().trim() || null })
      await loadDrama()
      editingSbVideoPromptId.value = null
      ElMessage.success('视频提示词已保存')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    }
  }

  function onOpenVideoParamsDialog(sb) {
    videoParamsTarget.value = sb
    showVideoParamsDialog.value = true
  }

  /** 取消关闭弹窗时，将创作模式与片段描述与服务器状态对齐（避免仅改单选未保存导致本地漂移） */
  function onVideoParamsDialogClosed() {
    const sb = videoParamsTarget.value
    if (!sb?.id) return
    const row = (storyboards.value || []).find((x) => Number(x.id) === Number(sb.id))
    if (!row) return
    sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: row.creation_mode === 'universal' ? 'universal' : 'classic' }
    sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: (row.universal_segment_text ?? '').toString() }
    sbVideoReferenceImageId.value = {
      ...sbVideoReferenceImageId.value,
      [sb.id]: row.video_reference_image_id ? Number(row.video_reference_image_id) : '',
    }
  }

  function countDialogueLinesInSb(sb) {
    const raw = ((sbDialogue.value[sb.id] ?? sb.dialogue) || '').toString().trim()
    if (!raw) return 0
    const matches = raw.match(/[\u4e00-\u9fa5A-Za-z0-9·]{1,16}[：:]/g)
    return matches?.length || (raw ? 1 : 0)
  }

  function canSplitSbByAudio(sb) {
    if (!sb?.id) return false
    const dialogueCount = countDialogueLinesInSb(sb)
    const hasNarration = !!((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
    return dialogueCount + (hasNarration ? 1 : 0) >= 2
  }

  async function onSplitSbByAudio(sb) {
    if (!sb?.id) return
    try {
      await ElMessageBox.confirm(
        '将把本镜按「每句对白一条 + 旁白单独一条」拆成多个分镜，原镜变为第一条。已生成的视频不会保留。是否继续？',
        '按对白拆镜',
        { type: 'warning', confirmButtonText: '拆镜', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
    splitByAudioLoading.value = true
    try {
      if (showVideoParamsDialog.value && videoParamsTarget.value?.id === sb.id) {
        await onSaveSbVideoFields(sb)
      }
      const res = await storyboardsAPI.splitByAudio(sb.id)
      const n = res?.storyboard_ids?.length ?? 0
      const summary = res?.plans_summary || ''
      showVideoParamsDialog.value = false
      await loadDrama()
      ElMessage.success(summary ? `已拆成 ${n} 条：${summary}` : `已拆成 ${n} 条分镜`)
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '拆镜失败'))
    } finally {
      splitByAudioLoading.value = false
    }
  }

  async function onSaveVideoParams() {
    const sb = videoParamsTarget.value
    if (!sb?.id) return
    videoParamsSaving.value = true
    try {
      await onSaveSbVideoFields(sb)
      showVideoParamsDialog.value = false
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    } finally {
      videoParamsSaving.value = false
    }
  }

  async function onBatchInferParams() {
    if (!currentEpisodeId.value) return
    inferringParams.value = true
    try {
      const res = await storyboardsAPI.batchInferParams(currentEpisodeId.value, false)
      await loadDrama()
      ElMessage.success(`摄影参数推断完成，更新了 ${res?.updated ?? 0} 条分镜`)
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '推断失败'))
    } finally {
      inferringParams.value = false
    }
  }

  /** 一键用 AI 重新生成/优化本分镜的布局描述（自动参考上下分镜保证前后连贯） */
  async function onRegenerateLayoutDescription(sb) {
    if (sb && typeof sb === 'object' && sb.__v_isRef) sb = sb.value
    if (!sb?.id) return
    regeneratingLayoutSbIds.add(sb.id)
    try {
      const res = await storyboardsAPI.regenerateLayoutDescription(sb.id)
      const newText = res?.layout_description || res?.data?.layout_description
      if (newText) {
        // 直接用本次 AI 返回的结果更新本地编辑状态（响应里已包含新文本）
        sbLayoutDescription.value = { ...sbLayoutDescription.value, [sb.id]: newText }

        // 轻量刷新分镜列表（只更新 store 里的原始 storyboards，不触发 syncStoryboardStateFromEpisode，
        // 避免覆盖我们刚刚写入的 sbLayoutDescription 等本地字段）
        try { await refreshStoryboardsOnly() } catch (_) {}

        ElMessage.success('布局描述已由 AI 重新优化并保存（已参考上下分镜连贯性）')
        // 注意：不再调用 loadDrama()，因为它会全量重建所有 sbXxx 映射，可能用服务端旧数据覆盖本次结果。
        // 等后端 rowToStoryboard 补全 layout_description 字段后，关闭再打开对话框即可看到持久化值。
      } else {
        ElMessage.warning('AI 未返回有效的布局描述')
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '重新生成布局描述失败'))
    } finally {
      regeneratingLayoutSbIds.delete(sb.id)
    }
  }

  return {
    onEditSbImagePrompt,
    onOpenSbPromptDialog,
    formatVideoPromptForEdit,
    onPolishSbPrompt,
    onSaveSbPromptDialog,
    onSaveSbImagePrompt,
    onEditSbVideoPrompt,
    angleToPromptFragment,
    onSaveSbVideoFields,
    onSaveSbVideoPrompt,
    onOpenVideoParamsDialog,
    onVideoParamsDialogClosed,
    countDialogueLinesInSb,
    canSplitSbByAudio,
    onSplitSbByAudio,
    onSaveVideoParams,
    onBatchInferParams,
    onRegenerateLayoutDescription,
  }
}
