export function scriptDraftFingerprint(snapshot) {
  if (!snapshot) return ''
  return JSON.stringify([
    Number(snapshot.dramaId) || 0,
    Number(snapshot.episodeId) || 0,
    Number(snapshot.episodeNumber) || 0,
    String(snapshot.title || ''),
    String(snapshot.content || ''),
  ])
}

function positiveId(value) {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function buildEpisodeDraftPayload(episodes, snapshot) {
  const list = Array.isArray(episodes) ? episodes : []
  const targetId = positiveId(snapshot?.episodeId)
  const targetNumber = positiveId(snapshot?.episodeNumber)
  let matched = false
  const payload = list.map((episode, index) => {
    const episodeNumber = positiveId(episode.episode_number) || index + 1
    const episodeId = positiveId(episode.id)
    const isTarget = targetId
      ? episodeId === targetId
      : Boolean(targetNumber && episodeNumber === targetNumber)
    if (isTarget) matched = true
    return {
      episode_number: episodeNumber,
      title: isTarget ? String(snapshot?.title || '') : String(episode.title || ''),
      script_content: isTarget ? String(snapshot?.content || '') : String(episode.script_content || ''),
      description: episode.description ?? null,
      duration: Number(episode.duration) || 0,
    }
  })
  if (!matched && !targetId) {
    payload.push({
      episode_number: targetNumber || payload.length + 1,
      title: String(snapshot?.title || ''),
      script_content: String(snapshot?.content || ''),
      description: null,
      duration: 0,
    })
  }
  return payload
}

export function createScriptDraftController({
  saveSnapshot,
  delay = 1800,
  onStateChange = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let baseline = ''
  let pending = null
  let timer = null
  let flushPromise = null
  let state = 'saved'

  const setState = (next) => {
    state = next
    onStateChange(next)
  }

  const clearScheduledFlush = () => {
    if (timer != null) clearTimer(timer)
    timer = null
  }

  const scheduleFlush = () => {
    clearScheduledFlush()
    timer = setTimer(() => {
      timer = null
      void flush().catch(() => {})
    }, delay)
  }

  const markSaved = (snapshot) => {
    clearScheduledFlush()
    pending = null
    baseline = scriptDraftFingerprint(snapshot)
    setState('saved')
  }

  const queue = (snapshot) => {
    if (!snapshot) return
    const fingerprint = scriptDraftFingerprint(snapshot)
    if (!flushPromise && fingerprint === baseline) {
      pending = null
      clearScheduledFlush()
      setState('saved')
      return
    }
    pending = snapshot
    setState('dirty')
    scheduleFlush()
  }

  const drain = async () => {
    clearScheduledFlush()
    while (pending) {
      const snapshot = pending
      pending = null
      const fingerprint = scriptDraftFingerprint(snapshot)
      if (fingerprint === baseline) continue
      setState('saving')
      try {
        await saveSnapshot(snapshot)
        baseline = fingerprint
      } catch (error) {
        pending = pending || snapshot
        setState('error')
        throw error
      }
    }
    setState('saved')
  }

  const flush = () => {
    if (flushPromise) return flushPromise
    flushPromise = drain().finally(() => {
      flushPromise = null
    })
    return flushPromise
  }

  return {
    queue,
    flush,
    markSaved,
    hasPendingChanges: () => pending != null || flushPromise != null || state === 'dirty' || state === 'error',
    getState: () => state,
    dispose: clearScheduledFlush,
  }
}

export function createEpisodeSwitchController({
  flushDraft,
  resolveEpisode,
  commitEpisode,
  refreshEpisode = async () => {},
  onBusyChange = () => {},
}) {
  let queue = Promise.resolve()
  let pendingOperations = 0

  const completeOperation = () => {
    pendingOperations = Math.max(0, pendingOperations - 1)
    if (pendingOperations === 0) onBusyChange(false)
  }

  return {
    select(episodeId) {
      pendingOperations += 1
      if (pendingOperations === 1) onBusyChange(true)

      const operation = queue.then(async () => {
        await flushDraft()
        const episode = episodeId == null ? null : resolveEpisode(episodeId)
        if (episodeId != null && !episode) {
          return { changed: false, episode: null, reason: 'not_found' }
        }
        commitEpisode(episode)
        if (episode) await refreshEpisode(episode.id)
        return { changed: true, episode }
      })
      queue = operation.then(completeOperation, completeOperation)
      return operation
    },
  }
}
