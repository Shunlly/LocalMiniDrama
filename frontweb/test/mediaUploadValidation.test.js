import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES,
  MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL,
  partitionMediaLibraryUploads,
  buildMediaLibraryUploadFeedback,
} from '../src/utils/mediaUploadValidation.js'

test('media library rejects oversized files before upload', () => {
  const exact = { name: 'exact.mp4', size: MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES }
  const oversized = { name: 'too-large.mp4', size: MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES + 1 }
  const result = partitionMediaLibraryUploads([exact, oversized])

  assert.equal(MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL, '100MB')
  assert.deepEqual(result.accepted, [exact])
  assert.deepEqual(result.oversized, [oversized])
})

test('media library upload feedback distinguishes all-fail from partial fail', () => {
  const failed = buildMediaLibraryUploadFeedback({
    succeeded: 0,
    failedNames: ['a.png', 'b.png'],
    oversizedNames: [],
    acceptedCount: 2,
  })
  assert.equal(failed.tone, 'error')
  assert.match(failed.title, /上传失败/)
  assert.match(failed.detail, /没有写入素材库/)

  const oversizedOnly = buildMediaLibraryUploadFeedback({
    succeeded: 0,
    failedNames: [],
    oversizedNames: ['huge.mp4'],
    acceptedCount: 0,
  })
  assert.equal(oversizedOnly.tone, 'error')
  assert.match(oversizedOnly.detail, /100MB/)

  const partial = buildMediaLibraryUploadFeedback({
    succeeded: 1,
    failedNames: ['bad.png'],
    oversizedNames: ['huge.mp4'],
    acceptedCount: 2,
  })
  assert.equal(partial.tone, 'warning')
  assert.match(partial.detail, /已上传 1\/2/)
  assert.equal(buildMediaLibraryUploadFeedback({ succeeded: 2, failedNames: [], oversizedNames: [] }), null)
})
