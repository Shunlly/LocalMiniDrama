export function hasUnsavedAiConfigChanges(editors = []) {
  return editors.some((editor) => editor?.hasUnsavedChanges?.() === true)
}
