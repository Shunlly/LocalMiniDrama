export function getFreeCanvasContextBarModel({
  node = null,
  readonly = false,
  busy = false,
  configRuntime = null,
  saveAssetEligibility = null,
} = {}) {
  if (!node || typeof node !== 'object') {
    return { visible: false, title: '', actions: [] }
  }

  const title = String(node.title || node.label || node.name || '自由节点').trim() || '自由节点'
  const blockedReason = readonly
    ? '当前为只读，不能操作'
    : (busy ? '节点忙碌时不能操作' : '')
  const actions = [
    {
      id: 'copy',
      label: '复制',
      ariaLabel: blockedReason ? `复制不可用：${blockedReason}` : '复制所选节点',
      disabled: Boolean(blockedReason),
      reason: blockedReason,
    },
    {
      id: 'delete',
      label: '删除',
      ariaLabel: blockedReason ? `删除不可用：${blockedReason}` : '删除所选节点',
      disabled: Boolean(blockedReason),
      reason: blockedReason,
      danger: true,
    },
  ]

  if (node.type === 'config') {
    const runtime = configRuntime && typeof configRuntime === 'object' ? configRuntime : {}
    if (runtime.canCancel) {
      actions.push({
        id: 'cancel',
        label: '停止等待',
        ariaLabel: '停止等待',
        disabled: Boolean(blockedReason),
        reason: blockedReason || '停止当前页面等待；已提交任务可能继续执行或计费',
      })
    } else {
      const generateDisabledReason = blockedReason
        || runtime.generateDisabledReason
        || runtime.reason
        || '当前不能生成，请先完成 AI 配置'
      actions.push({
        id: 'generate',
        label: '生成',
        ariaLabel: runtime.canGenerate && !blockedReason ? '生成' : generateDisabledReason,
        disabled: Boolean(blockedReason) || !runtime.canGenerate,
        reason: generateDisabledReason,
        primary: true,
      })
      actions.push({
        id: 'configure',
        label: 'AI 配置',
        ariaLabel: blockedReason ? `AI 配置不可用：${blockedReason}` : 'AI 配置',
        disabled: Boolean(blockedReason),
        reason: blockedReason,
      })
    }
  }

  if (saveAssetEligibility?.eligible) {
    actions.push({
      id: 'save-asset',
      label: '保存为素材',
      ariaLabel: blockedReason ? `保存为素材不可用：${blockedReason}` : '保存为素材',
      disabled: Boolean(blockedReason),
      reason: blockedReason,
    })
  }

  return { visible: true, title, actions }
}
