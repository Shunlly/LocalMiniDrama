export function clipSecondsForStoryboardEstimate(rawClipDuration, fallback = 5) {
  const clip = Number(rawClipDuration)
  return Math.max(2, Math.min(60, Number.isFinite(clip) && clip > 0 ? clip : fallback))
}

export function shotCountEstimateFromDurationSec(sec, clipSeconds) {
  const duration = Math.max(10, Math.min(600, Math.round(Number(sec) || 0)))
  const clip = clipSecondsForStoryboardEstimate(clipSeconds)
  const ideal = duration / clip
  const locked = Math.max(1, Math.min(200, Math.round(ideal)))
  const minR = Math.max(1, locked - 1)
  const maxR = Math.min(200, locked + 1)
  const range = minR >= maxR ? { min: locked, max: locked } : { min: minR, max: maxR }
  return { locked, range, clip }
}

export function estimateVideoDurationSecFromCharLen(charLen) {
  const len = Math.max(0, Math.floor(Number(charLen) || 0))
  if (len < 1) return null
  const raw = Math.round(10 + (len / 600) * 60)
  return Math.min(600, Math.max(10, raw))
}

export function buildScriptStoryboardEstimate(scriptText, clipSeconds) {
  const script = String(scriptText || '').trim()
  const len = script.length
  if (!len) return null
  const sec = estimateVideoDurationSecFromCharLen(len)
  if (sec == null) return null
  const { locked, range, clip } = shotCountEstimateFromDurationSec(sec, clipSeconds)
  return { sec, locked, range, clip, len }
}
