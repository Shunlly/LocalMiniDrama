import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PANEL = '../../src/components/SourceIntakeWorkflowPanel.vue'
const DIR = '../../src/components/sourceIntake/'

export function readSourceIntakeWorkflowSources(metaUrl = import.meta.url) {
  const files = [readFileSync(new URL(PANEL, metaUrl), 'utf8')]
  const dirUrl = new URL(DIR, metaUrl)
  const names = readdirSync(fileURLToPath(dirUrl))
    .filter((name) => /\.(vue|js)$/.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))
  for (const name of names) {
    files.push(readFileSync(new URL(name, dirUrl), 'utf8'))
  }
  return files.join('\n')
}
