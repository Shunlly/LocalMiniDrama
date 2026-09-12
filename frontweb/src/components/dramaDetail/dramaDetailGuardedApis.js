const DRAMA_DETAIL_GUARDED_API_KEYS = [
  ['dramaAPI', 'dramaAPI'],
  ['aiAPI', 'aiAPI'],
  ['sourceIntakeAPI', 'sourceIntakeAPI'],
  ['characterLibraryAPI', 'characterLibraryAPI'],
  ['sceneLibraryAPI', 'sceneLibraryAPI'],
  ['propLibraryAPI', 'propLibraryAPI'],
  ['uploadAPI', 'uploadAPI'],
  ['imagesAPI', 'imagesAPI'],
  ['taskAPI', 'taskAPI'],
  ['characterAPI', 'characterAPI'],
  ['sceneAPI', 'sceneAPI'],
  ['propAPI', 'propAPI'],
]

/**
 * 按项目实例生命周期给剧集详情页 API 和消息加上守卫。
 * 不创建新状态，也不把 dramaId / episodeId 混成同一个键。
 */
export function createDramaDetailGuardedApis(projectLifecycle, apis = {}) {
  const guarded = {
    ElMessage: projectLifecycle.guardNotifier(apis.ElMessage),
  }
  for (const [outputKey, inputKey] of DRAMA_DETAIL_GUARDED_API_KEYS) {
    guarded[outputKey] = projectLifecycle.guardApi(apis[inputKey])
  }
  return guarded
}
