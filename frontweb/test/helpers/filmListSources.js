import { readFileSync } from 'node:fs'

import { readFilmListLibrarySource } from './filmListLibrarySource.js'

const here = import.meta.url
const read = (path) => readFileSync(new URL(path, here), 'utf8')

export function readFilmListSources() {
  const view = read('../../src/views/FilmList.vue')
  const header = read('../../src/components/filmList/FilmListHeader.vue')
  const banners = read('../../src/components/filmList/FilmListFailureBanners.vue')
  const toolbar = read('../../src/components/filmList/FilmListWorkspaceToolbar.vue')
  const grid = read('../../src/components/filmList/FilmListProjectGrid.vue')
  const pagination = read('../../src/components/filmList/FilmListPagination.vue')
  const formatters = read('../../src/components/filmList/filmListFormatters.js')
  const trash = read('../../src/components/filmList/FilmListTrashDialog.vue')
  const load = read('../../src/components/filmList/useFilmListLoad.js')
  const trashActions = read('../../src/components/filmList/useFilmListTrash.js')
  const forms = read('../../src/components/filmList/useFilmListProjectForms.js')
  const importExport = read('../../src/components/filmList/useFilmListImportExport.js')
  const navigation = read('../../src/components/filmList/useFilmListNavigation.js')
  const sourceNav = read('../../src/utils/sourceImportNavigation.js')
  const library = readFilmListLibrarySource()
  return {
    view,
    header,
    banners,
    toolbar,
    grid,
    pagination,
    formatters,
    trash,
    load,
    trashActions,
    forms,
    importExport,
    navigation,
    sourceNav,
    library,
    ui: [view, header, banners, toolbar, grid, pagination, formatters, trash, load, trashActions, forms, importExport, navigation, sourceNav].join('\n'),
  }
}
