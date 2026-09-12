/** 制作页快捷导航步骤状态与溢出任务读屏文案 */

export function navStepStatusLabel(status) {
  if (status === 'done') return '已完成'
  if (status === 'partial') return '部分完成'
  if (status === 'generating') return '生成中'
  return '未开始'
}

export function navStepLabel(step = {}) {
  return `跳转到${step.label}（${navStepStatusLabel(step.status)}）`
}

export function describeOverflowTaskCopy(allActiveTaskItems = []) {
  const items = Array.isArray(allActiveTaskItems) ? allActiveTaskItems.slice(8) : []
  const labels = items.map((item) => item?.label).filter(Boolean)
  const count = items.length
  return {
    items,
    count,
    title: labels.join('\n'),
    ariaLabel: labels.length
      ? `还有 ${count} 个任务未列出：${labels.join('、')}`
      : `还有 ${count} 个任务未列出`,
  }
}
