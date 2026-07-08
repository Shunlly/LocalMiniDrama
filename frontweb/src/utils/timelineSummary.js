export function normalizeTimelineSummary(timeline) {
  const summary = timeline?.summary || {}
  const episodes = Array.isArray(timeline?.episodes) ? timeline.episodes : []
  const trackTypes = Array.isArray(summary.track_types)
    ? summary.track_types
    : Array.from(new Set(episodes.flatMap((episode) => episode?.summary?.track_types || [])))

  return {
    episodeCount: Number(summary.episode_count) || episodes.length,
    trackCount: Number(summary.track_count) || episodes.reduce((sum, episode) => sum + (Number(episode?.summary?.track_count) || 0), 0),
    itemCount: Number(summary.item_count) || episodes.reduce((sum, episode) => sum + (Number(episode?.summary?.item_count) || 0), 0),
    durationSec: Number(summary.duration_sec) || episodes.reduce((sum, episode) => sum + (Number(episode?.summary?.duration_sec) || 0), 0),
    trackTypes,
    hasRequiredTracks: ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'].every((type) => trackTypes.includes(type)),
  }
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const min = Math.floor(total / 60)
  const sec = total % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}
