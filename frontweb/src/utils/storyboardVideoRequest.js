import { assetImageUrl } from './mediaUrl.js'
import {
  parseStoryboardCharacterIds,
  parseStoryboardPropIds,
  parseStoryboardSceneId,
} from './canvasEntityIds.js'

function nonEmpty(value) {
  const text = String(value || '').trim()
  return text || ''
}

function uniqueUrls(values, limit = 10) {
  const seen = new Set()
  const result = []
  for (const value of values || []) {
    const url = nonEmpty(value)
    if (!url || seen.has(url)) continue
    seen.add(url)
    result.push(url)
    if (result.length >= limit) break
  }
  return result
}

function firstConfiguredModel(config) {
  const direct = nonEmpty(config?.default_model)
  if (direct) return direct
  const models = config?.model
  if (Array.isArray(models)) return nonEmpty(models.find((item) => nonEmpty(item)))
  return nonEmpty(models)
}

export function videoConfigSupportsOmni(config) {
  if (!config) return false
  const protocol = nonEmpty(config.api_protocol).toLowerCase()
  const provider = nonEmpty(config.provider).toLowerCase()
  const model = firstConfiguredModel(config).toLowerCase()
  if (protocol === 'kling_omni') return true
  if (protocol === 'volcengine_omni') {
    return model.includes('seedance') && (/2[-_]0/.test(model) || /seedance[-_]?2|seedance2/.test(model))
  }
  return protocol === 'agnes' || provider === 'agnes' || /agnes-video/.test(model)
}

function configSettings(config) {
  const value = config?.settings_object ?? config?.settings
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (_) {
    return {}
  }
}

export function videoConfigSupportsGridReference(config) {
  const settings = configSettings(config)
  if (settings.supports_grid_reference === true) return true
  if (settings.supports_grid_reference === false) return false
  return videoConfigSupportsOmni(config)
}

function entityById(items, id) {
  return (items || []).find((item) => Number(item?.id) === Number(id)) || null
}

function appendSlot(slots, kind, entity, name) {
  const url = assetImageUrl(entity)
  if (!url) return
  slots.push({
    index: slots.length + 1,
    kind,
    name: nonEmpty(name) || `Reference ${slots.length + 1}`,
    url,
  })
}

function storedFreeReferences(storyboard) {
  const candidates = storyboard?.reference_images ?? storyboard?.reference_image_urls ?? []
  if (Array.isArray(candidates)) return candidates
  if (typeof candidates !== 'string') return []
  try {
    const parsed = JSON.parse(candidates)
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function referenceIdentity(item) {
  const localPath = nonEmpty(item?.local_path)
  if (localPath) return `local:${localPath}`
  const imageUrl = nonEmpty(item?.image_url || item?.url)
  if (imageUrl) return `url:${imageUrl}`
  return ''
}

function cleanStoryboardReferenceItem(item) {
  const cleaned = {
    name: nonEmpty(item?.name) || nonEmpty(item?.filename) || 'Free reference',
  }
  const localPath = nonEmpty(item?.local_path)
  const imageUrl = nonEmpty(item?.image_url || item?.url)
  if (localPath) cleaned.local_path = localPath
  if (imageUrl) cleaned.image_url = imageUrl

  const assetId = Number(item?.asset_id ?? item?.id)
  if (Number.isFinite(assetId) && assetId > 0) cleaned.asset_id = assetId

  const sourceDramaId = Number(item?.source_drama_id ?? item?.drama_id)
  if (Number.isFinite(sourceDramaId) && sourceDramaId > 0) cleaned.source_drama_id = sourceDramaId

  const sourceDramaTitle = nonEmpty(item?.source_drama_title || item?.drama_title)
  if (sourceDramaTitle) cleaned.source_drama_title = sourceDramaTitle

  return cleaned
}

export function normalizeStoryboardReferenceImages(storyboard) {
  const items = storedFreeReferences(storyboard)
  const normalized = []
  const seen = new Set()
  for (const rawItem of items) {
    const item = typeof rawItem === 'string' ? { image_url: rawItem } : rawItem
    const identity = referenceIdentity(item)
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    normalized.push(cleanStoryboardReferenceItem(item))
  }
  return normalized.slice(0, 10)
}

export function createStoryboardReferenceFromAsset(asset) {
  if (!asset || asset.type === 'video') return null
  const localPath = nonEmpty(asset.local_path)
  const imageUrl = localPath ? '' : nonEmpty(asset.url || asset.image_url)
  if (!localPath && !imageUrl) return null
  return cleanStoryboardReferenceItem({
    name: nonEmpty(asset.name) || 'Media library reference',
    local_path: localPath,
    image_url: imageUrl,
    asset_id: asset.id,
    source_drama_id: asset.drama_id,
    source_drama_title: asset.source_drama_title || asset.drama_title,
  })
}

export function upsertStoryboardReferenceImage(storyboard, reference, options = {}) {
  const nextReference = reference && typeof reference === 'object' && !Array.isArray(reference)
    ? cleanStoryboardReferenceItem(reference)
    : createStoryboardReferenceFromAsset(reference)
  const identity = referenceIdentity(nextReference)
  if (!identity) {
    return { items: normalizeStoryboardReferenceImages(storyboard), status: 'invalid', index: -1 }
  }
  const items = normalizeStoryboardReferenceImages(storyboard)
  const existingIndex = items.findIndex((item) => referenceIdentity(item) === identity)
  const insertAtStart = options.prepend === true
  if (existingIndex >= 0) {
    const existing = items[existingIndex]
    const merged = cleanStoryboardReferenceItem({ ...existing, ...nextReference })
    if (insertAtStart && existingIndex > 0) {
      items.splice(existingIndex, 1)
      items.unshift(merged)
      return { items: items.slice(0, 10), status: 'moved', index: 0 }
    }
    items.splice(existingIndex, 1, merged)
    return { items, status: 'duplicate', index: existingIndex }
  }
  if (insertAtStart) items.unshift(nextReference)
  else items.push(nextReference)
  return { items: items.slice(0, 10), status: 'added', index: insertAtStart ? 0 : Math.min(items.length - 1, 9) }
}

export function collectStoryboardReferenceSlots(drama, storyboard) {
  const slots = []
  const scene = entityById(drama?.scenes, parseStoryboardSceneId(storyboard))
  if (scene) appendSlot(slots, 'scene', scene, scene.location || scene.name)

  for (const id of parseStoryboardCharacterIds(storyboard)) {
    const character = entityById(drama?.characters, id)
    if (character) appendSlot(slots, 'character', character, character.name)
  }
  for (const id of parseStoryboardPropIds(storyboard)) {
    const prop = entityById(drama?.props, id)
    if (prop) appendSlot(slots, 'prop', prop, prop.name)
  }
  for (const entity of normalizeStoryboardReferenceImages(storyboard)) {
    appendSlot(slots, 'free', entity, entity?.name || entity?.filename || 'Free reference')
  }
  return slots.slice(0, 10).map((slot, index) => ({ ...slot, index: index + 1 }))
}

export function collectStoryboardReferenceUrls(drama, storyboard, options = {}) {
  const kinds = options.kinds ? new Set(options.kinds) : null
  const toAbsolute = typeof options.toAbsolute === 'function' ? options.toAbsolute : (value) => value
  const urls = collectStoryboardReferenceSlots(drama, storyboard)
    .filter((slot) => !kinds || kinds.has(slot.kind))
    .map((slot) => toAbsolute(slot.url))
  return uniqueUrls(urls, options.limit || 10)
}

export function buildStoryboardVideoPrompt(storyboard, options = {}) {
  const classicPrompt = nonEmpty(options.classicPrompt ?? storyboard?.video_prompt)
  const universalText = nonEmpty(options.universalText ?? storyboard?.universal_segment_text)
  const universal = options.universal ?? storyboard?.creation_mode === 'universal'
  if (!universal || options.preferClassicPrompt) return classicPrompt || universalText
  return universalText || classicPrompt
}

export function buildStoryboardVideoRequest(options) {
  const storyboard = options.storyboard || {}
  const universalOmni = Boolean(options.universalOmni)
  const firstFrameUrl = nonEmpty(options.firstFrameUrl)
  const lastFrameUrl = nonEmpty(options.lastFrameUrl)
  const referenceUrls = uniqueUrls(options.referenceImageUrls, 10)
  const prompt = nonEmpty(options.prompt ?? buildStoryboardVideoPrompt(storyboard, options))

  const body = {
    drama_id: options.dramaId,
    storyboard_id: storyboard.id,
    prompt,
  }
  if (Number.isFinite(Number(options.videoReferenceImageId)) && Number(options.videoReferenceImageId) > 0) {
    body.video_reference_image_id = Number(options.videoReferenceImageId)
  }
  if (!universalOmni && firstFrameUrl) {
    body.image_url = firstFrameUrl
    body.first_frame_url = firstFrameUrl
  }
  if (!universalOmni && lastFrameUrl) body.last_frame_url = lastFrameUrl
  if (referenceUrls.length) body.reference_image_urls = referenceUrls
  if (nonEmpty(options.style)) body.style = nonEmpty(options.style)
  if (nonEmpty(options.aspectRatio)) body.aspect_ratio = nonEmpty(options.aspectRatio)
  if (nonEmpty(options.resolution)) body.resolution = nonEmpty(options.resolution)
  if (Number.isFinite(Number(options.duration)) && Number(options.duration) > 0) {
    body.duration = Number(options.duration)
  }
  return body
}
