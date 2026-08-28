import { ElMessage } from 'element-plus'

export function useFilmCreateResourceUpload(deps = {}) {
  const {
    dramaId,
    store,
    uploadAPI,
    characterAPI,
    propAPI,
    sceneAPI,
    loadDrama,
    resourceUploadType,
    resourceUploadId,
    resourceImageFileInput,
    uploadingResourceId,
  } = deps

  function onUploadResourceClick(type, id) {
    resourceUploadType.value = type
    resourceUploadId.value = id
    resourceImageFileInput.value?.click()
  }

  // 解析 extra_images JSON，返回 local_path 数组
  function parseExtraImages(item) {
    if (!item?.extra_images) return []
    try {
      const arr = typeof item.extra_images === 'string' ? JSON.parse(item.extra_images) : item.extra_images
      return Array.isArray(arr) ? arr.filter(Boolean) : []
    } catch { return [] }
  }

  // 将 local_path 转成可访问的 URL
  function localPathToUrl(p) {
    if (!p) return ''
    if (p.startsWith('http')) return p
    return '/static/' + p.replace(/^\//, '')
  }

  // 查找角色/道具/场景在 store 中的当前对象
  function findResource(type, id) {
    const list = type === 'character' ? (store.characters ?? [])
      : type === 'prop' ? (store.props ?? [])
      : (store.scenes ?? [])
    return list.find((x) => Number(x.id) === Number(id)) || null
  }

  async function doUploadResourceImage(type, id, file) {
    if (!file || !type || id == null) return
    const key = type === 'character' ? 'char-' : type === 'prop' ? 'prop-' : 'scene-'
    uploadingResourceId.value = key + id
    try {
      const res = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
      const data = res?.data ?? res
      const uploadedLocalPath = data?.local_path || data?.path || null
      const url = data?.url || uploadedLocalPath
      if (!url) { ElMessage.error('上传未返回地址'); return }

      const current = findResource(type, id)
      const hasPrimary = !!(current?.local_path || current?.image_url)

      if (hasPrimary) {
        // 已有主图 → 追加到 extra_images
        const extras = parseExtraImages(current)
        const newPath = uploadedLocalPath || url
        if (!extras.includes(newPath)) extras.push(newPath)
        const extraJson = JSON.stringify(extras)
        if (type === 'character') {
          await characterAPI.putImage(id, { extra_images: extraJson })
        } else if (type === 'prop') {
          await propAPI.update(id, { extra_images: extraJson })
        } else if (type === 'scene') {
          await sceneAPI.update(id, { extra_images: extraJson })
        }
      } else {
        // 无主图 → 设为主图
        if (type === 'character') {
          await characterAPI.putImage(id, { image_url: url, local_path: uploadedLocalPath ?? null })
        } else if (type === 'prop') {
          await propAPI.update(id, { image_url: url, local_path: uploadedLocalPath ?? null })
        } else if (type === 'scene') {
          await sceneAPI.update(id, { image_url: url, local_path: uploadedLocalPath ?? null })
        }
      }
      await loadDrama()
      ElMessage.success('上传成功')
    } catch (e) {
      ElMessage.error(e.message || '上传失败')
    } finally {
      uploadingResourceId.value = null
    }
  }

  // 将某张额外图片设为主图（主图降级到 extra_images 第一位）
  async function onSetPrimaryImage(type, item, extraPath) {
    const extras = parseExtraImages(item)
    const oldPrimary = item.local_path || ''
    const newExtras = extras.filter((p) => p !== extraPath)
    if (oldPrimary) newExtras.unshift(oldPrimary)
    const extraJson = JSON.stringify(newExtras)
    try {
      if (type === 'character') {
        await characterAPI.putImage(item.id, { local_path: extraPath, image_url: '', extra_images: extraJson })
      } else if (type === 'prop') {
        await propAPI.update(item.id, { local_path: extraPath, image_url: '', extra_images: extraJson })
      } else if (type === 'scene') {
        await sceneAPI.update(item.id, { local_path: extraPath, image_url: '', extra_images: extraJson })
      }
      await loadDrama()
    } catch (e) {
      ElMessage.error(e.message || '操作失败')
    }
  }

  // 删除某张额外图片
  async function onRemoveExtraImage(type, item, extraPath) {
    const extras = parseExtraImages(item).filter((p) => p !== extraPath)
    const extraJson = extras.length ? JSON.stringify(extras) : null
    try {
      if (type === 'character') {
        await characterAPI.putImage(item.id, { extra_images: extraJson })
      } else if (type === 'prop') {
        await propAPI.update(item.id, { extra_images: extraJson })
      } else if (type === 'scene') {
        await sceneAPI.update(item.id, { extra_images: extraJson })
      }
      await loadDrama()
    } catch (e) {
      ElMessage.error(e.message || '删除失败')
    }
  }

  function onResourceImageFileChange(ev) {
    const file = ev.target?.files?.[0]
    const type = resourceUploadType.value
    const id = resourceUploadId.value
    if (!file || !type || id == null) {
      ev.target.value = ''
      return
    }
    doUploadResourceImage(type, id, file).finally(() => {
      resourceUploadType.value = null
      resourceUploadId.value = null
      ev.target.value = ''
    })
  }

  return {
    onUploadResourceClick,
    parseExtraImages,
    localPathToUrl,
    findResource,
    doUploadResourceImage,
    onSetPrimaryImage,
    onRemoveExtraImage,
    onResourceImageFileChange,
  }
}
