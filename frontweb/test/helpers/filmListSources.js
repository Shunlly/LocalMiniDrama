import { readFileSync } from 'node:fs'

import { readFilmListLibrarySource } from './filmListLibrarySource.js'

const here = import.meta.url
const read = (path) => readFileSync(new URL(path, here), 'utf8')

export function readFilmListSources() {
  const view = read('../../src/views/FilmList.vue')
  const header = read('../../src/components/filmList/FilmListHeader.vue')
  const banners = read('../../src/components/filmList/FilmListFailureBanners.vue')
  const toolbar = read('../../src/components/filmList/FilmListWorkspaceToolbar.vue')
  const library = readFilmListLibrarySource()
  return {
    view,
    header,
    banners,
    toolbar,
    library,
    ui: [view, header, banners, toolbar].join('\n'),
  }
}
