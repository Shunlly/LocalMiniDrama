export const MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
export const MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL = '100MB'

export function partitionMediaLibraryUploads(files, maxBytes = MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES) {
  const accepted = []
  const oversized = []
  for (const file of Array.from(files || [])) {
    if (Number(file?.size) > maxBytes) oversized.push(file)
    else accepted.push(file)
  }
  return { accepted, oversized }
}
