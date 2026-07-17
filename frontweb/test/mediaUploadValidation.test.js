import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES,
  MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL,
  partitionMediaLibraryUploads,
} from '../src/utils/mediaUploadValidation.js'

test('media library rejects oversized files before upload', () => {
  const exact = { name: 'exact.mp4', size: MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES }
  const oversized = { name: 'too-large.mp4', size: MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES + 1 }
  const result = partitionMediaLibraryUploads([exact, oversized])

  assert.equal(MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL, '100MB')
  assert.deepEqual(result.accepted, [exact])
  assert.deepEqual(result.oversized, [oversized])
})
