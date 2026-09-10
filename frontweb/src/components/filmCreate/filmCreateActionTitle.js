/** 禁用或进行中按钮的中文 title：进行中优先，其次用禁用原因。 */
export function filmCreateActionTitle(reason, loading = false, loadingText = '正在处理，请稍候') {
  if (loading) {
    const text = String(loadingText || '').trim()
    return text || '正在处理，请稍候'
  }
  const text = String(reason || '').trim()
  return text || undefined
}
