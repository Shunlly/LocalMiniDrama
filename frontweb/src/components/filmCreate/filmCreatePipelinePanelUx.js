import { getPipelineControlReasons } from '../../utils/filmPipelineAction.js'

/** 把暂停/继续/停止禁用原因收成中文，并描述进行中状态与空状态下一步。 */
export function toPipelineDisabledReason(value, fallback = '当前不可用') {
  const text = String(value || '').trim()
  if (!text) return ''
  const technicalEnglish = /network error|http\s*error|failed to fetch|fetch failed|internal server error|econnrefused|err_network|status code|axioserror/i
  if (technicalEnglish.test(text) || !/[\u4e00-\u9fff]/.test(text)) {
    return String(fallback || '当前不可用')
  }
  return text
}

export function describePipelineErrorLog(errorLog = []) {
  return (Array.isArray(errorLog) ? errorLog : []).map((entry) => ({
    time: entry?.time,
    step: entry?.step,
    message: toPipelineDisabledReason(entry?.message, '操作失败，请稍后重试') || '操作失败，请稍后重试',
  }))
}

export function describePipelinePanelUx(input = {}) {
  const running = Boolean(input.running)
  const paused = Boolean(input.paused)
  const stopping = Boolean(input.stopping)
  const stopRequired = Boolean(input.stopRequired)
  const starting = Boolean(input.starting)
  const controlReasons = input.controlReasons || getPipelineControlReasons({
    running,
    paused,
    stopping,
    stopRequired,
    productionReason: input.productionReason,
  })
  const pauseDisabledReason = running && !stopRequired && !paused
    ? toPipelineDisabledReason(controlReasons.pause, '当前不能暂停全流程')
    : ''
  const resumeDisabledReason = running && !stopRequired && paused
    ? toPipelineDisabledReason(controlReasons.resume, '当前不能继续全流程')
    : ''
  const cancelDisabledReason = running
    ? toPipelineDisabledReason(controlReasons.cancel, '当前不能停止全流程')
    : ''
  const compactDisabledReason = stopping
    ? toPipelineDisabledReason(controlReasons.cancel || '正在停止全流程，请稍候', '正在停止全流程，请稍候')
    : (starting ? '正在确认完整成片的运行条件' : '')
  const productionBusy = starting || (running && !paused && !stopping)
  const productionButtonTitle = String(input.productionReason || '').trim()
    || (productionBusy ? (starting ? '正在确认完整成片的运行条件' : '正在生成完整成片，请稍候') : '')
  const draftButtonTitle = String(input.draftReason || '').trim()
    || (productionBusy ? (starting ? '正在确认完整成片的运行条件' : '正在生成文本框架，请稍候') : '')
  function actionAriaLabel(actionLabel, { loading, loadingLabel, disabledReason } = {}) {
    if (loading) return String(loadingLabel || `正在${actionLabel}`).trim()
    const reason = String(disabledReason || '').trim()
    if (reason) return `${actionLabel}不可用：${reason}`
    return String(actionLabel || '').trim()
  }
  const productionButtonAriaLabel = actionAriaLabel('一键生成成片', {
    loading: productionBusy,
    loadingLabel: starting ? '正在确认完整成片的运行条件' : '正在生成完整成片',
    disabledReason: input.productionReason,
  })
  const draftButtonAriaLabel = actionAriaLabel('仅生成文本框架', {
    loading: productionBusy,
    loadingLabel: starting ? '正在确认完整成片的运行条件' : '正在生成文本框架',
    disabledReason: input.draftReason,
  })
  const cleanCurrentStep = String(input.currentStep || '').replace(/^\[步骤 \d+\/\d+\] /, '')
  let progressKicker = ''
  if (stopRequired) progressKicker = '停止受阻'
  else if (running) progressKicker = paused ? '已暂停' : '进行中'
  else if (starting) progressKicker = '进行中'
  let progressStatusText = ''
  if (running) {
    progressStatusText = cleanCurrentStep || (paused ? '全流程生成已暂停' : '正在执行全流程生成')
  }
  const isEmpty = input.hasEpisode === false
  return {
    pauseDisabledReason,
    resumeDisabledReason,
    cancelDisabledReason,
    compactDisabledReason,
    productionButtonTitle,
    draftButtonTitle,
    productionButtonAriaLabel,
    draftButtonAriaLabel,
    progressKicker,
    progressStatusText,
    emptyNextStep: isEmpty ? '添加一集后再保存剧本或启动生成' : '',
    emptyGuidanceText: isEmpty ? '还没有剧集。下一步：添加一集后再保存剧本或启动生成。' : '',
    emptyActionLabel: isEmpty ? '添加一集' : '',
  }
}
