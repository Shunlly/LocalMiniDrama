import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { isUserFacingAbort, toUserFacingError } from '@/utils/userFacingError'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'
import { buildStoryboardVideoRequest } from '@/utils/storyboardVideoRequest'
import { toPipelinePollUserFacingError } from './filmCreatePipelinePollError.js'

/**
 * 修复缺失流水线执行体。
 * 由 useFilmCreatePipelineStages 装配入口后调用。
 */
export function useFilmCreatePipelineRepair(deps = {}) {
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
            const pollErr = toPipelinePollUserFacingError(result, '生成角色失败', '生成角色超时，请稍后重试')
            if (pollErr) { addPipelineError('生成角色', pollErr); return }
          } else await loadDrama()
          await pipelineRest()
        } catch (e) {
          if (isUserFacingAbort(e)) throw e
          addPipelineError('生成角色', toUserFacingError(e, '生成角色失败'))
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
              const pollErr = toPipelinePollUserFacingError(result, '生成失败', '生成超时，请稍后重试')
              if (pollErr) throw new Error(pollErr)
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
            const pollErr = toPipelinePollUserFacingError(result, '提取场景失败', '提取场景超时，请稍后重试')
            if (pollErr) { addPipelineError('提取场景', pollErr); return }
          } else await loadDrama()
          await pipelineRest()
        } catch (e) {
          if (isUserFacingAbort(e)) throw e
          addPipelineError('提取场景', toUserFacingError(e, '提取场景失败'))
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
              const pollErr = toPipelinePollUserFacingError(result, '生成失败', '生成超时，请稍后重试')
              if (pollErr) throw new Error(pollErr)
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
            const pollErr = toPipelinePollUserFacingError(result, '提取道具失败', '提取道具超时，请稍后重试')
            if (pollErr) { addPipelineError('提取道具', pollErr); /* 不中断 */ }
          } else await loadDrama()
          await pipelineRest()
        } catch (e) {
          if (isUserFacingAbort(e)) throw e
          addPipelineError('提取道具', toUserFacingError(e, '提取道具失败'))
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
                const pollErr = toPipelinePollUserFacingError(result, '生成失败', '生成超时，请稍后重试')
                if (pollErr) throw new Error(pollErr)
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
            const pollErr = toPipelinePollUserFacingError(result, '分镜生成失败', '分镜生成超时，请稍后重试')
            if (pollErr) { addPipelineError('分镜生成', pollErr); return }
          }
          await loadDrama()
          await pipelineRest()
        } catch (e) {
          if (isUserFacingAbort(e)) throw e
          addPipelineError('分镜生成', toUserFacingError(e, '分镜生成失败'))
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
            addPipelineError('润色全能分镜', `镜#${sb.storyboard_number ?? sb.id}: ${toUserFacingError(msg, '润色失败')}`),
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
              const pollErr = toPipelinePollUserFacingError(result, '生成失败', '生成超时，请稍后重试')
              if (pollErr) throw new Error(pollErr)
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
                const pollErr = toPipelinePollUserFacingError(result, '生成失败', '生成超时，请稍后重试')
                if (pollErr) throw new Error(pollErr)
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
          const pollErr = toPipelinePollUserFacingError(pollResult, '生成整集视频失败', '生成整集视频超时，请稍后重试')
          if (pollErr) addPipelineError('生成整集视频', pollErr)
          else await pipelineRest()
        } else {
          addPipelineError('生成整集视频', toUserFacingError(result?.message, '本集没有可合成的视频片段'))
        }
      } catch (e) {
        if (isUserFacingAbort(e)) throw e
        addPipelineError('生成整集视频', toUserFacingError(e, '生成整集视频失败'))
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
      if (isUserFacingAbort(e)) throw e
      addPipelineError('流程', toUserFacingError(e, '流程失败'))
    }
  }

  return {
    runRepairPipeline,
  }
}
