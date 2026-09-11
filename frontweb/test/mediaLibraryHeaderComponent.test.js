import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import { MEDIA_LIBRARY_DISABLE_REASON } from '../src/utils/mediaLibraryUserError.js'

const headerUrl = new URL('../src/components/mediaLibrary/MediaLibraryHeader.vue', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowLeft', 'Plus', 'Upload'])
const MediaLibraryHeader = await loadCompiledSfc(
  headerUrl,
  'media-library-header-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountHeader(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(MediaLibraryHeader, {
    returnTo: initial.returnTo ?? '',
    mediaAccessState: initial.mediaAccessState ?? { navigationLocked: false, writeLocked: false },
    mediaNavigationLockReason: initial.mediaNavigationLockReason ?? '',
    mediaItems: initial.mediaItems ?? [{ id: 5, name: '已有素材' }],
    loading: Boolean(initial.loading),
    uploading: Boolean(initial.uploading),
    mediaWriteLocked: Boolean(initial.mediaWriteLocked),
    mediaUploadDisableReason: initial.mediaUploadDisableReason ?? '',
    goBack: () => events.push(['go-back']),
    goNewProject: () => events.push(['go-new-project']),
    triggerUpload: () => events.push(['trigger-upload']),
    onUpload: () => events.push(['on-upload']),
  }))
  return { ...mounted, events }
}

test('素材中心页头按 returnTo 切换返回文案，上传和新建交给页面', async () => {
  const home = mountHeader()
  try {
    await nextTick()
    assert.match(textContent(home.root), /素材中心/)
    assert.match(textContent(home.root), /上传后的图片和视频会在所有项目里复用/)
    const backHome = buttonByAriaLabel(home.root, '返回项目首页')
    assert.ok(backHome)
    assert.match(textContent(backHome), /项目首页/)
    assert.equal(buttonByAriaLabel(home.root, '返回制作台'), undefined)
    click(backHome)
    click(buttonByAriaLabel(home.root, '新建项目'))
    click(buttonByAriaLabel(home.root, '上传图片或视频到素材中心'))
    assert.deepEqual(home.events, [['go-back'], ['go-new-project'], ['trigger-upload']])
  } finally {
    home.app.unmount()
  }

  const studio = mountHeader({ returnTo: 'film-create' })
  try {
    await nextTick()
    const backStudio = buttonByAriaLabel(studio.root, '返回制作台')
    assert.ok(backStudio)
    assert.match(textContent(backStudio), /返回制作台/)
    assert.equal(buttonByAriaLabel(studio.root, '返回项目首页'), undefined)
    click(backStudio)
    assert.deepEqual(studio.events, [['go-back']])
  } finally {
    studio.app.unmount()
  }
})

test('写锁只禁用上传并展示中文原因，新建项目仍可点', async () => {
  const reason = MEDIA_LIBRARY_DISABLE_REASON.loadFailedWrite
  const harness = mountHeader({
    mediaAccessState: { navigationLocked: false, writeLocked: true },
    mediaWriteLocked: true,
    mediaUploadDisableReason: reason,
  })
  try {
    await nextTick()
    const upload = buttonByAriaLabel(harness.root, '上传图片或视频到素材中心')
    const created = buttonByAriaLabel(harness.root, '新建项目')
    assert.ok(upload)
    assert.ok(created)
    assert.equal(upload.props.disabled, true)
    assert.equal(upload.props.title, reason)
    assert.notEqual(created.props.disabled, true)
    assert.equal(created.props.title, undefined)
    click(created)
    assert.deepEqual(harness.events, [['go-new-project']])
  } finally {
    harness.app.unmount()
  }
})

test('导航锁只禁用新建项目；正在上传时上传按钮也展示中文原因', async () => {
  const harness = mountHeader({
    mediaAccessState: { navigationLocked: true, writeLocked: false },
    mediaNavigationLockReason: MEDIA_LIBRARY_DISABLE_REASON.uploading,
    mediaWriteLocked: false,
    uploading: true,
    mediaUploadDisableReason: MEDIA_LIBRARY_DISABLE_REASON.uploading,
    mediaItems: [],
    loading: false,
  })
  try {
    await nextTick()
    const created = buttonByAriaLabel(harness.root, '新建项目')
    const upload = buttonByAriaLabel(harness.root, '上传图片或视频到素材中心')
    assert.ok(created)
    assert.ok(upload)
    assert.equal(created.props.disabled, true)
    assert.equal(created.props.title, MEDIA_LIBRARY_DISABLE_REASON.uploading)
    assert.equal(upload.props.disabled, true)
    assert.equal(upload.props.title, MEDIA_LIBRARY_DISABLE_REASON.uploading)
    assert.equal(upload.props['data-loading'], true)
    assert.equal(buttonByText(harness.root, '上传素材').props['data-variant'], 'default')
  } finally {
    harness.app.unmount()
  }
})