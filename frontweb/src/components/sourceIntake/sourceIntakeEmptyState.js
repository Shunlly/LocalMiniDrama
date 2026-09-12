export const SOURCE_INTAKE_EMPTY_FOCUS_LABEL = '去填写素材'

export function buildSourceIntakeEmptyRecordsView({
  emptyState,
  workflowModeShortLabel,
  operationError,
  extractionNextStep,
} = {}) {
  const error = String(operationError || '').trim()
  const modeLabel = String(workflowModeShortLabel || '草稿预演')
  return {
    title: emptyState?.title || '还没有已导入素材',
    description: emptyState?.description || '',
    hint: `可用上方「导入故事素材」或「导入并启动${modeLabel}」保存后，记录会显示在这里。`,
    recoveryMessage: error ? `导入未完成：${error}` : '',
    extractionNextStep: error ? (extractionNextStep || null) : null,
    focusActionLabel: SOURCE_INTAKE_EMPTY_FOCUS_LABEL,
  }
}
