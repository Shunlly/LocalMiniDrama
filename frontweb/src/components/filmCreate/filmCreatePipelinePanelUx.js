import { isSafeUserFacingMessage } from '../../utils/requestError.js'
import { getPipelineControlReasons } from '../../utils/filmPipelineAction.js'
import { describeActionAriaLabel } from './filmCreateActionCopy.js'

/** 把暂停/继续/停止禁用原因收成中文，并描述进行中状态与空状态下一步。 */
export function toPipelineDisabledReason(value, fallback = '当前不可用') {
  const text = String(value || '').trim()
  if (!text) return ''
  if (!isSafeUserFacingMessage(text)) {
    return String(fallback || '当前不可用')
  }
  return text
}

function toSafeOrFallback(value, fallback) {
  const text = String(value || '').trim()
  if (!text) return String(fallback || '')
  return toPipelineDisabledReason(text, fallback)
}

/** 缺配置/检查中/检查失败时，完整成片按钮也要跟上 readiness，不能只看传入的禁用原因。 */
export function resolvePipelineProductionReason(input = {}) {
  const explicit = toPipelineDisabledReason(
    input.productionDisabledReason || input.disabledReason,
    '完整成片暂不可生成',
  )
  if (explicit) return explicit
  const state = String(input.productionReadinessState || '')
  if (state === 'checking') {
    return toSafeOrFallback(input.productionReadinessReason, '正在检查完整成片能力')
  }
  if (state === 'error') {
    return toSafeOrFallback(input.productionReadinessReason, '无法确认完整成片能力，请重试检查')
  }
  if (state === 'missing') {
    return toSafeOrFallback(input.productionReadinessReason, '完整成片能力尚未配齐，可先跑草稿预演')
  }
  return ''
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
  const countdown = Math.max(0, Number(input.countdown) || 0)
  const controlReasons = input.controlReasons || getPipelineControlReasons({
    running,
    paused,
    stopping,
    stopRequired,
    productionReason: input.productionReason,
  })
  const pauseDisabledReason = running && !paused
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
  const skipCountdownDisabledReason = running && (stopping || stopRequired)
    ? toPipelineDisabledReason(
      stopping
        ? (controlReasons.cancel || '正在停止全流程，请稍候')
        : (controlReasons.pause || '停止未完成，请先重试停止剩余任务。'),
      stopping ? '正在停止全流程，请稍候' : '停止未完成，请先重试停止剩余任务',
    )
    : ''
  const productionBusy = starting || (running && !paused && !stopping)
  const productionButtonTitle = String(input.productionReason || '').trim()
    || (productionBusy ? (starting ? '正在确认完整成片的运行条件' : '正在生成完整成片，请稍候') : '')
  const draftButtonTitle = String(input.draftReason || '').trim()
    || (productionBusy ? (starting ? '正在确认完整成片的运行条件' : '正在生成文本框架，请稍候') : '')
  const productionButtonAriaLabel = describeActionAriaLabel('一键生成成片', {
    loading: productionBusy,
    loadingLabel: starting ? '正在确认完整成片的运行条件' : '正在生成完整成片',
    disabledReason: input.productionReason,
  })
  const draftButtonAriaLabel = describeActionAriaLabel('仅生成文本框架', {
    loading: productionBusy,
    loadingLabel: starting ? '正在确认完整成片的运行条件' : '正在生成文本框架',
    disabledReason: input.draftReason,
  })
  const rawStep = String(input.currentStep || '').replace(/^\[步骤 \d+\/\d+\] /, '')
  const cleanCurrentStep = rawStep
    ? toPipelineDisabledReason(rawStep, '正在执行全流程生成')
    : ''
  let progressKicker = ''
  if (stopRequired) progressKicker = '停止受阻'
  else if (running) progressKicker = paused ? '已暂停' : '进行中'
  else if (starting) progressKicker = '进行中'
  let progressStatusText = ''
  if (running) {
    progressStatusText = cleanCurrentStep || (paused ? '全流程生成已暂停' : '正在执行全流程生成')
  }
  const countdownMessage = toSafeOrFallback(
    input.countdownMessage,
    countdown > 0 ? '即将进入下一阶段' : '',
  )
  const countdownPausedHint = paused
    ? (stopRequired ? '已暂停，请先重试停止剩余任务' : '已暂停，点击“继续”恢复')
    : ''
  const countdownAriaLabel = countdown > 0
    ? `阶段倒计时剩余 ${countdown} 秒。${countdownMessage}${countdownPausedHint ? `。${countdownPausedHint}` : ''}`
    : ''
  const isEmpty = input.hasEpisode === false
  return {
    pauseDisabledReason,
    resumeDisabledReason,
    cancelDisabledReason,
    compactDisabledReason,
    skipCountdownDisabledReason,
    productionButtonTitle,
    draftButtonTitle,
    productionButtonAriaLabel,
    draftButtonAriaLabel,
    progressKicker,
    progressStatusText,
    countdownMessage,
    countdownPausedHint,
    countdownAriaLabel,
    emptyNextStep: isEmpty ? '添加一集后再保存剧本或启动生成' : '',
    emptyGuidanceText: isEmpty ? '还没有剧集。下一步：添加一集后再保存剧本或启动生成。' : '',
    emptyActionLabel: isEmpty ? '添加一集' : '',
  }
}
