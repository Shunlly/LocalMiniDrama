import test from 'node:test'
import assert from 'node:assert/strict'

import { computed, defineComponent, h, nextTick, ref } from 'vue'

import { backupAccessState } from '../src/composables/useBackupSettings.js'
import {
  BACKUP_LEAVE_CONFIRM_MESSAGE,
  confirmBackupLeave,
  getBackupRestoreLockReason,
  getBackupWriteLockReason,
} from '../src/components/backup/backupPageCopy.js'
import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  dataModule,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import {
  compileVueRouterStub,
  ensureWindowShim,
  installVueRouterHarness,
  resetVueRouterHarness,
} from './helpers/vueRouterHarness.js'

ensureWindowShim()

const pageUrl = new URL('../src/views/Backup.vue', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowLeft', 'Download', 'Refresh', 'Upload'])
const routerStubUrl = compileVueRouterStub()
const feedbackStubUrl = dataModule(`
  export const ElMessage = {
    success() {},
    error() {},
    warning() {},
  }
  export const ElMessageBox = {
    async confirm() { return true },
  }
`)
const backupSettingsStubUrl = dataModule(`
  export function formatBackupSize(bytes) {
    return bytes ? '2 KB' : ''
  }
  export function formatBackupTimestamp(value) {
    return value ? '2026年8月29日 08:00' : ''
  }
  export function normalizeBackupReturnTo(value) {
    const raw = Array.isArray(value) ? value[0] : value
    return raw === '/ai-config' ? '/ai-config' : ''
  }
  export function useBackupSettings() {
    return globalThis.__backupPageSettings
  }
`)

const backupChildReplacements = new Map([
  ['vue', vueUrl],
  ['@element-plus/icons-vue', iconStubUrl],
])
function compileBackupChild(name, id) {
  return compileSfc(new URL(`../src/components/backup/${name}`, import.meta.url), id, backupChildReplacements)
}
const BackupPage = await loadCompiledSfc(
  pageUrl,
  'backup-page-component',
  new Map([
    ['vue', vueUrl],
    ['vue-router', routerStubUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/utils/elementPlusFeedback.js', feedbackStubUrl],
    ['@/composables/useBackupSettings.js', backupSettingsStubUrl],
    ['@/components/backup/backupPageCopy.js', new URL('../src/components/backup/backupPageCopy.js', import.meta.url).href],
    ['@/components/backup/BackupHeader.vue', compileBackupChild('BackupHeader.vue', 'backup-header')],
    ['@/components/backup/BackupReadiness.vue', compileBackupChild('BackupReadiness.vue', 'backup-readiness')],
    ['@/components/backup/BackupFailureBanners.vue', compileBackupChild('BackupFailureBanners.vue', 'backup-failure')],
    ['@/components/backup/BackupSelectedFile.vue', compileBackupChild('BackupSelectedFile.vue', 'backup-selected')],
    ['@/components/backup/BackupList.vue', compileBackupChild('BackupList.vue', 'backup-list')],
    ['@/components/backup/BackupRestoreDialog.vue', compileBackupChild('BackupRestoreDialog.vue', 'backup-restore')],
  ]),
)

const renderer = createHostRenderer()
const AccessibleDialogStub = defineComponent({
  name: 'AccessibleDialog',
  props: ['modelValue', 'title', 'width'],
  setup(props, { slots }) {
    return () => {
      if (!props.modelValue) return null
      return h('dialog', { 'data-title': props.title || '' }, [
        h('dialog-body', {}, slots.default?.()),
        h('dialog-footer', {}, slots.footer?.()),
      ])
    }
  },
})

function noop() {}

function createBackupSettings(overrides = {}) {
  const backups = ref(overrides.backups || [])
  const loading = ref(Boolean(overrides.loading))
  const creating = ref(Boolean(overrides.creating))
  const restoring = ref(Boolean(overrides.restoring))
  const hasSuccessfulListLoad = ref(overrides.hasSuccessfulListLoad ?? false)
  const listError = ref(overrides.listError || '')
  const fileError = ref(overrides.fileError || '')
  const fileErrorName = ref(overrides.fileErrorName || '')
  const actionError = ref(overrides.actionError || '')
  const lastFailedAction = ref(overrides.lastFailedAction || '')
  const selectedFile = ref(overrides.selectedFile || null)
  const cancelCalls = []
  const restoreDialogVisible = ref(false)
  const readinessLoading = ref(Boolean(overrides.readinessLoading))
  const readinessError = ref(overrides.readinessError || '')
  const hasSuccessfulReadinessLoad = ref(overrides.hasSuccessfulReadinessLoad ?? false)
  const readiness = ref(overrides.readiness || null)
  const restoreCalls = []
  const accessState = computed(() => backupAccessState({
    loading: loading.value,
    creating: creating.value,
    restoring: restoring.value,
    hasSuccessfulLoad: hasSuccessfulListLoad.value,
    loadError: listError.value,
    itemCount: backups.value.length,
    maintenanceBlocked: Boolean(hasSuccessfulReadinessLoad.value && readiness.value && readiness.value.ready === false),
  }))
  const listIsStale = computed(() => Boolean(listError.value) && hasSuccessfulListLoad.value)
  const restoreCopy = computed(() => ({
    title: '恢复确认',
    body: '恢复会覆盖当前数据。',
    cancelButtonText: '取消',
    confirmButtonText: '确认恢复',
  }))
  const state = {
    backups,
    loading,
    creating,
    restoring,
    hasSuccessfulListLoad,
    listError,
    listIsStale,
    fileError,
    fileErrorName,
    actionError,
    lastFailedAction,
    selectedFile,
    restoreDialogVisible,
    restoreCopy,
    accessState,
    readinessLoading,
    readinessError,
    hasSuccessfulReadinessLoad,
    readiness,
    restoreCalls,
    cancelCalls,
    loadBackups: noop,
    loadReadiness: noop,
    createBackup: async () => ({ ok: true }),
    selectBackupFile: noop,
    requestRestoreFromSelection: () => false,
    requestRestoreFromItem: (item) => {
      restoreCalls.push(item)
      return true
    },
    confirmRestore: async () => ({ ok: true }),
    retryRestore: async () => ({ ok: true }),
    cancelRestore: () => {
      cancelCalls.push('cancel')
      restoreDialogVisible.value = false
    },
    dismissFileError: noop,
    dismissActionError: noop,
    clearSelectedFile: noop,
    dispose: noop,
  }
  globalThis.__backupPageSettings = state
  return state
}

function mountBackup(settingsOverrides = {}, routeOverrides = {}) {
  const settings = createBackupSettings(settingsOverrides)
  const router = installVueRouterHarness({
    name: 'backup',
    fullPath: '/backup',
    ...routeOverrides,
  })
  const leaveRegistrations = []
  const leaveProtection = {
    register(id, handlers) {
      leaveRegistrations.push({ id, handlers })
      return () => leaveRegistrations.push({ id, unregistered: true })
    },
  }
  const mounted = mountHarness(renderer, () => h(BackupPage), {
    components: { AccessibleDialog: AccessibleDialogStub },
    provide: { appRouteLeaveProtection: leaveProtection },
  })
  return { ...mounted, settings, router, leaveRegistrations }
}

test('维护锁定时，列表恢复禁用并给出维护原因', async () => {
  const harness = mountBackup({
    backups: [{ id: 'keep.zip', name: 'keep.zip', createdAt: '2026-08-29T00:00:00Z', bytes: 2048 }],
    hasSuccessfulListLoad: true,
    hasSuccessfulReadinessLoad: true,
    readiness: {
      ready: false,
      maintenanceError: '维护锁仍有效，请完成或恢复中断的维护后再试。',
    },
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /维护租约不可用/)
    assert.match(textContent(harness.root), /维护锁仍有效，请完成或恢复中断的维护后再试。/)
    const restore = buttonByAriaLabel(harness.root, '恢复备份 keep.zip')
    assert.ok(restore)
    assert.equal(restore.props.disabled, true)
    assert.equal(restore.props.title, '维护锁仍有效，请完成或恢复中断的维护后再试。')
    assert.deepEqual(harness.settings.restoreCalls, [])
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('列表尚未就绪时不提供恢复入口，只展示加载中文案', async () => {
  const harness = mountBackup({
    loading: true,
    hasSuccessfulListLoad: false,
    backups: [],
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /正在加载备份列表/)
    assert.equal(buttonByAriaLabel(harness.root, '恢复备份 keep.zip'), undefined)
    assert.equal(buttonByText(harness.root, '恢复'), undefined)
    assert.equal(buttonByAriaLabel(harness.root, '创建全量备份')?.props.disabled, true)
    assert.equal(buttonByAriaLabel(harness.root, '创建全量备份')?.props.title, '备份列表正在加载，请稍候')
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('列表刷新失败时，过期列表的恢复按钮锁在刷新失败原因上', async () => {
  const harness = mountBackup({
    backups: [{ id: 'keep.zip', name: 'keep.zip', createdAt: '2026-08-29T00:00:00Z', bytes: 2048 }],
    hasSuccessfulListLoad: true,
    listError: '备份服务暂时不可用（HTTP 503）',
    hasSuccessfulReadinessLoad: true,
    readiness: { ready: true, maintenanceError: '' },
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /备份列表刷新失败/)
    const restore = buttonByAriaLabel(harness.root, '恢复备份 keep.zip')
    assert.ok(restore)
    assert.equal(restore.props.disabled, true)
    assert.equal(restore.props.title, '备份列表刷新失败，成功重试前不能从列表恢复')
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('列表就绪且维护正常时，恢复入口可点', async () => {
  const harness = mountBackup({
    backups: [{ id: 'keep.zip', name: 'keep.zip', createdAt: '2026-08-29T00:00:00Z', bytes: 2048 }],
    hasSuccessfulListLoad: true,
    hasSuccessfulReadinessLoad: true,
    readiness: { ready: true, maintenanceError: '' },
  })
  try {
    await nextTick()
    const restore = buttonByAriaLabel(harness.root, '恢复备份 keep.zip')
    assert.ok(restore)
    assert.notEqual(restore.props.disabled, true)
    assert.equal(restore.props.title, undefined)
    click(restore)
    assert.equal(harness.settings.restoreCalls.length, 1)
    assert.equal(harness.settings.restoreCalls[0].name, 'keep.zip')
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})


test('维护状态首次加载时展示确认中文案，而不是失败或正常空态', async () => {
  const harness = mountBackup({
    readinessLoading: true,
    hasSuccessfulReadinessLoad: false,
    readiness: null,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /正在确认维护租约/)
    assert.doesNotMatch(textContent(harness.root), /维护状态加载失败/)
    assert.doesNotMatch(textContent(harness.root), /维护租约正常/)
    assert.doesNotMatch(textContent(harness.root), /维护租约不可用/)
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('恢复确认取消按钮有中文读屏名称', async () => {
  const harness = mountBackup({
    backups: [{ id: 'keep.zip', name: 'keep.zip', createdAt: '2026-08-29T00:00:00Z', bytes: 2048 }],
    hasSuccessfulListLoad: true,
    hasSuccessfulReadinessLoad: true,
    readiness: { ready: true, maintenanceError: '' },
  })
  try {
    await nextTick()
    harness.settings.restoreDialogVisible.value = true
    await nextTick()
    const cancel = buttonByAriaLabel(harness.root, '取消恢复备份')
    assert.ok(cancel)
    assert.equal(buttonByAriaLabel(harness.root, '确认恢复备份')?.props['aria-label'], '确认恢复备份')
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('维护状态刷新失败时仍显示上次成功读取的租约，且不误锁恢复', async () => {
  const harness = mountBackup({
    backups: [{ id: 'keep.zip', name: 'keep.zip', createdAt: '2026-08-29T00:00:00Z', bytes: 2048 }],
    hasSuccessfulListLoad: true,
    hasSuccessfulReadinessLoad: true,
    readinessError: '维护服务暂时不可用（HTTP 503）',
    readiness: { ready: true, maintenanceError: '' },
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /维护状态刷新失败/)
    assert.match(textContent(harness.root), /下方显示上次成功读取的维护状态/)
    assert.match(textContent(harness.root), /维护租约正常/)
    assert.match(textContent(harness.root), /当前内容已过期，以上为上次成功读取的维护状态/)
    const restore = buttonByAriaLabel(harness.root, '恢复备份 keep.zip')
    assert.ok(restore)
    assert.notEqual(restore.props.disabled, true)
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('刷新维护状态时保留上次租约，不回退成首次加载空态', async () => {
  const harness = mountBackup({
    readinessLoading: true,
    hasSuccessfulReadinessLoad: true,
    readiness: { ready: true, maintenanceError: '' },
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /维护租约正常/)
    assert.match(textContent(harness.root), /正在刷新维护状态/)
    assert.doesNotMatch(textContent(harness.root), /正在确认维护租约/)
    assert.doesNotMatch(textContent(harness.root), /维护状态加载失败/)
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('恢复确认取消按钮读屏名和可见文案都是取消恢复备份', async () => {
  const harness = mountBackup({
    backups: [{ id: 'keep.zip', name: 'keep.zip', createdAt: '2026-08-29T00:00:00Z', bytes: 2048 }],
    hasSuccessfulListLoad: true,
    hasSuccessfulReadinessLoad: true,
    readiness: { ready: true, maintenanceError: '' },
  })
  try {
    await nextTick()
    harness.settings.restoreDialogVisible.value = true
    await nextTick()
    const cancel = buttonByAriaLabel(harness.root, '取消恢复备份')
    assert.ok(cancel)
    assert.equal(cancel.props['aria-label'], '取消恢复备份')
    assert.equal(textContent(cancel).replace(/\s+/g, ' ').trim(), '取消恢复备份')
    assert.equal(buttonByAriaLabel(harness.root, '取消'), undefined)
    assert.equal(buttonByText(harness.root, '取消'), undefined)
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('空态选择按钮读屏名包含可见文案选择已有备份', async () => {
  const harness = mountBackup({
    backups: [],
    hasSuccessfulListLoad: true,
    hasSuccessfulReadinessLoad: true,
    readiness: { ready: true, maintenanceError: '' },
  })
  try {
    await nextTick()
    const emptySelect = buttonByAriaLabel(harness.root, '空态选择已有备份')
    assert.ok(emptySelect)
    assert.match(textContent(emptySelect), /选择已有备份/)
    assert.equal(buttonByAriaLabel(harness.root, '空态选择备份文件'), undefined)
    assert.equal(buttonByAriaLabel(harness.root, '选择备份文件')?.props['aria-label'], '选择备份文件')
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('空备份列表展示空态，不出现恢复入口', async () => {
  const harness = mountBackup({
    backups: [],
    hasSuccessfulListLoad: true,
    hasSuccessfulReadinessLoad: true,
    readiness: { ready: true, maintenanceError: '' },
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /还没有备份/)
    assert.match(textContent(harness.root), /可以创建新备份，或选择已有备份文件恢复/)
    assert.ok(buttonByAriaLabel(harness.root, '空态创建备份'))
    assert.equal(buttonByText(harness.root, '恢复'), undefined)
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('备份文件选择失败和操作失败都能关闭或重试', async () => {
  const harness = mountBackup({
    backups: [],
    hasSuccessfulListLoad: true,
    hasSuccessfulReadinessLoad: true,
    readiness: { ready: true, maintenanceError: '' },
    fileError: '请选择 zip 备份文件',
    fileErrorName: 'notes.txt',
    actionError: '数据恢复未能完成。',
    lastFailedAction: 'restore',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /备份文件选择失败/)
    assert.match(textContent(harness.root), /文件：notes.txt/)
    assert.match(textContent(harness.root), /备份操作失败/)
    assert.match(textContent(harness.root), /数据恢复未能完成/)
    const retry = buttonByAriaLabel(harness.root, '重试恢复备份')
    assert.ok(retry)
    assert.equal(textContent(retry).replace(/\s+/g, ' ').trim(), '重试恢复')
    click(buttonByAriaLabel(harness.root, '关闭备份文件错误'))
    click(buttonByAriaLabel(harness.root, '关闭备份操作错误'))
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('点击取消恢复备份会关掉确认框', async () => {
  const harness = mountBackup({
    backups: [{ id: 'keep.zip', name: 'keep.zip', createdAt: '2026-08-29T00:00:00Z', bytes: 2048 }],
    hasSuccessfulListLoad: true,
    hasSuccessfulReadinessLoad: true,
    readiness: { ready: true, maintenanceError: '' },
  })
  try {
    await nextTick()
    harness.settings.restoreDialogVisible.value = true
    await nextTick()
    const cancel = buttonByAriaLabel(harness.root, '取消恢复备份')
    click(cancel)
    await nextTick()
    assert.deepEqual(harness.settings.cancelCalls, ['cancel'])
    assert.equal(harness.settings.restoreDialogVisible.value, false)
    assert.equal(buttonByAriaLabel(harness.root, '取消恢复备份'), undefined)
  } finally {
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('创建或恢复进行中离开会弹出中文确认', async () => {
  const originalConfirm = window.confirm
  const harness = mountBackup({
    creating: true,
    hasSuccessfulListLoad: true,
    hasSuccessfulReadinessLoad: true,
    readiness: { ready: true, maintenanceError: '' },
  })
  try {
    await nextTick()
    assert.equal(harness.leaveRegistrations[0]?.id, 'backup')
    window.confirm = (message) => {
      assert.equal(message, BACKUP_LEAVE_CONFIRM_MESSAGE)
      return false
    }
    let allowed
    await harness.router.leaveGuards[0]({}, {}, (value) => { allowed = value })
    assert.equal(allowed, false)
    const registered = await harness.leaveRegistrations[0].handlers.confirmLeave()
    assert.equal(registered, false)
    assert.equal(harness.leaveRegistrations[0].handlers.shouldBlockUnload(), true)
  } finally {
    window.confirm = originalConfirm
    harness.app.unmount()
    resetVueRouterHarness()
    delete globalThis.__backupPageSettings
  }
})

test('备份锁定原因区分创建中、列表失败和维护锁定', () => {
  assert.equal(getBackupWriteLockReason({ creating: true }), '正在创建备份，请稍候')
  assert.equal(getBackupWriteLockReason({ restoring: true }), '正在恢复备份，请稍候')
  assert.equal(
    getBackupRestoreLockReason({ listError: '超时', listIsStale: true, hasSuccessfulListLoad: true }),
    '备份列表刷新失败，成功重试前不能从列表恢复',
  )
  assert.equal(
    getBackupRestoreLockReason({ listError: '超时', listIsStale: false, hasSuccessfulListLoad: false }),
    '备份列表加载失败，成功重试前不能从列表恢复',
  )
  assert.equal(confirmBackupLeave(false, () => { throw new Error('should not confirm') }), true)
  assert.equal(confirmBackupLeave(true, (message) => message === BACKUP_LEAVE_CONFIRM_MESSAGE), true)
})
