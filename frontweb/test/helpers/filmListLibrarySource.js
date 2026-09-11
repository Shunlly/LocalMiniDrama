import { readFileSync } from 'node:fs'

const FILM_LIST_LIBRARY_FILES = [
  '../../src/components/filmList/FilmListLibraryDialogs.vue',
  '../../src/components/filmList/FilmListCharLibraryDialogs.vue',
  '../../src/components/filmList/FilmListSceneLibraryDialogs.vue',
  '../../src/components/filmList/FilmListPropLibraryDialogs.vue',
  '../../src/components/filmList/filmListLibraryImage.js',
]

export function readFilmListLibrarySource() {
  return FILM_LIST_LIBRARY_FILES
    .map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8'))
    .join('\n')
}

export function readFilmListLibraryFile(name) {
  return readFileSync(new URL(`../../src/components/filmList/${name}`, import.meta.url), 'utf8')
}
