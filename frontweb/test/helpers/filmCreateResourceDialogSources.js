import { readFileSync } from 'node:fs'

/** 制作页资源弹窗拆分后的源文件，合同测试应按树读取。 */
export const FILM_CREATE_RESOURCE_DIALOG_FILES = [
  '../src/components/filmCreate/FilmCreateResourceDialogs.vue',
  '../src/components/filmCreate/FilmCreateResourceRefImageField.vue',
  '../src/components/filmCreate/FilmCreatePropEditDialog.vue',
  '../src/components/filmCreate/FilmCreateSceneEditDialog.vue',
  '../src/components/filmCreate/FilmCreateCharacterLibraryDialogs.vue',
  '../src/components/filmCreate/FilmCreatePropLibraryDialogs.vue',
  '../src/components/filmCreate/FilmCreateSceneLibraryDialogs.vue',
]

export const FILM_CREATE_RESOURCE_DIALOG_SPLIT_FILES = FILM_CREATE_RESOURCE_DIALOG_FILES.slice(1)

function defaultRead(testRelativeFile) {
  return readFileSync(new URL(testRelativeFile.replace(/^\.\.\//, '../../'), import.meta.url), 'utf8')
}

export function readFilmCreateComponent(name) {
  return readFileSync(new URL('../../src/components/filmCreate/' + name, import.meta.url), 'utf8')
}

export function readFilmCreateResourceDialogTree(read) {
  const load = typeof read === 'function' ? read : defaultRead
  return FILM_CREATE_RESOURCE_DIALOG_FILES.map((file) => load(file)).join('\n')
}
