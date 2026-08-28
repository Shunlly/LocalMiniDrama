import { ElMessage } from 'element-plus'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import {
  collectStoryboardReferenceSlots,
  collectStoryboardReferenceUrls,
  createStoryboardReferenceFromAsset,
  normalizeStoryboardReferenceImages,
  upsertStoryboardReferenceImage,
} from '@/utils/storyboardVideoRequest'

export function useFilmCreateStoryboardReferences(deps = {}) {
  const {
    store,
    storyboards,
    storyboardsAPI,
    sbSceneId,
    sbCharacterIds,
    sbPropIds,
    videoParamsTarget,
    toAbsoluteImageUrl,
    assetImageUrl,
    scenes,
    characters,
    props,
    savingSbReferenceImages,
    globalMediaPickerMode,
    globalMediaPickerTarget,
    showGlobalMediaPicker,
    getMainImageUrlForVideo,
    sbVideoFirstLastUrls,
  } = deps

  function currentStoryboardReferenceState(sb) {
    if (!sb?.id) return sb || {}
    return {
      ...sb,
      scene_id: sbSceneId.value[sb.id] ?? sb.scene_id,
      characters: sbCharacterIds.value[sb.id] ?? sb.characters,
      prop_ids: sbPropIds.value[sb.id] ?? sb.prop_ids,
    }
  }

  function findStoryboardRow(sbId) {
    return (storyboards.value || []).find((row) => Number(row.id) === Number(sbId)) || null
  }

  function mergeStoryboardIntoStore(nextRow) {
    if (!nextRow?.id) return
    const mergeIntoList = (list) => {
      if (!Array.isArray(list)) return
      const row = list.find((item) => Number(item.id) === Number(nextRow.id))
      if (row) Object.assign(row, nextRow)
    }
    mergeIntoList(store.currentEpisode?.storyboards)
    for (const episode of store.drama?.episodes || []) mergeIntoList(episode.storyboards)
    if (videoParamsTarget.value?.id === nextRow.id) {
      videoParamsTarget.value = { ...videoParamsTarget.value, ...nextRow }
    }
  }

  function getSbFreeReferenceItems(sb) {
    return normalizeStoryboardReferenceImages(currentStoryboardReferenceState(sb))
  }

  function getSbPrimaryFreeReferenceItem(sb) {
    return getSbFreeReferenceItems(sb)[0] || null
  }

  function collectSbFreeReferenceAbsoluteUrls(sb) {
    if (!sb?.id) return []
    return collectStoryboardReferenceUrls(
      currentDramaReferenceEntities(),
      currentStoryboardReferenceState(sb),
      { kinds: ['free'], toAbsolute: toAbsoluteImageUrl, limit: 10 }
    )
  }

  function uniqueStoryboardReferenceUrls(values, limit = 10) {
    const next = []
    const seen = new Set()
    for (const raw of values || []) {
      const value = String(raw || '').trim()
      if (!value || seen.has(value)) continue
      seen.add(value)
      next.push(value)
      if (next.length >= limit) break
    }
    return next
  }

  async function saveStoryboardReferenceImages(sb, nextImages, successMessage) {
    if (!sb?.id || savingSbReferenceImages.has(sb.id)) return false
    savingSbReferenceImages.add(sb.id)
    try {
      const updated = await storyboardsAPI.update(sb.id, { reference_images: nextImages })
      mergeStoryboardIntoStore(updated)
      ElMessage.success(successMessage)
      return true
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存分镜参考图失败'))
      return false
    } finally {
      savingSbReferenceImages.delete(sb.id)
    }
  }

  function openGlobalMediaPicker(sb, mode = 'reference') {
    if (!sb?.id) return
    globalMediaPickerMode.value = mode
    globalMediaPickerTarget.value = findStoryboardRow(sb.id) || sb
    showGlobalMediaPicker.value = true
  }

  async function onGlobalMediaAssetSelected(asset) {
    const sb = globalMediaPickerTarget.value
    if (!sb?.id) return
    const reference = createStoryboardReferenceFromAsset(asset)
    if (!reference) {
      ElMessage.warning('当前闭环先支持把图片挂到分镜参考图')
      return
    }
    const prepend = globalMediaPickerMode.value === 'reference-primary'
    const result = upsertStoryboardReferenceImage(currentStoryboardReferenceState(sb), reference, { prepend })
    if (result.status === 'invalid') {
      ElMessage.warning('所选素材缺少可用图片地址，无法挂到分镜参考图')
      return
    }
    if (result.status === 'duplicate' && !prepend) {
      ElMessage.warning('该图片已经挂到当前分镜的自由参考图中')
      return
    }
    if (result.status === 'duplicate' && prepend) {
      ElMessage.warning('该图片已经是当前分镜的视频主参考')
      return
    }
    const message = prepend ? '已设置为当前分镜的视频主参考图' : '已添加到当前分镜的自由参考图'
    const saved = await saveStoryboardReferenceImages(sb, result.items, message)
    if (saved) {
      showGlobalMediaPicker.value = false
      globalMediaPickerTarget.value = findStoryboardRow(sb.id) || sb
    }
  }

  async function onRemoveSbFreeReferenceImage(sb, index) {
    const items = getSbFreeReferenceItems(sb)
    if (index < 0 || index >= items.length) return
    const nextImages = items.filter((_, itemIndex) => itemIndex !== index)
    await saveStoryboardReferenceImages(sb, nextImages, '已移除分镜自由参考图')
  }

  async function onPromoteSbFreeReferenceImage(sb, item) {
    const result = upsertStoryboardReferenceImage(currentStoryboardReferenceState(sb), item, { prepend: true })
    if (result.status === 'duplicate') {
      ElMessage.warning('该图片已经是当前分镜的视频主参考')
      return
    }
    await saveStoryboardReferenceImages(sb, result.items, '已更新当前分镜的视频主参考图')
  }

  function currentDramaReferenceEntities() {
    return {
      scenes: scenes.value || [],
      characters: characters.value || [],
      props: props.value || [],
    }
  }

  /** 全能模式：场景、角色、物品和自由参考图槽位（用于 @ 选择器缩略图） */
  function getSbUniversalOmniRefSlots(sb) {
    if (!sb?.id) return []
    return collectStoryboardReferenceSlots(
      currentDramaReferenceEntities(),
      currentStoryboardReferenceState(sb)
    ).map((slot) => ({
      index: slot.index,
      kind: slot.kind,
      name: slot.name,
      thumbUrl: slot.url,
    }))
  }

  /** 全能模式：统一收集场景、角色、物品和自由参考图，最多 10 张。 */
  function collectSbOmniReferenceAbsoluteUrls(sb) {
    if (!sb?.id) return []
    return collectStoryboardReferenceUrls(
      currentDramaReferenceEntities(),
      currentStoryboardReferenceState(sb),
      { toAbsolute: toAbsoluteImageUrl, limit: 10 }
    )
  }

  /** 非 Seedance2 全能降级：仅场景参考图（若有） */
  function collectSbSceneOnlyReferenceAbsoluteUrls(sb) {
    if (!sb?.id) return []
    return collectStoryboardReferenceUrls(
      currentDramaReferenceEntities(),
      currentStoryboardReferenceState(sb),
      { kinds: ['scene'], toAbsolute: toAbsoluteImageUrl, limit: 1 }
    )
  }

  function getSbPrimaryReferenceAbsoluteUrl(sb) {
    const primary = getSbPrimaryFreeReferenceItem(sb)
    return primary ? toAbsoluteImageUrl(assetImageUrl(primary)) : ''
  }

  async function buildStoryboardVideoReferencePayload(sb, options = {}) {
    const universal = options.universal === true
    const universalOmni = options.universalOmni === true
    const selectedGrid = options.selectedGrid || null
    const gridAbsoluteUrl = selectedGrid ? toAbsoluteImageUrl(assetImageUrl(selectedGrid)) : ''
    const omniRefs = universal ? [gridAbsoluteUrl, ...collectSbOmniReferenceAbsoluteUrls(sb)].filter(Boolean) : []
    const sceneOnlyRefs = universal && !universalOmni ? collectSbSceneOnlyReferenceAbsoluteUrls(sb) : []
    const freeRefs = collectSbFreeReferenceAbsoluteUrls(sb)
    const primaryReferenceUrl = getSbPrimaryReferenceAbsoluteUrl(sb)
    const mainImageUrl = selectedGrid ? '' : toAbsoluteImageUrl((options.mainImageUrl || await getMainImageUrlForVideo(sb) || ''))
    let absoluteUrl = gridAbsoluteUrl || mainImageUrl || primaryReferenceUrl
    let referenceUrls = []

    if (universalOmni) {
      referenceUrls = uniqueStoryboardReferenceUrls(omniRefs, 10)
      if (!absoluteUrl) absoluteUrl = referenceUrls[0] || ''
    } else if (universal) {
      referenceUrls = uniqueStoryboardReferenceUrls([absoluteUrl, ...sceneOnlyRefs, ...freeRefs], 10)
      if (!absoluteUrl) absoluteUrl = referenceUrls[0] || ''
    } else {
      referenceUrls = uniqueStoryboardReferenceUrls([absoluteUrl, ...freeRefs], 10)
      if (!absoluteUrl) absoluteUrl = referenceUrls[0] || ''
    }

    const frameUrls = sbVideoFirstLastUrls(sb, universalOmni, options.contiguityFirstFrameUrl || null)
    const firstFrameUrl = selectedGrid ? gridAbsoluteUrl : (frameUrls.first || absoluteUrl || undefined)
    const lastFrameUrl = selectedGrid ? undefined : frameUrls.last
    if (!universalOmni && lastFrameUrl) {
      referenceUrls = uniqueStoryboardReferenceUrls([...referenceUrls, lastFrameUrl], 10)
    }

    return {
      absoluteUrl,
      gridAbsoluteUrl,
      referenceUrls: referenceUrls.length ? referenceUrls : undefined,
      firstFrameUrl,
      lastFrameUrl,
      omniRefs,
      sceneOnlyRefs,
    }
  }

  return {
    currentStoryboardReferenceState,
    findStoryboardRow,
    mergeStoryboardIntoStore,
    getSbFreeReferenceItems,
    getSbPrimaryFreeReferenceItem,
    collectSbFreeReferenceAbsoluteUrls,
    uniqueStoryboardReferenceUrls,
    saveStoryboardReferenceImages,
    openGlobalMediaPicker,
    onGlobalMediaAssetSelected,
    onRemoveSbFreeReferenceImage,
    onPromoteSbFreeReferenceImage,
    currentDramaReferenceEntities,
    getSbUniversalOmniRefSlots,
    collectSbOmniReferenceAbsoluteUrls,
    collectSbSceneOnlyReferenceAbsoluteUrls,
    getSbPrimaryReferenceAbsoluteUrl,
    buildStoryboardVideoReferencePayload,
  }
}
