export function normalizeTimelineSummary(timeline) {
  const summary = timeline?.summary || {}
  const episodes = Array.isArray(timeline?.episodes) ? timeline.episodes : []
  const trackTypes = Array.isArray(summary.track_types)
    ? summary.track_types
    : Array.from(new Set(episodes.flatMap((episode) => episode?.summary?.track_types || [])))

  const placeholderItemCount = episodes.reduce((sum, episode) => (
    sum + (episode?.tracks || []).reduce((trackSum, track) => (
      trackSum + (track?.items || []).filter((item) => {
        const source = String(item?.source_path || '')
        const metadata = item?.metadata || {}
        return source.startsWith('mock://') || source.startsWith('placeholder://') || metadata.placeholder === true
      }).length
    ), 0)
  ), 0)
  const itemCount = Number(summary.item_count) || episodes.reduce((sum, episode) => sum + (Number(episode?.summary?.item_count) || 0), 0)

  return {
    episodeCount: Number(summary.episode_count) || episodes.length,
    trackCount: Number(summary.track_count) || episodes.reduce((sum, episode) => sum + (Number(episode?.summary?.track_count) || 0), 0),
    itemCount,
    placeholderItemCount,
    durationSec: Number(summary.duration_sec) || episodes.reduce((sum, episode) => sum + (Number(episode?.summary?.duration_sec) || 0), 0),
    trackTypes,
    hasRequiredTracks: ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'].every((type) => trackTypes.includes(type)),
    hasPlaceholderItems: placeholderItemCount > 0,
    hasOnlyPlaceholderItems: itemCount > 0 && placeholderItemCount === itemCount,
  }
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const min = Math.floor(total / 60)
  const sec = total % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}
