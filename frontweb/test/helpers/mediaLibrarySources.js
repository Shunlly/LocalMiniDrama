import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const VIEW_FILE = '../../src/views/MediaLibrary.vue'
const COMPONENT_DIR = '../../src/components/mediaLibrary/'

export function listMediaLibrarySourceFiles(metaUrl = import.meta.url) {
  const viewUrl = new URL(VIEW_FILE, metaUrl)
  const dirUrl = new URL(COMPONENT_DIR, metaUrl)
  const files = [{
    name: 'MediaLibrary.vue',
    relativePath: '../src/views/MediaLibrary.vue',
    source: readFileSync(viewUrl, 'utf8'),
  }]
  const names = readdirSync(fileURLToPath(dirUrl))
    .filter((name) => /\.(vue|js|css)$/.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))
  for (const name of names) {
    files.push({
      name,
      relativePath: `../src/components/mediaLibrary/${name}`,
      source: readFileSync(new URL(name, dirUrl), 'utf8'),
    })
  }
  return files
}

export function readMediaLibrarySourceMap(metaUrl = import.meta.url) {
  return Object.fromEntries(listMediaLibrarySourceFiles(metaUrl).map((file) => [file.name, file.source]))
}

export function readMediaLibrarySources(metaUrl = import.meta.url) {
  return listMediaLibrarySourceFiles(metaUrl).map((file) => file.source).join('\n')
}

export const MEDIA_LIBRARY_SOURCE_FILES = listMediaLibrarySourceFiles().map((file) => (
  file.name === 'MediaLibrary.vue'
    ? VIEW_FILE
    : `${COMPONENT_DIR}${file.name}`
))
