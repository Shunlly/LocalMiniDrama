function normalizeIdList(value) {
  const values = Array.isArray(value) ? value : []
  return [...new Set(values
    .map((item) => String(item ?? '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n')
}

/** Build a stable, server-independent representation of editable storyboard fields. */
export function createStoryboardDraftFingerprint(value = {}) {
  return JSON.stringify({
    title: normalizeText(value.title),
    action: normalizeText(value.action),
    dialogue: normalizeText(value.dialogue),
    image_prompt: normalizeText(value.image_prompt),
    video_prompt: normalizeText(value.video_prompt),
    universal_segment_text: normalizeText(value.universal_segment_text),
    shot_type: normalizeText(value.shot_type),
    duration: Number(value.duration) || 0,
    reference_images: Array.isArray(value.reference_images) ? value.reference_images : [],
    video_reference_image_id: value.video_reference_image_id == null ? '' : String(value.video_reference_image_id),
    characterIds: normalizeIdList(value.characterIds),
    sceneId: value.sceneId == null ? '' : String(value.sceneId),
    propIds: normalizeIdList(value.propIds),
  })
}

export function hasStoryboardDraftChanges(savedFingerprint, value = {}) {
  if (!savedFingerprint) return false
  return savedFingerprint !== createStoryboardDraftFingerprint(value)
}
