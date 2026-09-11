/** 剧集详情资源弹窗拆分后的源文件，测试应按整组读取。 */
export const DRAMA_DETAIL_RESOURCE_DIALOG_FILES = [
  '../src/components/dramaDetail/DramaDetailResourceDialogs.vue',
  '../src/components/dramaDetail/DramaDetailResourceImageEditor.vue',
  '../src/components/dramaDetail/DramaDetailCharacterEditDialogs.vue',
  '../src/components/dramaDetail/DramaDetailSceneEditDialogs.vue',
  '../src/components/dramaDetail/DramaDetailPropEditDialogs.vue',
]

export function readDramaDetailResourceDialogSources(read) {
  return DRAMA_DETAIL_RESOURCE_DIALOG_FILES.map((file) => read(file)).join('\n')
}
