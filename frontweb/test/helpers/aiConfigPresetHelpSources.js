/**
 * 把预设帮助的折叠容器、正文组件和文案数据拼成一棵源码树，供 source match 测试使用。
 */
import { readFileSync } from 'node:fs'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

export const AI_CONFIG_PRESET_HELP_FILES = [
  'AiConfigPresetHelpCollapse.vue',
  'AiConfigPresetHelpBody.vue',
  'aiConfigPresetHelpSections.js',
]

export function readAiConfigPresetHelpSource(name) {
  return readSource(new URL(`../../src/components/aiConfig/${name}`, import.meta.url))
}

export function readAiConfigPresetHelpTreeSource() {
  return AI_CONFIG_PRESET_HELP_FILES.map((name) => readAiConfigPresetHelpSource(name)).join('\n')
}
