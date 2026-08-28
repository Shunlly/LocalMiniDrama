import { ElMessage } from 'element-plus'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'
import { buildStoryboardVideoRequest } from '@/utils/storyboardVideoRequest'

export function useFilmCreatePipelineStages(deps = {}) {
  const {
    currentEpisodeId,
    dramaId,
    store,
    storyInput,
    scriptLanguage,
    generationAPI,
    dramaAPI,
    propAPI,
    characterAPI,
    sceneAPI,
    imagesAPI,
    videosAPI,
    loadDrama,
    loadStoryboardMedia,
    refreshStoryboardsOnly,
    getStoryboardCountForApi,
    getVideoDurationForApi,
    projectAspectRatio,
    storyboardIncludeNarration,
    storyboardUniversalOmni,
    polishUniversalSegmentsAfterGeneration,
    hasAssetImage,
    hasSbImage,
    generatingCharIds,
    generatingSceneIds,
    generatingPropIds,
    generatingSbImageIds,
    generatingSbVideoIds,
    getSelectedStyle,
    captureDramaRefresh,
    captureStoryboardMediaRefresh,
    refreshStoryboardMediaForCurrentContext,
    pollUntilResourceHasImage,
    sceneUseQuadGrid,
    storyboardUseFirstLastFrame,
    isSbUniversalMode,
    ensureProfessionalFramePrompt,
    assertStoryboardMediaReady,
    sbVideos,
    recordHasPlayableVideoUrl,
    sbCanSubmitVideo,
    collectSbOmniReferenceAbsoluteUrls,
    getSbFirstFrameUrl,
    buildStoryboardVideoReferencePayload,
    buildSbVideoPromptForApi,
    getSbVideoDurationForApi,
    videoResolution,
    buildSbGenMeta,
    getFinalizeMergeOptions,
    refreshProductionReadiness,
    trackFilmCreateAction,
    pipelineStarting,
    pipelineRunning,
    pipelineStopping,
    activePipelineRunPromise,
    pipelineAbortRequested,
    pipelineErrorLog,
    pipelineCurrentStep,
    pipelineStepIndex,
    pipelineActiveTasks,
    pipelineOwnedTaskIds,
    pipelineStepTotal,
    pipelineConcurrency,
    pipelineVideoConcurrency,
    executeOwnedPipelineRun,
    confirmProductionPipelineCost,
    checkPause,
    pollTaskWithPause,
    addPipelineError,
    pipelineRest,
    runPipelineCountdown,
    pipelineWithRetry,
    runConcurrently,
    setPipelineStep,
    storyboardMediaActionReason,
  } = deps

  async function startOneClickPipeline() {
    if (!currentEpisodeId.value || pipelineStarting.value || pipelineRunning.value || pipelineStopping.value || activePipelineRunPromise.value) return
    if (storyboardMediaActionReason.value) {
      ElMessage.warning(storyboardMediaActionReason.value)
      return
    }
    pipelineAbortRequested.value = false
    pipelineStarting.value = true
    try {
      const productionCapability = await refreshProductionReadiness()
      if (pipelineAbortRequested.value) return
      if (storyboardMediaActionReason.value) {
        ElMessage.warning(storyboardMediaActionReason.value)
        return
      }
      if (!productionCapability.ready) {
        ElMessage.warning(productionCapability.reason)
        return
      }
      if (!await confirmProductionPipelineCost()) return
      if (pipelineAbortRequested.value) return
      if (storyboardMediaActionReason.value) {
        ElMessage.warning(storyboardMediaActionReason.value)
        return
      }

      trackFilmCreateAction('one_click_generate_start')
      pipelineErrorLog.value = []
      pipelineCurrentStep.value = ''
      pipelineStepIndex.value = 0
      pipelineActiveTasks.clear()
      pipelineOwnedTaskIds.clear()
      pipelineStepTotal.value = 10
      pipelineStarting.value = false
      await executeOwnedPipelineRun(
        () => runOneClickPipeline(false),
        { requireStoryboardMedia: true },
      )
    } finally {
      pipelineStarting.value = false
    }
  }

  async function startTextFrameworkPipeline() {
    if (!currentEpisodeId.value || pipelineStarting.value || pipelineRunning.value || pipelineStopping.value || activePipelineRunPromise.value) return
    pipelineAbortRequested.value = false
    pipelineStarting.value = true
    try {
      pipelineErrorLog.value = []
      pipelineCurrentStep.value = ''
      pipelineStepIndex.value = 0
      pipelineActiveTasks.clear()
      pipelineOwnedTaskIds.clear()
      pipelineStepTotal.value = 4
      pipelineStarting.value = false
      trackFilmCreateAction('text_framework_generate_start')
      await executeOwnedPipelineRun(() => runOneClickPipeline(true))
    } finally {
      pipelineStarting.value = false
    }
  }

  async function runOneClickPipeline(textOnly = false) {
    const episodeId = currentEpisodeId.value
    const dramaIdVal = dramaId.value
    if (!episodeId || !dramaIdVal) return
    const style = getSelectedStyle()

    try {
      if (!textOnly && storyboardMediaActionReason.value) throw new Error(storyboardMediaActionReason.value)
      // ════════════════════════════════════════════════════════
      // 阶段一：内容提取 & 分镜生成（快速、低成本）
      // ════════════════════════════════════════════════════════

      // 步骤 1：提取角色
      await checkPause()
      let chars = store.currentEpisode?.characters ?? []
      if (chars.length === 0) {
        setPipelineStep(1, '提取角色...')
        try {
          const outline = (store.scriptContent || '').toString().trim() || (storyInput.value || '').toString().trim() || undefined
          const res = await generationAPI.generateCharacters(dramaIdVal, { episode_id: store.currentEpisode?.id ?? undefined, outline: outline || undefined })
          const taskId = res?.task_id
          if (taskId) {
            const result = await pollTaskWithPause(taskId, captureDramaRefresh())
            if (result?.error) { addPipelineError('提取角色', result.error); return }
          } else {
            await loadDrama()
          }
          await pipelineRest()
        } catch (e) {
          addPipelineError('提取角色', e.message || String(e))
          return
        }
        chars = store.currentEpisode?.characters ?? []
      } else {
        setPipelineStep(1, `已有 ${chars.length} 个角色，跳过提取`)
      }

      // 步骤 2：提取场景
      await checkPause()
      let sceneList = store.currentEpisode?.scenes ?? []
      if (sceneList.length === 0) {
        setPipelineStep(2, '提取场景...')
        try {
          const res = await dramaAPI.extractBackgrounds(episodeId, { model: undefined, style, language: scriptLanguage.value })
          const taskId = res?.task_id
          if (taskId) {
            const result = await pollTaskWithPause(taskId, captureDramaRefresh())
            if (result?.error) { addPipelineError('提取场景', result.error); return }
          } else {
            await loadDrama()
          }
          await pipelineRest()
        } catch (e) {
          addPipelineError('提取场景', e.message || String(e))
          return
        }
        sceneList = store.currentEpisode?.scenes ?? []
      } else {
        setPipelineStep(2, `已有 ${sceneList.length} 个场景，跳过提取`)
      }

      // 步骤 3：提取道具
      await checkPause()
      let propList = store.props ?? []
      if (propList.length === 0) {
        setPipelineStep(3, '提取道具...')
        try {
          const res = await propAPI.extractFromScript(episodeId)
          const taskId = res?.task_id
          if (taskId) {
            const result = await pollTaskWithPause(taskId, captureDramaRefresh())
            if (result?.error) { addPipelineError('提取道具', result.error); return }
          } else {
            await loadDrama()
          }
          await pipelineRest()
        } catch (e) {
          addPipelineError('提取道具', e.message || String(e))
          // 道具提取失败不中断流程
        }
        propList = store.props ?? []
      } else {
        setPipelineStep(3, `已有 ${propList.length} 个道具，跳过提取`)
      }

      // 步骤 4：生成分镜脚本
      await checkPause()
      await loadStoryboardMedia({ failClosed: !textOnly })
      let boards = store.storyboards || []
      const hadBoardsBeforeStep4 = boards.length > 0
      if (boards.length === 0) {
        setPipelineStep(4, '生成分镜脚本...')
        // 与手动生成一样，每 2 秒刷新一次分镜列表，让已解析的分镜逐步显示
        const sbRefreshTimer = setInterval(refreshStoryboardsOnly, 2000)
        try {
          const res = await dramaAPI.generateStoryboard(episodeId, {
            style,
            aspect_ratio: projectAspectRatio.value || '16:9',
            storyboard_count: getStoryboardCountForApi(),
            video_duration: getVideoDurationForApi(),
            include_narration: !!storyboardIncludeNarration.value,
            universal_omni_storyboard: !!storyboardUniversalOmni.value,
          })
          const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
          if (taskId) {
            const result = await pollTaskWithPause(taskId, captureDramaRefresh())
            if (result?.error) {
              // 任务失败，但后端可能已保存了部分分镜，确保最新状态显示出来再停止
              await loadDrama()
              addPipelineError('生成分镜', result.error)
              clearInterval(sbRefreshTimer)
              return
            }
            if (result?.result?.truncated) {
              sbTruncatedWarning.value = true
              sbTruncatedDismissed.value = false
            }
          }
          await loadDrama()
          await pipelineRest()
        } catch (e) {
          addPipelineError('生成分镜', e.message || String(e))
          clearInterval(sbRefreshTimer)
          return
        }
        clearInterval(sbRefreshTimer)
        await loadStoryboardMedia({ failClosed: !textOnly })
        boards = store.storyboards || []
      } else {
        setPipelineStep(4, `已有 ${boards.length} 个分镜，跳过生成`)
      }

      const generatedSbThisPipeline = !hadBoardsBeforeStep4
      if (generatedSbThisPipeline && storyboardUniversalOmni.value) {
        await checkPause()
        await polishUniversalSegmentsAfterGeneration({
          checkPause,
          onShotProgress: (cur, total, sb) =>
            setPipelineStep(
              4,
              `润色全能分镜(${cur}/${total}) #${sb.storyboard_number ?? cur} ${(sb.title || '').slice(0, 16)}`
            ),
          onShotError: (sb, msg) =>
            addPipelineError('润色全能分镜', `镜#${sb.storyboard_number ?? sb.id}: ${msg}`),
        })
        await loadDrama()
        await loadStoryboardMedia({ failClosed: !textOnly })
      }

      if (textOnly) {
        await checkPause()
        const errorCount = pipelineErrorLog.value.length
        pipelineCurrentStep.value = errorCount
          ? `文本框架流程已结束，${errorCount} 项失败（未生成图片与视频）`
          : '文本框架已就绪（未生成图片与视频）'
        if (errorCount) {
          ElMessage.warning(`文本框架流程已结束，${errorCount} 项失败`)
        } else {
          ElMessage.success('文本框架已生成：角色、场景、道具与分镜脚本已就绪')
        }
        return
      }

      // ════════════════════════════════════════════════════════
      // ⏱ 倒计时 20 秒：请浏览分镜内容，确认后开始生成角色/场景/道具图片
      // ════════════════════════════════════════════════════════
      await runPipelineCountdown(20, '分镜脚本生成完毕，请浏览确认内容。倒计时结束后将开始生成角色、场景、道具图片。')
      await checkPause()

      // ════════════════════════════════════════════════════════
      // 阶段二：角色 / 场景 / 道具 图片生成（中等消耗）
      // ════════════════════════════════════════════════════════

      // 步骤 5：生成角色图
      {
        const charsWithoutImage = chars.filter((c) => !hasAssetImage(c))
        const concurrency = pipelineConcurrency.value
        setPipelineStep(5, `生成角色图（${charsWithoutImage.length} 个，并发 ${concurrency}）...`)
        await runConcurrently(charsWithoutImage, concurrency, async (char) => {
          await checkPause()
          generatingCharIds.add(char.id)
          try {
            const stepName = '角色图 ' + (char.name || char.id)
            await pipelineWithRetry(stepName, async () => {
              const res = await characterAPI.generateImage(char.id, undefined, style)
              const taskId = res?.image_generation?.task_id ?? res?.task_id
              if (taskId) {
                const result = await pollTaskWithPause(taskId, captureDramaRefresh())
                if (result?.error) throw new Error(result.error)
              } else {
                await loadDrama()
                await pollUntilResourceHasImage(() => {
                  const list = store.currentEpisode?.characters ?? []
                  const c = list.find((x) => Number(x.id) === Number(char.id))
                  return !!(c && (c.image_url || c.local_path))
                })
              }
            })
          } finally {
            generatingCharIds.delete(char.id)
          }
        }, { getLabel: (char) => '角色图 ' + (char.name || char.id) })
      }

      // 步骤 6：生成场景图
      {
        const scenesWithoutImage = sceneList.filter((s) => !hasAssetImage(s))
        const concurrency = pipelineConcurrency.value
        setPipelineStep(6, `生成场景图（${scenesWithoutImage.length} 个，并发 ${concurrency}）...`)
        await checkPause()
        await runConcurrently(scenesWithoutImage, concurrency, async (scene) => {
          await checkPause()
          generatingSceneIds.add(scene.id)
          try {
            const stepName = '场景图 ' + (scene.location || scene.id)
            await pipelineWithRetry(stepName, async () => {
              const useQuad = !!sceneUseQuadGrid.value
              const res = await sceneAPI.generateImage({ scene_id: scene.id, model: undefined, style, use_quad_grid: useQuad })
              const taskId = res?.image_generation?.task_id ?? res?.task_id
              if (taskId) {
                const result = await pollTaskWithPause(taskId, captureDramaRefresh())
                if (result?.error) throw new Error(result.error)
              } else {
                await loadDrama()
                await pollUntilResourceHasImage(() => {
                  const list = store.currentEpisode?.scenes ?? []
                  const s = list.find((x) => Number(x.id) === Number(scene.id))
                  return !!(s && (s.image_url || s.local_path))
                })
              }
            })
          } finally {
            generatingSceneIds.delete(scene.id)
          }
        }, { getLabel: (scene) => '场景图 ' + (scene.location || scene.id) })
      }

      // 步骤 7：生成道具图
      {
        const propsWithoutImage = propList.filter((p) => !hasAssetImage(p))
        const concurrency = pipelineConcurrency.value
        setPipelineStep(7, `生成道具图（${propsWithoutImage.length} 个，并发 ${concurrency}）...`)
        await checkPause()
        await runConcurrently(propsWithoutImage, concurrency, async (prop) => {
          await checkPause()
          generatingPropIds.add(prop.id)
          try {
            const stepName = '道具图 ' + (prop.name || prop.id)
            await pipelineWithRetry(stepName, async () => {
              const res = await propAPI.generateImage(prop.id, undefined, style)
              const taskId = res?.image_generation?.task_id ?? res?.task_id
              if (taskId) {
                const result = await pollTaskWithPause(taskId, captureDramaRefresh())
                if (result?.error) throw new Error(result.error)
              } else {
                await loadDrama()
                await pollUntilResourceHasImage(() => {
                  const list = store.props ?? []
                  const p = list.find((x) => Number(x.id) === Number(prop.id))
                  return !!(p && (p.image_url || p.local_path))
                })
              }
            })
          } finally {
            generatingPropIds.delete(prop.id)
          }
        }, { getLabel: (prop) => '道具图 ' + (prop.name || prop.id) })
      }

      // ════════════════════════════════════════════════════════
      // ⏱ 倒计时 30 秒：请浏览角色/场景/道具图，确认后开始生成分镜图
      // ════════════════════════════════════════════════════════
      await runPipelineCountdown(30, '角色、场景、道具图片生成完毕，请浏览确认效果。倒计时结束后将开始生成分镜图（消耗较多 Token）。')
      await checkPause()

      // ════════════════════════════════════════════════════════
      // 阶段三：分镜图生成（较高消耗）
      // ════════════════════════════════════════════════════════

      // 步骤 8：生成分镜图
      {
        await loadStoryboardMedia({ failClosed: true })
        boards = store.storyboards || []
        const boardsWithoutImg = boards.filter((sb) => !hasSbImage(sb))
        const concurrency = pipelineConcurrency.value
        setPipelineStep(8, `生成分镜图（${boardsWithoutImg.length} 个，并发 ${concurrency}）...`)
        await runConcurrently(boardsWithoutImg, concurrency, async (sb) => {
          await checkPause()
          generatingSbImageIds.add(sb.id)
          try {
            const stepName = '分镜图 #' + (sb.storyboard_number ?? sb.id)
            await pipelineWithRetry(stepName, async () => {
              const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
              let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
              let frameTypeForCreate = undefined
              if (useFirstLast) {
                prompt = await ensureProfessionalFramePrompt(sb, 'first')
                frameTypeForCreate = 'storyboard_first'
              }
              assertStoryboardMediaReady()
              const res = await imagesAPI.create({
                storyboard_id: sb.id,
                drama_id: dramaIdVal,
                prompt,
                model: undefined,
                style,
                frame_type: frameTypeForCreate,
                aspect_ratio: projectAspectRatio.value || '16:9',
              })
              if (res?.task_id) {
                const result = await pollTaskWithPause(res.task_id, captureStoryboardMediaRefresh(sb.id))
                if (result?.error) throw new Error(result.error)
              } else await refreshStoryboardMediaForCurrentContext(sb.id)
            })
          } finally {
            generatingSbImageIds.delete(sb.id)
          }
        }, { getLabel: (sb) => '分镜图 #' + (sb.storyboard_number ?? sb.id) })
      }

      // ════════════════════════════════════════════════════════
      // ⏱ 倒计时 20 秒：请浏览分镜图，确认后开始生成分镜视频
      // ════════════════════════════════════════════════════════
      await runPipelineCountdown(20, '分镜图生成完毕，请浏览确认图片效果。倒计时结束后将开始生成分镜视频（消耗最多 Token）。')
      await checkPause()

      // ════════════════════════════════════════════════════════
      // 阶段四：分镜视频 & 合集（最高消耗）
      // ════════════════════════════════════════════════════════

      // 步骤 9：生成分镜视频
      {
        await loadStoryboardMedia({ failClosed: true })
        const boards2 = (store.storyboards || []).filter((sb) => {
          const vidList = sbVideos.value[sb.id] || []
          if (vidList.some((v) => v.status === 'completed' && recordHasPlayableVideoUrl(v))) return false
          if (isSbUniversalMode(sb.id)) {
            if (!sbCanSubmitVideo(sb)) return false
            return collectSbOmniReferenceAbsoluteUrls(sb).length > 0
          }
          return !!getSbFirstFrameUrl(sb)
        })
        const concurrency = pipelineVideoConcurrency.value
        setPipelineStep(9, `生成分镜视频（${boards2.length} 个，并发 ${concurrency}）...`)
        await runConcurrently(boards2, concurrency, async (sb) => {
          await checkPause()
          generatingSbVideoIds.add(sb.id)
          try {
            const stepName = '分镜视频 #' + (sb.storyboard_number ?? sb.id)
            await pipelineWithRetry(stepName, async () => {
              const universal = isSbUniversalMode(sb.id)
              const referencePayload = await buildStoryboardVideoReferencePayload(sb, {
                universal,
                universalOmni: universal,
              })
              const vFirst = referencePayload.firstFrameUrl
              const vLast = referencePayload.lastFrameUrl
              const refUrls = referencePayload.referenceUrls
              assertStoryboardMediaReady()
              const res = await videosAPI.create(buildStoryboardVideoRequest({
                dramaId: dramaIdVal,
                storyboard: sb,
                prompt: buildSbVideoPromptForApi(sb),
                universalOmni: universal,
                firstFrameUrl: vFirst,
                lastFrameUrl: vLast,
                referenceImageUrls: refUrls,
                style,
                aspectRatio: projectAspectRatio.value || '16:9',
                resolution: videoResolution.value || undefined,
                duration: getSbVideoDurationForApi(sb),
              }))
              if (res?.task_id) {
                const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
                const result = await pollTaskWithPause(res.task_id, captureStoryboardMediaRefresh(sb.id), meta)
                if (result?.error) throw new Error(result.error)
              } else await refreshStoryboardMediaForCurrentContext(sb.id)
            })
          } finally {
            generatingSbVideoIds.delete(sb.id)
          }
        }, { getLabel: (sb) => '分镜视频 #' + (sb.storyboard_number ?? sb.id) })
      }

      // 步骤 10：合成整集视频
      await checkPause()
      setPipelineStep(10, '合成整集视频...')
      try {
        const result = await dramaAPI.finalizeEpisode(episodeId, getFinalizeMergeOptions())
        if (result?.task_id != null) {
          const pollResult = await pollTaskWithPause(result.task_id, captureDramaRefresh())
          if (pollResult?.error) addPipelineError('合成整集视频', pollResult.error)
          else await pipelineRest()
        } else {
          addPipelineError('合成整集视频', result?.message || '本集没有可合成的视频片段')
        }
      } catch (e) {
        addPipelineError('合成整集视频', e.message || String(e))
      }

      await checkPause()
      const errorCount = pipelineErrorLog.value.length
      pipelineCurrentStep.value = errorCount
        ? `一键生成视频流程已结束，${errorCount} 项失败`
        : '一键生成视频流程已执行完成'
      if (errorCount) {
        ElMessage.warning(`一键生成视频流程已结束，${errorCount} 项失败`)
      } else {
        ElMessage.success('一键生成视频流程已执行完成')
      }
      trackFilmCreateAction(errorCount ? 'one_click_generate_partial' : 'one_click_generate_complete', {
        extra: { error_count: pipelineErrorLog.value.length },
      })
    } catch (e) {
      addPipelineError('流程', e.message || String(e))
      trackFilmCreateAction('one_click_generate_failed', {
        extra: { message: String(e?.message || 'failed').slice(0, 120) },
      })
    }
  }

  async function startRepairPipeline() {
    if (!currentEpisodeId.value || pipelineStarting.value || pipelineRunning.value || pipelineStopping.value || activePipelineRunPromise.value) return
    if (storyboardMediaActionReason.value) {
      ElMessage.warning(storyboardMediaActionReason.value)
      return
    }
    pipelineAbortRequested.value = false
    pipelineStarting.value = true
    try {
      const productionCapability = await refreshProductionReadiness()
      if (pipelineAbortRequested.value) return
      if (storyboardMediaActionReason.value) {
        ElMessage.warning(storyboardMediaActionReason.value)
        return
      }
      if (!productionCapability.ready) {
        ElMessage.warning(productionCapability.reason)
        return
      }
      if (!await confirmProductionPipelineCost()) return
      if (pipelineAbortRequested.value) return
      if (storyboardMediaActionReason.value) {
        ElMessage.warning(storyboardMediaActionReason.value)
        return
      }

      pipelineErrorLog.value = []
      pipelineCurrentStep.value = ''
      pipelineActiveTasks.clear()
      pipelineOwnedTaskIds.clear()
      pipelineStarting.value = false
      await executeOwnedPipelineRun(runRepairPipeline, { requireStoryboardMedia: true })
    } finally {
      pipelineStarting.value = false
    }
  }

  /** 修复缺失：哪一步没有就生成哪一步，有图/有内容就跳过 */
  async function runRepairPipeline() {
    const episodeId = currentEpisodeId.value
    const dramaIdVal = dramaId.value
    if (!episodeId || !dramaIdVal) return
    const style = getSelectedStyle()

    try {
      pipelineCurrentStep.value = '正在加载数据...'
      await loadDrama()
      if (storyboardMediaActionReason.value) throw new Error(storyboardMediaActionReason.value)

      // 1. 角色：没有则生成角色；再为每个无图角色生成图
      let chars = store.currentEpisode?.characters ?? []
      if (chars.length === 0) {
        await checkPause()
        pipelineCurrentStep.value = '正在生成角色列表...'
        try {
          const outline = (store.scriptContent || '').toString().trim() || (storyInput.value || '').toString().trim() || undefined
          const res = await generationAPI.generateCharacters(dramaIdVal, { episode_id: store.currentEpisode?.id ?? undefined, outline: outline || undefined })
          const taskId = res?.task_id
          if (taskId) {
            const result = await pollTaskWithPause(taskId, captureDramaRefresh())
            if (result?.error) { addPipelineError('生成角色', result.error); return }
          } else await loadDrama()
          await pipelineRest()
        } catch (e) {
          addPipelineError('生成角色', e.message || String(e))
          return
        }
        chars = store.currentEpisode?.characters ?? []
      }
      const charsWithoutImage = chars.filter((c) => !hasAssetImage(c))
      {
        const concurrency = pipelineConcurrency.value
        pipelineCurrentStep.value = `正在生成角色图（并发${concurrency}）...`
        await runConcurrently(charsWithoutImage, concurrency, async (char) => {
          await checkPause()
          const stepName = '角色图 ' + (char.name || char.id)
          await pipelineWithRetry(stepName, async () => {
            const res = await characterAPI.generateImage(char.id, undefined, style)
            const taskId = res?.image_generation?.task_id ?? res?.task_id
            if (taskId) {
              const result = await pollTaskWithPause(taskId, captureDramaRefresh())
              if (result?.error) throw new Error(result.error)
            } else {
              await loadDrama()
              await pollUntilResourceHasImage(() => {
                const list = store.currentEpisode?.characters ?? []
                const c = list.find((x) => Number(x.id) === Number(char.id))
                return !!(c && (c.image_url || c.local_path))
              })
            }
          })
        }, { getLabel: (char) => '角色图 ' + (char.name || char.id) })
      }

      // 2. 场景：没有则提取；再为每个无图场景生成图
      let sceneList = store.currentEpisode?.scenes ?? []
      if (sceneList.length === 0) {
        await checkPause()
        pipelineCurrentStep.value = '正在提取场景...'
        try {
          const res = await dramaAPI.extractBackgrounds(episodeId, { model: undefined, style, language: scriptLanguage.value })
          const taskId = res?.task_id
          if (taskId) {
            const result = await pollTaskWithPause(taskId, captureDramaRefresh())
            if (result?.error) { addPipelineError('提取场景', result.error); return }
          } else await loadDrama()
          await pipelineRest()
        } catch (e) {
          addPipelineError('提取场景', e.message || String(e))
          return
        }
        sceneList = store.currentEpisode?.scenes ?? []
      }
      const scenesWithoutImage = sceneList.filter((s) => !hasAssetImage(s))
      {
        const concurrency = pipelineConcurrency.value
        pipelineCurrentStep.value = `正在生成场景图（并发${concurrency}）...`
        await runConcurrently(scenesWithoutImage, concurrency, async (scene) => {
          await checkPause()
          const stepName = '场景图 ' + (scene.location || scene.id)
          await pipelineWithRetry(stepName, async () => {
            const useQuad = !!sceneUseQuadGrid.value
            const res = await sceneAPI.generateImage({ scene_id: scene.id, model: undefined, style, use_quad_grid: useQuad })
            const taskId = res?.image_generation?.task_id ?? res?.task_id
            if (taskId) {
              const result = await pollTaskWithPause(taskId, captureDramaRefresh())
              if (result?.error) throw new Error(result.error)
            } else {
              await loadDrama()
              await pollUntilResourceHasImage(() => {
                const list = store.currentEpisode?.scenes ?? []
                const s = list.find((x) => Number(x.id) === Number(scene.id))
                return !!(s && (s.image_url || s.local_path))
              })
            }
          })
        }, { getLabel: (scene) => '场景图 ' + (scene.location || scene.id) })
      }

      // 2.5 道具：没有则提取；再为每个无图道具生成图
      let propList2 = store.props ?? []
      if (propList2.length === 0) {
        await checkPause()
        pipelineCurrentStep.value = '正在提取道具...'
        try {
          const res = await propAPI.extractFromScript(episodeId)
          const taskId = res?.task_id
          if (taskId) {
            const result = await pollTaskWithPause(taskId, captureDramaRefresh())
            if (result?.error) { addPipelineError('提取道具', result.error); /* 不中断 */ }
          } else await loadDrama()
          await pipelineRest()
        } catch (e) {
          addPipelineError('提取道具', e.message || String(e))
        }
        propList2 = store.props ?? []
      }
      const propsWithoutImage2 = propList2.filter((p) => !hasAssetImage(p))
      {
        const concurrency = pipelineConcurrency.value
        pipelineCurrentStep.value = `正在生成道具图（并发${concurrency}）...`
        await checkPause()
        await runConcurrently(propsWithoutImage2, concurrency, async (prop) => {
          await checkPause()
          generatingPropIds.add(prop.id)
          try {
            const stepName = '道具图 ' + (prop.name || prop.id)
            await pipelineWithRetry(stepName, async () => {
              const res = await propAPI.generateImage(prop.id, undefined, style)
              const taskId = res?.image_generation?.task_id ?? res?.task_id
              if (taskId) {
                const result = await pollTaskWithPause(taskId, captureDramaRefresh())
                if (result?.error) throw new Error(result.error)
              } else {
                await loadDrama()
                await pollUntilResourceHasImage(() => {
                  const list = store.props ?? []
                  const p = list.find((x) => Number(x.id) === Number(prop.id))
                  return !!(p && (p.image_url || p.local_path))
                })
              }
            })
          } finally {
            generatingPropIds.delete(prop.id)
          }
        }, { getLabel: (prop) => '道具图 ' + (prop.name || prop.id) })
      }

      // 3. 分镜：没有则生成分镜；再逐个检查分镜图，没有则生成；再逐个检查分镜视频，没有则生成
      let boards = store.storyboards || []
      const hadBoardsBeforeRepairSb = boards.length > 0
      if (boards.length === 0) {
        await checkPause()
        pipelineCurrentStep.value = '正在生成分镜...'
        try {
          const res = await dramaAPI.generateStoryboard(episodeId, {
            aspect_ratio: projectAspectRatio.value || '16:9',
            storyboard_count: getStoryboardCountForApi(),
            video_duration: getVideoDurationForApi(),
            include_narration: !!storyboardIncludeNarration.value,
            universal_omni_storyboard: !!storyboardUniversalOmni.value,
          })
          const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
          if (taskId) {
            const result = await pollTaskWithPause(taskId, captureDramaRefresh())
            if (result?.error) { addPipelineError('分镜生成', result.error); return }
          }
          await loadDrama()
          await pipelineRest()
        } catch (e) {
          addPipelineError('分镜生成', e.message || String(e))
          return
        }
        boards = store.storyboards || []
      }
      if (!hadBoardsBeforeRepairSb && storyboardUniversalOmni.value) {
        await checkPause()
        await polishUniversalSegmentsAfterGeneration({
          checkPause,
          onShotProgress: (cur, total, sb) => {
            pipelineCurrentStep.value = `润色全能分镜(${cur}/${total}) #${sb.storyboard_number ?? cur} ${(sb.title || '').slice(0, 16)}`
          },
          onShotError: (sb, msg) =>
            addPipelineError('润色全能分镜', `镜#${sb.storyboard_number ?? sb.id}: ${msg}`),
        })
        await loadDrama()
      }
      // 先拉取分镜图片/视频列表，再批量生成分镜图（并发）
      await loadStoryboardMedia({ failClosed: true })
      const boardsWithoutImg = boards.filter((sb) => !hasSbImage(sb))
      {
        const concurrency = pipelineConcurrency.value
        pipelineCurrentStep.value = `正在生成分镜图（并发${concurrency}）...`
        await runConcurrently(boardsWithoutImg, concurrency, async (sb) => {
          await checkPause()
          const stepName = '分镜图 #' + (sb.storyboard_number ?? sb.id)
          await pipelineWithRetry(stepName, async () => {
            const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
            let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
            let frameTypeForCreate = undefined
            if (useFirstLast) {
              prompt = await ensureProfessionalFramePrompt(sb, 'first')
              frameTypeForCreate = 'storyboard_first'
            }
            assertStoryboardMediaReady()
            const res = await imagesAPI.create({
              storyboard_id: sb.id,
              drama_id: dramaIdVal,
              prompt,
              model: undefined,
              style,
              frame_type: frameTypeForCreate,
              aspect_ratio: projectAspectRatio.value || '16:9',
            })
            if (res?.task_id) {
              const result = await pollTaskWithPause(res.task_id, captureStoryboardMediaRefresh(sb.id))
              if (result?.error) throw new Error(result.error)
            } else await refreshStoryboardMediaForCurrentContext(sb.id)
          })
        }, { getLabel: (sb) => '分镜图 #' + (sb.storyboard_number ?? sb.id) })
      }
      await loadStoryboardMedia({ failClosed: true })
      const boards2 = (store.storyboards || []).filter((sb) => {
        const vidList = sbVideos.value[sb.id] || []
        if (vidList.some((v) => v.status === 'completed' && recordHasPlayableVideoUrl(v))) return false
        if (isSbUniversalMode(sb.id)) {
          if (!sbCanSubmitVideo(sb)) return false
          return collectSbOmniReferenceAbsoluteUrls(sb).length > 0
        }
        return !!getSbFirstFrameUrl(sb)
      })
      {
        const concurrency = pipelineVideoConcurrency.value
        pipelineCurrentStep.value = `正在生成分镜视频（并发${concurrency}）...`
        await runConcurrently(boards2, concurrency, async (sb) => {
          await checkPause()
          generatingSbVideoIds.add(sb.id)
          try {
            const stepName = '分镜视频 #' + (sb.storyboard_number ?? sb.id)
            await pipelineWithRetry(stepName, async () => {
              const universal = isSbUniversalMode(sb.id)
              const referencePayload = await buildStoryboardVideoReferencePayload(sb, {
                universal,
                universalOmni: universal,
              })
              const vFirst = referencePayload.firstFrameUrl
              const vLast = referencePayload.lastFrameUrl
              const refUrls = referencePayload.referenceUrls
              assertStoryboardMediaReady()
              const res = await videosAPI.create(buildStoryboardVideoRequest({
                dramaId: dramaIdVal,
                storyboard: sb,
                prompt: buildSbVideoPromptForApi(sb),
                universalOmni: universal,
                firstFrameUrl: vFirst,
                lastFrameUrl: vLast,
                referenceImageUrls: refUrls,
                aspectRatio: projectAspectRatio.value || '16:9',
                resolution: videoResolution.value || undefined,
                duration: getSbVideoDurationForApi(sb),
              }))
              if (res?.task_id) {
                const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
                const result = await pollTaskWithPause(res.task_id, captureStoryboardMediaRefresh(sb.id), meta)
                if (result?.error) throw new Error(result.error)
              } else await refreshStoryboardMediaForCurrentContext(sb.id)
            })
          } finally {
            generatingSbVideoIds.delete(sb.id)
          }
        }, { getLabel: (sb) => '分镜视频 #' + (sb.storyboard_number ?? sb.id) })
      }

      // 4. 生成整集视频（合成整个视频）
      await checkPause()
      pipelineCurrentStep.value = '正在生成整集视频...'
      try {
        const result = await dramaAPI.finalizeEpisode(episodeId, getFinalizeMergeOptions())
        if (result?.task_id != null) {
          const pollResult = await pollTaskWithPause(result.task_id, captureDramaRefresh())
          if (pollResult?.error) addPipelineError('生成整集视频', pollResult.error)
          else await pipelineRest()
        } else {
          addPipelineError('生成整集视频', result?.message || '本集没有可合成的视频片段')
        }
      } catch (e) {
        addPipelineError('生成整集视频', e.message || String(e))
      }

      await checkPause()
      const errorCount = pipelineErrorLog.value.length
      pipelineCurrentStep.value = errorCount
        ? `补全并生成流程已结束，${errorCount} 项失败`
        : '补全并生成流程已执行完成'
      if (errorCount) {
        ElMessage.warning(`补全并生成流程已结束，${errorCount} 项失败`)
      } else {
        ElMessage.success('修复缺失流程已执行完成')
      }
    } catch (e) {
      addPipelineError('流程', e.message || String(e))
    }
  }

  return {
    startOneClickPipeline,
    startTextFrameworkPipeline,
    runOneClickPipeline,
    startRepairPipeline,
    runRepairPipeline,
  }
}
