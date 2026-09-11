/** 剧集详情页及其拆出的逻辑源文件，测试应按整组读取。 */
export const DRAMA_DETAIL_PAGE_LOGIC_FILES = [
  '../src/views/DramaDetail.vue',
  '../src/components/dramaDetail/dramaDetailInfoAutosave.js',
  '../src/components/dramaDetail/dramaDetailLoadAndNav.js',
  '../src/components/dramaDetail/dramaDetailResourceLists.js',
  '../src/components/dramaDetail/dramaDetailEpisodeActions.js',
  '../src/components/dramaDetail/dramaDetailResourceImport.js',
  '../src/components/dramaDetail/dramaDetailResourceTabs.js',
  '../src/components/dramaDetail/dramaDetailResourceEditorState.js',
  '../src/components/dramaDetail/dramaDetailPageBindings.js',
  '../src/components/dramaDetail/DramaDetailResourceLibraryList.vue',
  '../src/components/dramaDetail/DramaDetailResourceProductionList.vue',
  '../src/components/dramaDetail/DramaDetailResourceCover.vue',
  '../src/components/dramaDetail/DramaDetailResourceEmptyState.vue',
]

export function readDramaDetailPageLogicSources(read) {
  return DRAMA_DETAIL_PAGE_LOGIC_FILES.map((file) => read(file)).join('\n')
}
