/**
 * 读取备份页及其拆出的区块源码，供源码合同覆盖完整 UI。
 */
import { readFileSync } from 'node:fs'

export const BACKUP_PAGE_FILES = Object.freeze([
  '../../src/views/Backup.vue',
  '../../src/components/backup/BackupHeader.vue',
  '../../src/components/backup/BackupReadiness.vue',
  '../../src/components/backup/BackupFailureBanners.vue',
  '../../src/components/backup/BackupSelectedFile.vue',
  '../../src/components/backup/BackupList.vue',
  '../../src/components/backup/BackupRestoreDialog.vue',
  '../../src/components/backup/backupPageCopy.js',
])

function readPageFile(path, metaUrl) {
  return readFileSync(new URL(path, metaUrl), 'utf8').replace(/\r\n?/g, '\n')
}

export const BACKUP_SETTINGS_FILES = Object.freeze([
  '../../src/composables/useBackupSettings.js',
  '../../src/composables/useBackupSettingsRestore.js',
])

export function readBackupPageSource(metaUrl = import.meta.url) {
  return BACKUP_PAGE_FILES.map((path) => readPageFile(path, metaUrl)).join('\n')
}

export function readBackupSettingsSource(metaUrl = import.meta.url) {
  return BACKUP_SETTINGS_FILES.map((path) => readPageFile(path, metaUrl)).join('\n')
}

export function readBackupPageTemplates(metaUrl = import.meta.url) {
  const source = readBackupPageSource(metaUrl)
  const parts = []
  let start = 0
  while (true) {
    const templateStart = source.indexOf('<template', start)
    if (templateStart < 0) break
    const scriptStart = source.indexOf('<script', templateStart)
    if (scriptStart < 0) break
    parts.push(source.slice(templateStart, scriptStart))
    start = scriptStart + 1
  }
  return parts.join('\n')
}
