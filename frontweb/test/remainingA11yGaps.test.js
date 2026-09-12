import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { readMediaLibrarySources } from './helpers/mediaLibrarySources.js'

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

const actionGate = read('../src/components/filmCreate/ActionGate.vue')
const runRecords = read('../src/components/sourceIntake/SourceIntakeRunRecordsPanel.vue')
const processStage = read('../src/components/sourceIntake/SourceIntakeProcessStageCard.vue')
const backupCss = read('../src/components/backup/backupPage.css')
const backupHeader = read('../src/components/backup/BackupHeader.vue')
const backupList = read('../src/components/backup/BackupList.vue')
const backupFailure = read('../src/components/backup/BackupFailureBanners.vue')
const backupSelected = read('../src/components/backup/BackupSelectedFile.vue')
const backupDialog = read('../src/components/backup/BackupRestoreDialog.vue')
const backupReadiness = read('../src/components/backup/BackupReadiness.vue')
const mediaSource = readMediaLibrarySources()
const inspector = read('../src/components/dramaCanvas/FreeCanvasInspector.vue')
const notFound = read('../src/views/NotFound.vue')

test('处理阶段失败区会播报错误，并把禁用原因和失败文案关联到控件', () => {
  assert.match(runRecords, /id="source-intake-run-error"/)
  assert.match(runRecords, /role="alert"/)
  assert.match(runRecords, /aria-live="assertive"/)
  assert.match(runRecords, /aria-atomic="true"/)
  assert.match(runRecords, /:role="runState.productionPlaceholder \? 'alert' : 'status'"/)
  assert.match(runRecords, /:aria-live="runState.productionPlaceholder \? 'assertive' : 'polite'"/)
  assert.match(runRecords, /run-error :deep\(\.el-button:focus-visible\)/)
  assert.match(runRecords, /extractionNextStep: \{ type: Object, default: null \}/)
  assert.match(runRecords, /defineEmits\(\['open-extraction-ai-config'\]\)/)

  assert.match(actionGate, /:aria-describedby="reasonId"/)
  assert.match(actionGate, /:id="reasonId"/)
  assert.match(actionGate, /action-gate:focus-visible/)

  assert.match(processStage, /:aria-describedby="runState.failedStep && displayedRunError \? 'source-intake-run-error' : undefined"/)
  assert.match(processStage, /status-block :deep\(\.el-button:focus-visible\)/)
  assert.match(processStage, /:extraction-next-step="extractionNextStepForRecords"/)
})

test('备份页禁用按钮用 aria-describedby 说明原因，失败区保持 live，焦点环可见', () => {
  assert.match(backupCss, /\.visually-hidden/)
  assert.match(backupCss, /:deep\(\.el-button:focus-visible\)/)
  assert.match(backupCss, /\.back-link:focus-visible/)

  assert.match(backupHeader, /id="backup-header-lock-reason"/)
  assert.match(backupHeader, /:aria-describedby="accessState.createLocked \? 'backup-header-lock-reason' : undefined"/)
  assert.match(backupHeader, /:aria-describedby="accessState.writeLocked \? 'backup-header-lock-reason' : undefined"/)

  assert.match(backupList, /id="backup-list-write-reason"/)
  assert.match(backupList, /id="backup-list-restore-reason"/)
  assert.match(backupList, /:aria-describedby="accessState.restoreFromListLocked \? 'backup-list-restore-reason' : undefined"/)
  assert.match(backupList, /role="status"[\s\S]*aria-live="polite"/)

  assert.match(backupFailure, /id="backup-list-load-error"/)
  assert.match(backupFailure, /id="backup-file-error"/)
  assert.match(backupFailure, /id="backup-action-error"/)
  assert.match(backupFailure, /aria-live="assertive"/)
  assert.match(backupFailure, /:aria-describedby="loading \? 'backup-list-loading-reason' : 'backup-list-load-error'"/)
  assert.match(backupFailure, /:aria-describedby="accessState.writeLocked \? 'backup-failure-write-reason' : 'backup-file-error'"/)

  assert.match(backupSelected, /id="backup-selected-lock-reason"/)
  assert.match(backupSelected, /:aria-describedby="accessState.restoreLocked \? 'backup-selected-lock-reason' : undefined"/)
  assert.match(backupSelected, /role="status" aria-live="polite"/)

  assert.match(backupDialog, /:aria-describedby="restoring \? 'backup-dialog-restoring-reason' : undefined"/)
  assert.match(backupDialog, /:aria-describedby="accessState.restoreLocked \? 'backup-dialog-lock-reason' : undefined"/)

  assert.match(backupDialog, /backupPage\.css/)
  assert.match(backupReadiness, /id="backup-readiness-error"/)
  assert.match(backupReadiness, /aria-live="assertive"/)
  assert.match(backupReadiness, /:aria-describedby="readinessLoading \? 'backup-readiness-loading-reason' : 'backup-readiness-error'"/)
})

test('素材中心禁用原因挂到 aria-describedby，空态和上传进度可被读屏听到', () => {
  assert.match(mediaSource, /id="media-header-upload-reason"/)
  assert.match(mediaSource, /:aria-describedby="mediaUploadDisableReason \? 'media-header-upload-reason' : undefined"/)
  assert.match(mediaSource, /id="media-list-load-error"/)
  assert.match(mediaSource, /id="media-write-lock-reason"/)
  assert.match(mediaSource, /:aria-describedby="mediaRetryLoadDisableReason \? 'media-retry-load-reason' : 'media-list-load-error'"/)
  assert.match(mediaSource, /:aria-describedby="mediaBatchDeleteDisableReason \? 'media-batch-delete-reason' : undefined"/)
  assert.match(mediaSource, /class="upload-progress" role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(mediaSource, /class="empty-media" role="status" aria-live="polite"/)
  assert.match(mediaSource, /class="network-state" role="status" aria-live="polite"/)
  assert.match(mediaSource, /:aria-describedby="networkSearchDisableReason \? 'media-network-search-reason' : undefined"/)
  assert.match(mediaSource, /:id="`network-import-reason-\$\{index\}`"/)
  assert.match(mediaSource, /:aria-describedby="\(isNetworkImporting\(item\) \|\| !networkItemImportability\(item\)\.allowed\) \? `network-import-reason-\$\{index\}` : undefined"/)
  assert.match(mediaSource, /:aria-describedby="mediaWriteLocked \? writeLockDescribedBy : undefined"/)
  assert.match(mediaSource, /\.header-actions :deep\(\.el-button:focus-visible\)/)
  assert.match(mediaSource, /\.overlay-actions :deep\(\.el-button:focus-visible\)/)
  assert.match(mediaSource, /\.network-thumb:focus-visible/)
})

test('自由画布检查器禁用原因用 aria-describedby，停止等待文案不变', () => {
  assert.match(inspector, /id="free-inspector-editor-reason"/)
  assert.match(inspector, /id="free-inspector-config-action-reason"/)
  assert.match(inspector, /:aria-describedby="editorDisabled \? 'free-inspector-editor-reason' : undefined"/)
  assert.match(inspector, /:aria-describedby="generateDisabled \? 'free-inspector-generate-reason' : undefined"/)
  assert.match(inspector, /:aria-describedby="\(readonly \|\| busy\) \? 'free-inspector-config-action-reason' : undefined"/)
  assert.match(inspector, /:aria-describedby="\(editorDisabled \|\| !conversionTarget\) \? 'free-inspector-convert-reason' : undefined"/)
  assert.match(inspector, /id="free-inspector-save-reason"/)
  assert.match(inspector, /aria-label="停止等待"/)
  assert.match(inspector, /title="停止当前页面等待；已提交任务可能继续执行或计费"/)
  assert.match(inspector, />\s*停止等待\s*</)
  assert.match(inspector, /:aria-live="\['failed', 'error'\]\.includes\(configRuntime\.status\) \? 'assertive' : 'polite'"/)
  assert.match(inspector, /:deep\(\.el-select \.el-input__wrapper\.is-focus\)/)
  assert.match(inspector, /\.free-canvas-inspector:focus-visible/)
})

test('404 返回项目列表文案保持不变', () => {
  assert.match(notFound, />返回项目列表<\/el-button>/)
  assert.match(notFound, /aria-label="返回项目列表"/)
})

test('弹窗关闭按钮和素材导入禁用原因保持具体中文名', () => {
  const accessibleDialog = read('../src/components/AccessibleDialog.vue')
  const sourceImport = read('../src/components/mediaLibrary/MediaLibrarySourceImportDialog.vue')
  const intakeForm = read('../src/components/sourceIntake/SourceIntakeIntakeStageForm.vue')
  const deliveryStage = read('../src/components/sourceIntake/SourceIntakeDeliveryStageCard.vue')
  assert.match(accessibleDialog, /关闭此对话框/)
  assert.doesNotMatch(accessibleDialog, /setAttribute\('aria-label', '关闭'\)/)
  assert.match(sourceImport, /id="source-import-picker-reason"/)
  assert.match(sourceImport, /pickerBusyReason/)
  assert.match(mediaSource, /navigationLockReason: mediaNavigationLockReason\.value/)
  assert.match(intakeForm, /sourceUploadBusyReason \|\| '选择故事素材文件'/)
  assert.match(intakeForm, />选择故事素材文件<\/el-button>/)
  assert.match(deliveryStage, /aria-label="继续导入故事素材"/)
  assert.match(deliveryStage, />继续导入故事素材<\/el-button>/)
})
