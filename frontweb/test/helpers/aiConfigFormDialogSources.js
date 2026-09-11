import { readFileSync } from 'node:fs'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

export const AI_CONFIG_FORM_SECTION_FILES = [
  'AiConfigFormDialog.vue',
  'AiConfigFormLockSection.vue',
  'AiConfigFormBasicSection.vue',
  'AiConfigFormVendorSection.vue',
  'AiConfigFormEndpointSection.vue',
  'AiConfigFormModelSection.vue',
  'AiConfigFormPolicySection.vue',
]

export function readAiConfigFormSectionSource(name) {
  return readSource(new URL(`../../src/components/aiConfig/${name}`, import.meta.url))
}

export function readAiConfigFormSectionSources() {
  return AI_CONFIG_FORM_SECTION_FILES.map((name) => readAiConfigFormSectionSource(name))
}

export function readAiConfigFormDialogTreeSource() {
  return readAiConfigFormSectionSources().join('\n')
}
