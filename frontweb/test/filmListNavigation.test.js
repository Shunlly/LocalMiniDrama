import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

import { ElMessage, ElMessageBox } from '../src/utils/elementPlusFeedback.js'
import {
  confirmFilmListLeave,
  useFilmListNavigation,
} from '../src/components/filmList/useFilmListNavigation.js'
import {
  describePendingProjectPackageWork,
  FILM_LIST_LEAVE_CONFIRM_BUTTON_TEXT,
  FILM_LIST_LEAVE_CONFIRM_TITLE,
  FILM_LIST_LEAVE_STAY_BUTTON_TEXT,
} from '../src/components/filmList/filmListFormatters.js'
import { LIBRARY_IMAGE_LEAVE_MESSAGE } from '../src/components/filmList/filmListLibraryImage.js'

const DRAMA_ID = 11
const OTHER_DRAMA_ID = 22
assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID)

const navigationSource = readFileSync(new URL('../src/components/filmList/useFilmListNavigation.js', import.meta.url), 'utf8')

function stubLeaveConfirm(impl) {
  const originalConfirm = ElMessageBox.confirm
  const originalWarning = ElMessage.warning
  const warnings = []
  ElMessage.warning = (message) => {
    warnings.push(message)
    throw new Error('离开确认不应使用 ElMessage.warning')
  }
  ElMessageBox.confirm = async (message, title, options) => impl(message, title, options)
  return {
    warnings,
    restore() {
      ElMessageBox.confirm = originalConfirm
      ElMessage.warning = originalWarning
    },
  }
}

function makeNav(overrides = {}) {
  return useFilmListNavigation({
    router: { push() {} },
    listWriteLocked: ref(false),
    showNewDialog: ref(false),
    projectListReturnTo: ref('/'),
    importing: ref(false),
    importingExample: ref(null),
    exportingId: ref(null),
    showAiConfigDialog: ref(false),
    aiConfigContentRef: ref(null),
    hasPendingLibraryImageWork: () => false,
    ...overrides,
  })
}

function assertChineseLeaveDialog(message, title, options) {
  assert.match(String(message), /[一-鿿]/)
  assert.doesNotMatch(String(message), /leave|unload|busy|confirm|ok|cancel/i)
  assert.equal(title, FILM_LIST_LEAVE_CONFIRM_TITLE)
  assert.equal(options.confirmButtonText, FILM_LIST_LEAVE_CONFIRM_BUTTON_TEXT)
  assert.equal(options.cancelButtonText, FILM_LIST_LEAVE_STAY_BUTTON_TEXT)
  assert.equal(options.distinguishCancelAndClose, true)
  assert.doesNotMatch(title, /leave|ok|cancel/i)
  assert.doesNotMatch(options.confirmButtonText, /leave|ok|yes|confirm/i)
  assert.doesNotMatch(options.cancelButtonText, /stay|cancel|continue/i)
}

test('项目列表离开确认走中文对话框，不走 window.confirm', () => {
  assert.match(navigationSource, /ElMessageBox\.confirm/)
  assert.match(navigationSource, /FILM_LIST_LEAVE_CONFIRM_TITLE/)
  assert.match(navigationSource, /FILM_LIST_LEAVE_STAY_BUTTON_TEXT/)
  assert.doesNotMatch(navigationSource, /window\.confirm/)
  assert.doesNotMatch(navigationSource, /ElMessage\.warning\(pendingProjectPackageWorkMessage/)
})

test('不忙碌时离开确认直接放行', async () => {
  const stub = stubLeaveConfirm(async () => {
    throw new Error('不应弹出离开确认')
  })
  try {
    assert.equal(await confirmFilmListLeave(false, '项目包正在导入，请完成后再离开。'), true)
  } finally {
    stub.restore()
  }
})

test('导入进行中离开确认使用中文按钮，取消则留在本页', async () => {
  const calls = []
  const stub = stubLeaveConfirm(async (message, title, options) => {
    calls.push({ message, title, options })
    assertChineseLeaveDialog(message, title, options)
    throw new Error('cancel')
  })
  try {
    const nav = makeNav({ importing: ref(true) })
    assert.equal(await nav.requestFilmListNavigation(), false)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].message, describePendingProjectPackageWork({
      importing: true,
      importingExample: null,
      exportingId: null,
    }))
  } finally {
    stub.restore()
  }
})

test('导出进行中确认离开后可以继续导航，且不会把不同项目 ID 混在一起', async () => {
  const stub = stubLeaveConfirm(async (message, title, options) => {
    assertChineseLeaveDialog(message, title, options)
    assert.equal(message, describePendingProjectPackageWork({
      importing: false,
      importingExample: null,
      exportingId: DRAMA_ID,
    }))
    assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID)
  })
  try {
    const nav = makeNav({ exportingId: ref(DRAMA_ID) })
    assert.equal(await nav.requestFilmListNavigation(), true)
  } finally {
    stub.restore()
  }
})

test('素材库图片任务进行中也走中文离开确认', async () => {
  const stub = stubLeaveConfirm(async (message, title, options) => {
    assertChineseLeaveDialog(message, title, options)
    assert.equal(message, LIBRARY_IMAGE_LEAVE_MESSAGE)
    throw new Error('cancel')
  })
  try {
    const nav = makeNav({ hasPendingLibraryImageWork: () => true })
    assert.equal(await nav.requestFilmListNavigation(), false)
  } finally {
    stub.restore()
  }
})

test('离开确认进行中再次确认会复用同一次弹窗', async () => {
  let calls = 0
  let finishConfirm
  const stub = stubLeaveConfirm(() => {
    calls += 1
    return new Promise((_, reject) => {
      finishConfirm = () => reject(new Error('cancel'))
    })
  })
  try {
    const first = confirmFilmListLeave(true, '项目包正在导入，请完成后再离开。')
    const second = confirmFilmListLeave(true, '项目包正在导出，请完成后再离开。')
    assert.equal(calls, 1)
    finishConfirm()
    assert.equal(await first, false)
    assert.equal(await second, false)
    assert.equal(calls, 1)
  } finally {
    stub.restore()
  }
})

test('确认离开后仍会询问 AI 配置未保存关闭', async () => {
  const closeCalls = []
  const stub = stubLeaveConfirm(async (message, title, options) => {
    assertChineseLeaveDialog(message, title, options)
  })
  try {
    const nav = makeNav({
      importing: ref(true),
      showAiConfigDialog: ref(true),
      aiConfigContentRef: ref({
        requestClose: async () => {
          closeCalls.push('close')
          return false
        },
      }),
    })
    assert.equal(await nav.requestFilmListNavigation(), false)
    assert.deepEqual(closeCalls, ['close'])
  } finally {
    stub.restore()
  }
})
