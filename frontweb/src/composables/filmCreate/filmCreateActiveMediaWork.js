/** 批量/单条生图、生视频、配音、超分等进行中媒体任务判定，不含普通编辑。 */

function readActiveFlag(value) {
  if (value == null) return false
  if (typeof value === 'object' && 'value' in value) return Boolean(value.value)
  return Boolean(value)
}

function hasActiveIdCollection(value) {
  if (value == null) return false
  const collection = typeof value === 'object' && 'value' in value ? value.value : value
  if (collection == null) return false
  if (typeof collection.size === 'number') return collection.size > 0
  if (typeof collection.length === 'number') return collection.length > 0
  return false
}

function hasRunningTaskList(value) {
  if (value == null) return false
  const list = typeof value === 'object' && 'value' in value ? value.value : value
  if (list == null) return false
  if (typeof list.size === 'number') return list.size > 0
  if (typeof list.length === 'number') return list.length > 0
  return false
}

export function hasActiveMediaGenerationWork(state = {}) {
  return readActiveFlag(state.batchImageRunning)
    || readActiveFlag(state.batchImageStopping)
    || readActiveFlag(state.batchVideoRunning)
    || readActiveFlag(state.batchVideoStopping)
    || hasActiveIdCollection(state.generatingSbImageIds)
    || hasActiveIdCollection(state.generatingSbVideoIds)
    || hasActiveIdCollection(state.generatingSbFirstImageIds)
    || hasActiveIdCollection(state.generatingSbLastImageIds)
    || hasActiveIdCollection(state.generatingUniversalSegmentIds)
    || hasActiveIdCollection(state.ttsSbIds)
    || hasActiveIdCollection(state.ttsSbNarrationIds)
    || hasActiveIdCollection(state.upscalingSbIds)
    || hasActiveIdCollection(state.generatingCharIds)
    || hasActiveIdCollection(state.generatingSceneIds)
    || hasActiveIdCollection(state.generatingPropIds)
    || hasActiveIdCollection(state.generatingPanoramaIds)
    || hasRunningTaskList(state.runningGenerationTasks)
}
