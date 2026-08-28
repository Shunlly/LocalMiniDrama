import { ElMessage } from 'element-plus'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'
import { storyboardImageUrl } from '@/utils/mediaUrl'

export function useFilmCreateStoryboardImageGeneration(deps = {}) {
  const {
    dramaId,
    store,
    storyboardsAPI,
    imagesAPI,
    genStore,
    pollTask,
    captureStoryboardMediaRefresh,
    refreshStoryboardMediaForCurrentContext,
    restoreSelectionsFromBackend,
    loadDrama,
    getSelectedStyle,
    getSelectedStylePrompt,
    getSelectedStylePromptZh,
    angleToPromptFragment,
    frameTypeForSlot,
    getSbFirstImage,
    buildSbGenMeta,
    assertStoryboardMediaReady,
    storyboardMediaActionReason,
    projectAspectRatio,
    gridMode,
    storyboardUseFirstLastFrame,
    lastFrameUseFirstLayoutLock,
    sbLocation,
    sbTime,
    sbShotType,
    sbAngleH,
    sbAngleV,
    sbAngleS,
    sbResult,
    sbAction,
    sbAtmosphere,
    sbCharacterIds,
    sbSelectedImgId,
    sbSelectedLastImgId,
    generatingSbImageIds,
    generatingSbFirstImageIds,
    generatingSbLastImageIds,
    showFramePromptEditor,
    editingFramePromptSb,
    editingFramePromptSlot,
    editingFramePromptText,
    editingFramePromptSaving,
    editingFramePromptRegenerating,
  } = deps

  /** 首帧图生提示词（与 onGenerateSbFrameImage 首帧分支一致） */
  function buildFirstFrameImagePrompt(sbId) {
    const sbRow = (store.storyboards || []).find((b) => b.id === sbId)
    return (sbRow?.polished_prompt || sbRow?.image_prompt || sbRow?.description || '').toString().trim()
  }

  function buildLastFrameImagePrompt(sbId) {
    const parts = []
    const loc = (sbLocation.value[sbId] || '').toString().trim()
    const time = (sbTime.value[sbId] || '').toString().trim()
    if (loc) parts.push(time ? loc + '，' + time : loc)
    const shotType = (sbShotType.value[sbId] || '').toString().trim()
    if (shotType) parts.push(shotType)
    const angleH = sbAngleH.value[sbId] || ''
    const angleV = sbAngleV.value[sbId] || ''
    const angleS = sbAngleS.value[sbId] || ''
    if (angleH && angleV && angleS) {
      const { label } = angleToPromptFragment(angleH, angleV, angleS)
      parts.push(label)
    }
    const result = (sbResult.value[sbId] || '').toString().trim()
    const action = (sbAction.value[sbId] || '').toString().trim()
    if (result) parts.push(result)
    else if (action) parts.push(action)
    const atmosphere = (sbAtmosphere.value[sbId] || '').toString().trim()
    if (atmosphere) parts.push(atmosphere)
    const style = getSelectedStylePromptZh() || getSelectedStylePrompt() || ''
    if (style) parts.push(style)
    parts.push('尾帧静止画面，展示动作完成后的最终状态与情绪余韵')
    return parts.join('，')
  }

  /** 从 frame_prompts 表读取已生成的专业帧提示词 */
  async function getCachedFramePromptFromDb(sbId, slot) {
    const frameType = slot === 'last' ? 'last' : 'first'
    try {
      const res = await storyboardsAPI.getFramePrompts(sbId)
      const row = (res?.frame_prompts || []).find((r) => r.frame_type === frameType)
      return row?.prompt?.trim() || ''
    } catch (_) {
      return ''
    }
  }

  /**
   * 首尾帧模式：优先走 framePromptService（专用系统提示词 + 文本 AI），失败则回退字段拼接。
   */
  async function ensureProfessionalFramePrompt(sb, slot, { forceRegenerate = false } = {}) {
    const frameType = slot === 'last' ? 'last' : 'first'
    if (!forceRegenerate) {
      const cached = await getCachedFramePromptFromDb(sb.id, slot)
      if (cached) return cached
    }
    try {
      const genRes = await storyboardsAPI.generateFramePrompt(sb.id, { frame_type: frameType })
      if (!genRes?.task_id) throw new Error('帧提示词任务未创建')
      const pollRes = await pollTask(genRes.task_id)
      if (pollRes?.status !== 'completed') {
        throw new Error(pollRes?.error || '帧提示词生成失败')
      }
      const fromTask = pollRes.result?.response?.single_frame?.prompt
      if (fromTask && String(fromTask).trim()) return String(fromTask).trim()
      const cached2 = await getCachedFramePromptFromDb(sb.id, slot)
      if (cached2) return cached2
    } catch (e) {
      console.warn('[首尾帧] 专业帧提示词生成失败，使用拼接回退', e?.message)
    }
    return slot === 'last' ? buildLastFrameImagePrompt(sb.id) : buildFirstFrameImagePrompt(sb.id)
  }

  /** 打开首尾帧提示词编辑器（显示最终发给AI生图的完整提示词，支持编辑保存） */
  async function openFramePromptEditor(sb, slot) {
    if (!sb?.id) return
    editingFramePromptSb.value = sb
    editingFramePromptSlot.value = slot
    editingFramePromptText.value = ''
    showFramePromptEditor.value = true
    // 异步加载最终发给AI的真实提示词
    try {
      const pro = await ensureProfessionalFramePrompt(sb, slot)
      editingFramePromptText.value = pro || ''
    } catch (e) {
      editingFramePromptText.value = slot === 'last' ? buildLastFrameImagePrompt(sb.id) : buildFirstFrameImagePrompt(sb.id)
    }
  }

  /** 保存编辑后的帧提示词到 frame_prompts 表 */
  async function saveEditingFramePrompt() {
    const sb = editingFramePromptSb.value
    const slot = editingFramePromptSlot.value
    if (!sb?.id || !slot) return
    const text = (editingFramePromptText.value || '').trim()
    if (!text) {
      ElMessage.warning('提示词不能为空')
      return
    }
    editingFramePromptSaving.value = true
    try {
      const frameType = slot === 'last' ? 'last' : 'first'
      await storyboardsAPI.saveFramePrompt(sb.id, frameType, { prompt: text })
      ElMessage.success('提示词已保存，后续生成将使用此版本')
      showFramePromptEditor.value = false
    } catch (e) {
      ElMessage.error(e.message || '保存失败')
    } finally {
      editingFramePromptSaving.value = false
    }
  }

  /** 重新生成专业帧提示词 */
  async function regenerateEditingFramePrompt() {
    const sb = editingFramePromptSb.value
    const slot = editingFramePromptSlot.value
    if (!sb?.id || !slot) return
    editingFramePromptRegenerating.value = true
    try {
      ElMessage.info('正在重新生成专业帧提示词…')
      const fresh = await ensureProfessionalFramePrompt(sb, slot, { forceRegenerate: true })
      editingFramePromptText.value = fresh || ''
      ElMessage.success('已重新生成，可编辑后保存')
    } catch (e) {
      ElMessage.error(e.message || '生成失败')
    } finally {
      editingFramePromptRegenerating.value = false
    }
  }

  // 兼容旧调用
  const showSbFramePromptPreview = openFramePromptEditor

  async function onGenerateSbFrameImage(sb, slot) {
    if (!dramaId.value || !sb?.id) return
    if (storyboardMediaActionReason.value) {
      ElMessage.warning(storyboardMediaActionReason.value)
      return
    }
    const isLast = slot === 'last'
    const loadingSet = isLast ? generatingSbLastImageIds : generatingSbFirstImageIds
    const meta = buildSbGenMeta(
      sb,
      isLast ? GEN_RESOURCE.SB_LAST_IMAGE : GEN_RESOURCE.SB_FIRST_IMAGE,
      isLast ? '尾帧' : '首帧'
    )
    sb.errorMsg = ''
    sb.error_msg = ''
    loadingSet.add(sb.id)
    genStore.markRunning(meta)
    try {
      let idsToSave = sbCharacterIds.value[sb.id]
      if (idsToSave === undefined) {
        const sbRowForChars = (store.storyboards || []).find((b) => b.id === sb.id)
        const charList = Array.isArray(sbRowForChars?.characters) ? sbRowForChars.characters : []
        idsToSave = charList
          .map((c) => Number(typeof c === 'object' && c != null ? c.id : c))
          .filter((n) => Number.isFinite(n))
      }
      const sbRow = (store.storyboards || []).find((b) => b.id === sb.id)
      let prompt = ''
      if (storyboardUseFirstLastFrame.value) {
        // 须在 update(character_ids) 之前读取缓存：后端在角色未变时保留 frame_prompts，但先读可避免旧版误删
        prompt = await ensureProfessionalFramePrompt(sb, isLast ? 'last' : 'first')
      } else if (isLast) {
        prompt = buildLastFrameImagePrompt(sb.id) || sbRow?.image_prompt || sbRow?.description || ''
      } else {
        prompt = sbRow?.polished_prompt || sbRow?.image_prompt || sbRow?.description || ''
      }
      try {
        await storyboardsAPI.update(sb.id, { character_ids: Array.isArray(idsToSave) ? idsToSave : [] })
      } catch (e) {
        ElMessage.warning('保存分镜角色失败')
        return
      }
      // 尾帧可选附带首帧作构图/站位参考（「首帧站位」勾选时；后端亦会按 use_first_frame_layout_lock 兜底）
      let refImagesForCreate = undefined
      const useFirstLayoutLock = isLast && lastFrameUseFirstLayoutLock.value
      if (useFirstLayoutLock) {
        const firstImg = getSbFirstImage(sb.id)
        if (firstImg) {
          const firstUrl = assetImageUrl(firstImg) || firstImg.image_url || firstImg.local_path
          if (firstUrl) {
            refImagesForCreate = [firstUrl]
          }
        }
      }
      assertStoryboardMediaReady()
      const res = await imagesAPI.create({
        storyboard_id: sb.id,
        drama_id: dramaId.value,
        prompt,
        model: undefined,
        style: getSelectedStyle(),
        frame_type: frameTypeForSlot(slot),
        aspect_ratio: projectAspectRatio.value || '16:9',
        reference_images: refImagesForCreate,
        use_first_frame_layout_lock: isLast ? !!lastFrameUseFirstLayoutLock.value : undefined,
      })
      ElMessage.success(isLast ? '尾帧生成任务已提交' : '首帧生成任务已提交')
      if (res?.task_id) {
        const pollRes = await pollTask(res.task_id, captureStoryboardMediaRefresh(sb.id), meta)
        if (pollRes?.status === 'failed') {
          sb.errorMsg = pollRes.error || '生成失败'
        } else if (pollRes?.status !== 'completed') {
          sb.errorMsg = pollRes?.error || '生成未完成'
        } else {
          await loadDrama()
          restoreSelectionsFromBackend()

          // 关键修复：专用首/尾帧生成成功后，立即清除手动选择残留
          // 让 getSbLastImage / getSbFirstImage 严格走服务器已更新的 sb.last_frame_image_id（避免新图跑到历史列表）
          if (storyboardUseFirstLastFrame.value) {
            if (isLast) {
              delete sbSelectedLastImgId.value[sb.id]
            } else {
              delete sbSelectedImgId.value[sb.id]
            }
          }
        }
      } else {
        await refreshStoryboardMediaForCurrentContext(sb.id)
        restoreSelectionsFromBackend()

        if (storyboardUseFirstLastFrame.value) {
          if (isLast) {
            delete sbSelectedLastImgId.value[sb.id]
          } else {
            delete sbSelectedImgId.value[sb.id]
          }
        }
      }
    } catch (e) {
      sb.errorMsg = e.message || '生成失败'
      ElMessage.error(e.message || '生成失败')
    } finally {
      loadingSet.delete(sb.id)
      genStore.markDone(meta)
    }
  }

  async function onGenerateSbFramePair(sb) {
    const hasFirst = !!(getSbFirstImage(sb.id) || storyboardImageUrl(sb))
    if (!hasFirst) {
      await onGenerateSbFrameImage(sb, 'first')
      if (!getSbFirstImage(sb.id) && !storyboardImageUrl(sb)) return
    }
    await onGenerateSbFrameImage(sb, 'last')
  }

  // ──────────────────────────────────────────────────────────────────────

  async function onGenerateSbImage(sb) {
    if (!dramaId.value || !sb?.id) return
    if (storyboardMediaActionReason.value) {
      ElMessage.warning(storyboardMediaActionReason.value)
      return
    }
    sb.errorMsg = ''
    sb.error_msg = ''
    const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_IMAGE, '分镜图')
    generatingSbImageIds.add(sb.id)
    genStore.markRunning(meta)
    try {
      let idsToSave = sbCharacterIds.value[sb.id]
      if (idsToSave === undefined) {
        const charList = Array.isArray(sb.characters) ? sb.characters : []
        idsToSave = charList
          .map((c) => Number(typeof c === 'object' && c != null ? c.id : c))
          .filter((n) => Number.isFinite(n))
      }
      try {
        await storyboardsAPI.update(sb.id, { character_ids: Array.isArray(idsToSave) ? idsToSave : [] })
      } catch (e) {
        console.warn('[分镜图] 保存角色勾选失败', e)
        ElMessage.warning('保存分镜角色失败，请稍后重试')
        return
      }
      assertStoryboardMediaReady()
      const res = await imagesAPI.create({
        storyboard_id: sb.id,
        drama_id: dramaId.value,
        prompt: sb.polished_prompt || sb.image_prompt || sb.description || '',
        model: undefined,
        style: getSelectedStyle(),
        frame_type: gridMode.value !== 'single' ? gridMode.value : undefined,
        aspect_ratio: projectAspectRatio.value || '16:9',
      })
      ElMessage.success('分镜图生成任务已提交')
      if (res?.task_id) {
        const pollRes = await pollTask(res.task_id, captureStoryboardMediaRefresh(sb.id), meta)
        if (pollRes?.status === 'failed') {
          sb.errorMsg = pollRes.error || '生成失败'
        } else if (pollRes?.status === 'completed') {
          ElMessage.success('分镜图生成完成')
        } else {
          sb.errorMsg = pollRes?.error || '分镜图生成未完成'
          ElMessage.warning(sb.errorMsg)
        }
      } else {
        await refreshStoryboardMediaForCurrentContext(sb.id)
      }
    } catch (e) {
      console.error(e)
      sb.errorMsg = e.message || '生成失败'
      ElMessage.error(e.message || '生成失败')
    } finally {
      generatingSbImageIds.delete(sb.id)
      genStore.markDone(meta)
    }
  }

  return {
    buildFirstFrameImagePrompt,
    buildLastFrameImagePrompt,
    getCachedFramePromptFromDb,
    ensureProfessionalFramePrompt,
    openFramePromptEditor,
    showSbFramePromptPreview,
    saveEditingFramePrompt,
    regenerateEditingFramePrompt,
    onGenerateSbFrameImage,
    onGenerateSbFramePair,
    onGenerateSbImage,
  }
}
