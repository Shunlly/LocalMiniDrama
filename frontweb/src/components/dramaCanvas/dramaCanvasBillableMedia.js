/**
 * 画布计费媒体未知态门闩。只搬家，不改未知数量文案和警告时机。
 */
import { ElMessage } from '@/utils/elementPlusFeedback.js'

export function getStoryboardMediaQueryStatus(mediaStatusBySbId, storyboardId) {
  return mediaStatusBySbId?.[storyboardId] || { state: 'idle', error: '', retryable: false, preservedData: false }
}

export function findUnknownMediaStoryboards(drama, storyboardIds = [], mediaStatusBySbId) {
  const ids = new Set((Array.isArray(storyboardIds) ? storyboardIds : []).map((storyboardId) => Number(storyboardId)))
  if (!ids.size || !drama) return []
  return (drama.episodes || [])
    .flatMap((episode) => episode.storyboards || [])
    .filter((storyboard) => ids.has(Number(storyboard.id)) && getStoryboardMediaQueryStatus(mediaStatusBySbId, storyboard.id).state === 'unknown')
}

export function getBillableMediaUnknownReason(drama, storyboardIds = [], mediaStatusBySbId) {
  const unknownBoards = findUnknownMediaStoryboards(drama, storyboardIds, mediaStatusBySbId)
  if (!unknownBoards.length) return ''
  return unknownBoards.length === 1
    ? '1 个分镜的媒体状态仍然未知。为避免重复计费，请先重试媒体查询，再继续重新生成图片或视频。'
    : `${unknownBoards.length} 个分镜的媒体状态仍然未知。为避免重复计费，请先重试媒体查询，再继续重新生成图片或视频。`
}

export function pipelineTouchesBillableMedia(steps = []) {
  return (Array.isArray(steps) ? steps : []).some((step) => step === 'image' || step === 'video')
}

export function ensureKnownStoryboardMedia(drama, storyboardIds = [], mediaStatusBySbId, warn = (reason) => ElMessage.warning(reason)) {
  const reason = getBillableMediaUnknownReason(drama, storyboardIds, mediaStatusBySbId)
  if (!reason) return true
  warn(reason)
  return false
}
