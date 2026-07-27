const FIELD_DEFINITIONS = Object.freeze([
  Object.freeze({
    prop: 'service_type',
    field: 'service_type',
    label: '服务类型',
    message: '请选择服务类型',
    section: null,
  }),
  Object.freeze({
    prop: 'name',
    field: 'name',
    label: '名称',
    message: '请输入名称',
    section: null,
  }),
  Object.freeze({
    prop: 'provider',
    field: 'provider',
    label: '厂商',
    message: '请选择或输入厂商',
    section: null,
  }),
  Object.freeze({
    prop: 'api_key',
    field: 'api_key',
    label: 'API Key',
    message: '请输入有效的 API Key 或凭据',
    section: null,
    sensitive: true,
  }),
  Object.freeze({
    prop: 'api_protocol',
    field: 'api_protocol',
    label: '接口规范',
    message: '请选择接口规范',
    section: 'endpoint',
  }),
  Object.freeze({
    prop: 'base_url',
    field: 'base_url',
    label: 'Base URL',
    message: '请输入 Base URL',
    section: 'endpoint',
  }),
  Object.freeze({
    prop: 'comfy_workflow_json',
    field: 'comfy_workflow_json',
    label: 'Workflow JSON',
    message: '请填写有效的 Workflow JSON',
    section: 'endpoint',
  }),
  Object.freeze({
    prop: 'endpoint',
    field: 'endpoint',
    label: '提交端点',
    message: '请输入提交端点',
    section: 'endpoint',
  }),
  Object.freeze({
    prop: 'query_endpoint',
    field: 'query_endpoint',
    label: '查询端点',
    message: '请输入查询端点',
    section: 'endpoint',
  }),
  Object.freeze({
    prop: 'modelText',
    field: 'model',
    label: '模型',
    message: '请填写至少一个模型',
    section: null,
  }),
])

const FIELD_BY_NAME = new Map(
  FIELD_DEFINITIONS.flatMap((definition) => [
    [definition.prop, definition],
    [definition.field, definition],
  ]),
)

const FOCUSABLE_SELECTOR = [
  'input:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[role="combobox"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function firstValidationMessage(errors) {
  const entries = Array.isArray(errors) ? errors : [errors]
  const message = entries.find((entry) => entry?.message)?.message
  return typeof message === 'string' ? message.trim() : ''
}

export function getAiConfigFieldDescription(field) {
  return FIELD_BY_NAME.get(field)?.message || '请检查此字段'
}

export function createAiConfigValidationSummary(invalidFields) {
  const fields = invalidFields && typeof invalidFields === 'object' ? invalidFields : {}
  return FIELD_DEFINITIONS.flatMap((definition) => {
    if (!Object.hasOwn(fields, definition.prop)) return []
    const message = definition.sensitive
      ? definition.message
      : firstValidationMessage(fields[definition.prop]) || definition.message
    return [{
      field: definition.field,
      prop: definition.prop,
      label: definition.label,
      message,
      section: definition.section,
    }]
  })
}

function resolveFocusableElement(fieldElement) {
  if (fieldElement?.matches?.(FOCUSABLE_SELECTOR)) return fieldElement
  return fieldElement?.querySelector?.(FOCUSABLE_SELECTOR) || fieldElement
}

function scrollFieldIntoContainer(scrollContainer, fieldElement) {
  const scrollTarget = fieldElement?.closest?.('.el-form-item') || fieldElement
  if (!scrollContainer || !scrollTarget?.getBoundingClientRect) return

  const containerRect = scrollContainer.getBoundingClientRect?.()
  const targetRect = scrollTarget.getBoundingClientRect()
  if (!containerRect || !targetRect) return

  const centerOffset = Math.max(16, (scrollContainer.clientHeight - targetRect.height) / 2)
  const top = Math.max(
    0,
    Math.round(scrollContainer.scrollTop + targetRect.top - containerRect.top - centerOffset),
  )
  if (typeof scrollContainer.scrollTo === 'function') {
    scrollContainer.scrollTo({ top, behavior: 'smooth' })
  } else {
    scrollContainer.scrollTop = top
  }
}

export async function focusFirstInvalidAiConfigField(summary, {
  scrollContainer,
  expandSection,
  nextTickFn,
} = {}) {
  const firstInvalidField = Array.isArray(summary) ? summary[0] : null
  if (!firstInvalidField) return ''

  if (firstInvalidField.section) expandSection?.(firstInvalidField.section)
  await nextTickFn?.()

  const fieldElement = scrollContainer?.querySelector?.(
    `[data-ai-config-field="${firstInvalidField.field}"]`,
  )
  if (!fieldElement) return firstInvalidField.field

  scrollFieldIntoContainer(scrollContainer, fieldElement)
  resolveFocusableElement(fieldElement)?.focus?.({ preventScroll: true })
  return firstInvalidField.field
}
