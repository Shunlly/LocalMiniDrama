export function createLatestRequestGuard() {
  let latestGeneration = 0

  return {
    begin: () => {
      latestGeneration += 1
      return latestGeneration
    },
    isLatest: (generation) => generation === latestGeneration,
    commit: (generation, apply) => {
      if (generation !== latestGeneration) return false
      apply()
      return true
    },
  }
}
