import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import {
  BACKUP_ERROR_MESSAGES,
  describeBackupError,
} from '../src/composables/useBackupSettings.js'

const require = createRequire(import.meta.url)
const BACKUP_PUBLIC_MESSAGES = require('../../backend-node/src/services/backupPublicMessages.js')

const FRONTEND_ONLY_CODES = Object.freeze(['BACKUP_FILE_EMPTY', 'BACKUP_LIST_INVALID'])
const HIGHLIGHT_CODES = Object.freeze([
  'OUTPUT_CLEANUP_FAILED',
  'OUTPUT_COMMIT_FAILED',
  'MAINTENANCE_LOCK_RELEASE_FAILED',
  'PATH_CLAIM_RESTORE_FAILED',
  'ARCHIVE_CHANGED',
  'ARCHIVE_LIMIT_EXCEEDED',
  'ARCHIVE_UNAVAILABLE',
  'ARCHIVE_VALIDATION_FAILED',
  'ARCHIVE_WRITE_FAILED',
  'UNSUPPORTED_ARCHIVE',
  'UNEXPECTED_ARCHIVE_ENTRY',
])

test('前端备份错误码覆盖后端全部中文 publicMessage', () => {
  const backendCodes = Object.keys(BACKUP_PUBLIC_MESSAGES)
  assert.ok(backendCodes.length >= 80)
  for (const code of backendCodes) {
    assert.equal(
      BACKUP_ERROR_MESSAGES[code],
      BACKUP_PUBLIC_MESSAGES[code],
      `${code} 应与后端中文保持一致`,
    )
  }
  for (const code of FRONTEND_ONLY_CODES) {
    assert.match(BACKUP_ERROR_MESSAGES[code], /[㐀-鿿]/)
    assert.equal(BACKUP_PUBLIC_MESSAGES[code], undefined)
  }
})

test('重点备份错误码按 code 映射成后端中文', () => {
  for (const code of HIGHLIGHT_CODES) {
    assert.equal(
      describeBackupError({
        response: {
          data: {
            error: {
              code,
              message: 'The backup operation failed in English.',
            },
          },
        },
      }),
      BACKUP_PUBLIC_MESSAGES[code],
    )
    assert.equal(describeBackupError({ code, message: 'English fallback should be ignored.' }), BACKUP_PUBLIC_MESSAGES[code])
  }
})

test('无错误码时仍用英文正则兜底成中文', () => {
  assert.equal(
    describeBackupError({ message: 'The data backup could not be completed.' }),
    BACKUP_ERROR_MESSAGES.BACKUP_FAILED,
  )
  assert.equal(
    describeBackupError({ message: 'Stop the LocalMiniDrama backend before data backup or restore.' }),
    BACKUP_ERROR_MESSAGES.SERVICE_RUNNING,
  )
  assert.equal(
    describeBackupError({ message: 'The failed backup output could not be claimed without touching a replacement.' }),
    BACKUP_ERROR_MESSAGES.OUTPUT_CLEANUP_FAILED,
  )
  assert.equal(
    describeBackupError({ message: 'The claimed failed backup output could not be removed.' }),
    BACKUP_ERROR_MESSAGES.OUTPUT_CLEANUP_FAILED,
  )
  assert.equal(
    describeBackupError({ message: 'The backup output is not a regular file.' }),
    BACKUP_ERROR_MESSAGES.OUTPUT_COMMIT_FAILED,
  )
  assert.equal(
    describeBackupError({ message: 'The claimed service maintenance lock could not be removed.' }),
    BACKUP_ERROR_MESSAGES.MAINTENANCE_LOCK_RELEASE_FAILED,
  )
  assert.equal(
    describeBackupError({ message: 'The claimed maintenance recovery lease could not be removed.' }),
    BACKUP_ERROR_MESSAGES.MAINTENANCE_LOCK_RELEASE_FAILED,
  )
  assert.equal(
    describeBackupError({ message: 'Could not safely restore the claimed replacement path.' }),
    BACKUP_ERROR_MESSAGES.PATH_CLAIM_RESTORE_FAILED,
  )
  assert.equal(
    describeBackupError({ message: 'The private claim directory identity changed.' }),
    BACKUP_ERROR_MESSAGES.PATH_CLAIM_RESTORE_FAILED,
  )
  assert.equal(
    describeBackupError({ message: 'The archive uses unsupported numeric sizes or offsets.' }),
    BACKUP_ERROR_MESSAGES.UNSUPPORTED_ARCHIVE,
  )
  assert.equal(
    describeBackupError({ message: 'The descriptor-backed archive size is unsupported.' }),
    BACKUP_ERROR_MESSAGES.ARCHIVE_VALIDATION_FAILED,
  )
  assert.equal(
    describeBackupError({ message: 'The backup manifest is not valid JSON.' }),
    BACKUP_ERROR_MESSAGES.INVALID_MANIFEST,
  )
  assert.equal(
    describeBackupError({
      response: {
        data: {
          error: { message: '当前路径没有读写权限，请检查数据目录或备份输出目录的权限后重试。' },
        },
      },
    }),
    BACKUP_ERROR_MESSAGES.PERMISSION_DENIED,
  )
})
