const FILM_CREATE_GUARDED_API_KEYS = [
  ['dramaAPI', 'dramaAPI'],
  ['timelinesAPI', 'timelinesAPI'],
  ['generationAPI', 'generationAPI'],
  ['characterAPI', 'characterAPI'],
  ['propAPI', 'propAPI'],
  ['sceneAPI', 'sceneAPI'],
  ['taskAPI', 'taskAPI'],
  ['imagesAPI', 'imagesAPI'],
  ['videosAPI', 'videosAPI'],
  ['storyboardsAPI', 'storyboardsAPI'],
  ['uploadAPI', 'uploadAPI'],
  ['characterLibraryAPI', 'characterLibraryAPI'],
  ['sceneLibraryAPI', 'sceneLibraryAPI'],
  ['propLibraryAPI', 'propLibraryAPI'],
]

/**
 * 按项目实例生命周期给制作页 API 和消息加上守卫。
 * 不创建新状态，不改空剧本门闩。
 */
export function createFilmCreateGuardedApis(projectLifecycle, apis = {}) {
  const guarded = {
    ElMessage: projectLifecycle.guardNotifier(apis.ElMessage),
  }
  for (const [outputKey, inputKey] of FILM_CREATE_GUARDED_API_KEYS) {
    guarded[outputKey] = projectLifecycle.guardApi(apis[inputKey])
  }
  return guarded
}
