import { readFileSync } from 'node:fs'

const FILES = [
  '../../src/views/MediaLibrary.vue',
  '../../src/components/mediaLibrary/MediaLibraryHeader.vue',
  '../../src/components/mediaLibrary/MediaLibraryFilterBar.vue',
  '../../src/components/mediaLibrary/MediaLibraryLocalGrid.vue',
  '../../src/components/mediaLibrary/MediaLibraryNetworkPanel.vue',
]

export function readMediaLibrarySources(metaUrl = import.meta.url) {
  return FILES.map((file) => readFileSync(new URL(file, metaUrl), 'utf8')).join('\n')
}

export const MEDIA_LIBRARY_SOURCE_FILES = FILES
