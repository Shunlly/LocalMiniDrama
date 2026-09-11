/** 分镜视频列宫格参考展示文案 */

function samePositiveGridId(left, right) {
  if (left == null || right == null || left === '' || right === '') return false
  const a = Number(left)
  const b = Number(right)
  if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) return a === b
  return String(left) === String(right)
}

export function isStoryboardGridSequenceMode(gridMode) {
  const mode = String(gridMode || 'single')
  return mode === 'quad_grid' || mode === 'nine_grid'
}

/**
 * 根据序列图模式和可选取值器，描述宫格参考图的可见状态。
 * 单张模式隐藏；四/九宫格才展示，并标明可选。
 */
export function describeSbVideoGridReference({
  sb,
  storyboardIndex = 0,
  gridMode = 'single',
  getSbGridImages,
  getSbVideoReferenceGrid,
  onOpenVideoParams,
} = {}) {
  const storyboardNumber = sb?.storyboard_number || storyboardIndex + 1
  const storyboardId = sb?.id
  if (!isStoryboardGridSequenceMode(gridMode)) {
    return {
      visible: false,
      optional: false,
      hasSelected: false,
      statusText: '',
      hintText: '',
      canOpenParams: false,
      actionText: '',
      ariaLabel: '',
      actionAriaLabel: '',
    }
  }

  const gridImages = typeof getSbGridImages === 'function'
    ? getSbGridImages(storyboardId)
    : null
  const availableImages = Array.isArray(gridImages) ? gridImages : []
  const knowsGridList = typeof getSbGridImages === 'function'

  let selected = null
  if (typeof getSbVideoReferenceGrid === 'function') {
    selected = getSbVideoReferenceGrid(sb) || null
  } else {
    const selectedId = Number(sb?.video_reference_image_id)
    if (Number.isFinite(selectedId) && selectedId > 0) {
      if (knowsGridList) {
        selected = availableImages.find((image) => samePositiveGridId(image?.id, selectedId)) || null
      } else {
        selected = { id: selectedId }
      }
    }
  }

  const selectedId = Number(selected?.id)
  const hasSelected = Number.isFinite(selectedId) && selectedId > 0
  const statusText = hasSelected ? '已选宫格参考（可选）' : '未选宫格参考（可选）'
  let hintText = ''
  if (hasSelected) {
    if (selected.frame_type === 'nine_grid') hintText = `九宫格整图 #${selected.id}`
    else if (selected.frame_type === 'quad_grid') hintText = `四宫格整图 #${selected.id}`
    else hintText = `宫格整图 #${selected.id}`
  } else if (knowsGridList && availableImages.length === 0) {
    hintText = '可选：可先生成宫格图，再到「视频参数」中选择'
  } else {
    hintText = '可选：可到「视频参数」中选择宫格参考图'
  }

  const canOpenParams = typeof onOpenVideoParams === 'function'
  return {
    visible: true,
    optional: true,
    hasSelected,
    statusText,
    hintText,
    canOpenParams,
    actionText: canOpenParams ? (hasSelected ? '更换' : '去选择') : '',
    ariaLabel: `分镜${storyboardNumber}${statusText}`,
    actionAriaLabel: hasSelected
      ? `打开分镜${storyboardNumber}视频参数更换宫格参考图`
      : `打开分镜${storyboardNumber}视频参数选择宫格参考图`,
  }
}
