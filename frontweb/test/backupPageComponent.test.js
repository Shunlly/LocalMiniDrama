import test from 'node:test'
import assert from 'node:assert/strict'

import { computed, defineComponent, h, nextTick, ref } from 'vue'

import { backupAccessState } from '../src/composables/useBackupSettings.js'
import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
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

const BackupPage = await loadCompiledSfc(
  pageUrl,
  'backup-page-component',
  new Map([
    ['vue', vueUrl],
    ['vue-router', routerStubUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/utils/elementPlusFeedback.js', feedbackStubUrl],
    ['@/composables/useBackupSettings.js', backupSettingsStubUrl],
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
  const fileError = ref('')
  const fileErrorName = ref('')
  const actionError = ref('')
  const lastFailedAction = ref('')
  const selectedFile = ref(null)
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
    cancelRestore: noop,
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
  const mounted = mountHarness(renderer, () => h(BackupPage), {
    components: { AccessibleDialog: AccessibleDialogStub },
  })
  return { ...mounted, settings, router }
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
