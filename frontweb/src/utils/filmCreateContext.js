export function formatEpisodeContextLabel(episode, fallbackIndex = 0) {
  const number = Math.max(1, Number(episode?.episode_number) || Number(fallbackIndex) + 1)
  const prefix = `第 ${number} 集`
  const compactPrefix = `第${number}集`
  const title = String(episode?.title || '').trim()
  if (!title || title === prefix || title === compactPrefix) return prefix
  return `${prefix} · ${title}`
}
