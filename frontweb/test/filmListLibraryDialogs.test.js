import test from 'node:test'
import assert from 'node:assert/strict'
import { defineComponent, h, nextTick, ref, watch } from 'vue'

import { assetImageUrl, createLibraryImageActions, hasPendingLibraryImageWork, LIBRARY_IMAGE_LEAVE_MESSAGE } from '@/components/filmList/filmListLibraryImage.js'
import { describeServiceLoadError } from '@/utils/requestError.js'
import {
  buttonByText,
  compileIconStub,
  compileSfc,
  createDeferred,
  createHostRenderer,
  dataModule,
  findByType,
  flushUi,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import { readFilmListLibraryFile, readFilmListLibrarySource } from './helpers/filmListLibrarySource.js'

const parentUrl = new URL('../src/components/filmList/FilmListLibraryDialogs.vue', import.meta.url)
const charUrl = new URL('../src/components/filmList/FilmListCharLibraryDialogs.vue', import.meta.url)
const sceneUrl = new URL('../src/components/filmList/FilmListSceneLibraryDialogs.vue', import.meta.url)
const propUrl = new URL('../src/components/filmList/FilmListPropLibraryDialogs.vue', import.meta.url)
const helperUrl = new URL('../src/components/filmList/filmListLibraryImage.js', import.meta.url).href

const LOCK_REASON = '项目数据加载失败，成功重试前不能新增或导入'

const iconStubUrl = compileIconStub(['PictureFilled'])
const feedbackStubUrl = dataModule(`
  export const ElMessage = {
    success(message) { globalThis.__filmListLibraryFeedback.messages.push(['success', message]) },
    error(message) { globalThis.__filmListLibraryFeedback.messages.push(['error', message]) },
    warning(message) { globalThis.__filmListLibraryFeedback.messages.push(['warning', message]) },
  }
  export const ElMessageBox = {
    confirm(message, title, options) {
      return globalThis.__filmListLibraryFeedback.confirm(message, title, options)
    },
  }
`)

function apiStub(kind) {
  return dataModule(`
    export const ${kind}LibraryAPI = {
      list(params) { return globalThis.__filmListLibraryApis.${kind}.list(params) },
      update(id, data) { return globalThis.__filmListLibraryApis.${kind}.update(id, data) },
      delete(id) { return globalThis.__filmListLibraryApis.${kind}.delete(id) },
    }
  `)
}

const uploadApiStubUrl = dataModule(`
  export const uploadAPI = {
    uploadImage(file) { return globalThis.__filmListLibraryApis.upload.uploadImage(file) },
  }
`)
const imagesApiStubUrl = dataModule(`
  export const imagesAPI = {
    create(payload) { return globalThis.__filmListLibraryApis.images.create(payload) },
  }
`)
const taskApiStubUrl = dataModule(`
  export const taskAPI = {
    get(id) { return globalThis.__filmListLibraryApis.task.get(id) },
  }
`)
const imagePreviewStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'ImagePreviewDialog',
    props: ['modelValue', 'src', 'alt'],
    setup(props) {
      return () => props.modelValue ? h('image-preview', { src: props.src, alt: props.alt }) : null
    },
  })
`)

function childReplacements(apiKind) {
  return new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/utils/elementPlusFeedback.js', feedbackStubUrl],
    [`@/api/${apiKind}Library`, apiStub(apiKind)],
    ['@/api/upload', uploadApiStubUrl],
    ['@/api/images', imagesApiStubUrl],
    ['@/api/task', taskApiStubUrl],
    ['./filmListLibraryImage.js', helperUrl],
  ])
}

const compiledCharUrl = compileSfc(charUrl, 'film-list-char-library', childReplacements('character'))
const compiledSceneUrl = compileSfc(sceneUrl, 'film-list-scene-library', childReplacements('scene'))
const compiledPropUrl = compileSfc(propUrl, 'film-list-prop-library', childReplacements('prop'))

const FilmListLibraryDialogs = await loadCompiledSfc(parentUrl, 'film-list-library-dialogs', new Map([
  ['vue', vueUrl],
  ['@/components/ImagePreviewDialog.vue', imagePreviewStubUrl],
  ['./FilmListCharLibraryDialogs.vue', compiledCharUrl],
  ['./FilmListSceneLibraryDialogs.vue', compiledSceneUrl],
  ['./FilmListPropLibraryDialogs.vue', compiledPropUrl],
]))

const renderer = createHostRenderer()

const AccessibleDialogStub = defineComponent({
  name: 'AccessibleDialog',
  props: ['modelValue', 'title', 'width', 'destroyOnClose'],
  emits: ['update:modelValue', 'open', 'close', 'closed'],
  setup(props, { emit, slots }) {
    watch(() => props.modelValue, (visible, previous) => {
      if (visible && previous !== true) emit('open')
      if (!visible && previous === true) {
        emit('close')
        emit('closed')
      }
    }, { immediate: true })
    return () => {
      if (!props.modelValue) return null
      return h('dialog', { 'data-title': props.title || '' }, [
        h('dialog-body', {}, slots.default?.()),
        h('dialog-footer', {}, slots.footer?.()),
      ])
    }
  },
})

const extraStubs = {
  AccessibleDialog: AccessibleDialogStub,
  'el-form': defineComponent({
    name: 'ElFormStub',
    setup(_props, { slots }) { return () => h('form', {}, slots.default?.()) },
  }),
  ElForm: defineComponent({
    name: 'ElFormStub2',
    setup(_props, { slots }) { return () => h('form', {}, slots.default?.()) },
  }),
  'el-form-item': defineComponent({
    name: 'ElFormItemStub',
    props: ['label'],
    setup(props, { slots }) { return () => h('form-item', { 'data-label': props.label || '' }, slots.default?.()) },
  }),
  ElFormItem: defineComponent({
    name: 'ElFormItemStub2',
    props: ['label'],
    setup(props, { slots }) { return () => h('form-item', { 'data-label': props.label || '' }, slots.default?.()) },
  }),
}

function resetHarnessState() {
  globalThis.__filmListLibraryFeedback = {
    messages: [],
    confirm: async () => true,
  }
  const makeApi = () => ({
    list: async () => ({ items: [], pagination: { total: 0, page: 1, page_size: 20 } }),
    update: async () => ({}),
    delete: async () => ({}),
  })
  globalThis.__filmListLibraryApis = {
    character: makeApi(),
    scene: makeApi(),
    prop: makeApi(),
    upload: { uploadImage: async () => ({ url: '/static/x.png' }) },
    images: { create: async () => ({ task_id: 'task-1' }) },
    task: { get: async () => ({ status: 'completed', result: { image_url: 'https://img.example/a.png', local_path: 'a.png' } }) },
  }
}

function dialogByTitle(root, title) {
  return findByType(root, 'dialog').find((node) => node.props?.['data-title'] === title)
}

function fileInputs(root) {
  return findByType(root, 'input').filter((node) => node.props?.accept === 'image/*' || node.props?.type === 'file')
}

function mountLibraries(initial = {}) {
  const showCharLibrary = ref(false)
  const showSceneLibrary = ref(false)
  const showPropLibrary = ref(false)
  const listWriteLocked = ref(Boolean(initial.listWriteLocked))
  const listWriteLockReason = ref(initial.listWriteLockReason || '')
  const mounted = mountHarness(renderer, () => h(FilmListLibraryDialogs, {
    showCharLibrary: showCharLibrary.value,
    showSceneLibrary: showSceneLibrary.value,
    showPropLibrary: showPropLibrary.value,
    listWriteLocked: listWriteLocked.value,
    listWriteLockReason: listWriteLockReason.value,
    'onUpdate:showCharLibrary': (value) => { showCharLibrary.value = value },
    'onUpdate:showSceneLibrary': (value) => { showSceneLibrary.value = value },
    'onUpdate:showPropLibrary': (value) => { showPropLibrary.value = value },
  }), { components: extraStubs })
  return { ...mounted, showCharLibrary, showSceneLibrary, showPropLibrary, listWriteLocked, listWriteLockReason }
}

test('分类素材库父组件仍按角色/场景/道具接线，并保留图片预览', () => {
  const parentSource = readFilmListLibraryFile('FilmListLibraryDialogs.vue')
  const librarySource = readFilmListLibrarySource()
  assert.match(parentSource, /<FilmListCharLibraryDialogs/)
  assert.match(parentSource, /<FilmListSceneLibraryDialogs/)
  assert.match(parentSource, /<FilmListPropLibraryDialogs/)
  assert.match(parentSource, /v-model:show-char-library|v-model="showCharLibrary"/)
  assert.match(parentSource, /import ImagePreviewDialog from '@\/components\/ImagePreviewDialog\.vue'/)
  assert.match(parentSource, /<ImagePreviewDialog[\s\S]*v-model="showImagePreview"/)
  assert.match(librarySource, /function libraryWriteReason\(\) \{\s*return props\.listWriteLocked \? props\.listWriteLockReason : ''/)
  assert.match(librarySource, /if \(form\?\.imgGenerating\) return '正在生成图片，请稍候'/)
  assert.match(librarySource, /if \(form\?\.imgUploading\) return '正在上传图片，请稍候'/)
  assert.match(librarySource, /'删除确认'[\s\S]*confirmButtonText: '删除'/)
})

test('assetImageUrl 优先本地路径，字符串原样返回', () => {
  assert.equal(assetImageUrl(null), '')
  assert.equal(assetImageUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png')
  assert.equal(assetImageUrl({ local_path: '/covers/a.png', image_url: 'https://cdn.example/b.png' }), '/static/covers/a.png')
  assert.equal(assetImageUrl({ image_url: 'https://cdn.example/b.png' }), 'https://cdn.example/b.png')
})

test('上传和生图在写锁、进行中状态时互斥', async () => {
  const messages = []
  const uploadCalls = []
  const createCalls = []
  const actions = createLibraryImageActions({
    getListWriteLocked: () => false,
    uploadAPI: { uploadImage: async (file) => { uploadCalls.push(file); return { url: '/static/x.png' } } },
    imagesAPI: { create: async (payload) => { createCalls.push(payload); return { task_id: 't1' } } },
    taskAPI: { get: async () => ({ status: 'completed', result: { image_url: 'https://img.example/a.png', local_path: 'a.png' } }) },
    ElMessage: {
      success: (message) => messages.push(['success', message]),
      error: (message) => messages.push(['error', message]),
      warning: (message) => messages.push(['warning', message]),
    },
    sleep: async () => {},
    maxAttempts: 2,
    pollIntervalMs: 0,
  })
  const event = { target: { files: [{ name: 'a.png' }], value: 'a.png' } }
  const generatingForm = { id: 1, imgGenerating: true, imgUploading: false }
  await actions.doUploadLibImg(event, generatingForm, { update: async () => {} }, () => {})
  assert.equal(event.target.value, '')
  assert.equal(uploadCalls.length, 0)

  const uploadingForm = { id: 1, imgGenerating: false, imgUploading: true }
  await actions.doGenerateLibImg(uploadingForm, '女主', { update: async () => {} }, () => {})
  assert.equal(createCalls.length, 0)

  const locked = createLibraryImageActions({
    getListWriteLocked: () => true,
    uploadAPI: { uploadImage: async (file) => { uploadCalls.push(file) } },
    imagesAPI: { create: async (payload) => { createCalls.push(payload) } },
    ElMessage: { success() {}, error() {}, warning() {} },
  })
  await locked.doUploadLibImg({ target: { files: [{ name: 'a.png' }], value: 'x' } }, { id: 1 }, { update: async () => {} }, () => {})
  await locked.doGenerateLibImg({ id: 1, imgUploading: false, imgGenerating: false }, '女主', { update: async () => {} }, () => {})
  assert.equal(uploadCalls.length, 0)
  assert.equal(createCalls.length, 0)

  const form = { id: 9, imgUploading: false, imgGenerating: false, image_url: '', local_path: null }
  const updates = []
  await actions.doGenerateLibImg(form, '女主, 长发', { update: async (id, data) => { updates.push({ id, data }) } }, () => {})
  assert.deepEqual(createCalls[0], { prompt: '女主, 长发', drama_id: null })
  assert.equal(form.image_url, 'https://img.example/a.png')
  assert.equal(form.local_path, 'a.png')
  assert.deepEqual(updates[0], { id: 9, data: { image_url: 'https://img.example/a.png', local_path: 'a.png' } })
  assert.deepEqual(messages[0], ['success', 'AI 图片已生成'])
})

test('打开角色库时加载失败不会伪装成空库，空库和搜索空态分开', async () => {
  resetHarnessState()
  const listCalls = []
  const pending = []
  globalThis.__filmListLibraryApis.character.list = async (params) => {
    listCalls.push(params)
    const deferred = createDeferred()
    pending.push(deferred)
    return deferred.promise
  }
  const harness = mountLibraries()
  try {
    harness.showCharLibrary.value = true
    await flushUi(nextTick)
    assert.equal(listCalls.length, 1)
    assert.equal(listCalls[0].global, 1)
    pending[0].reject({ response: { status: 502 } })
    await flushUi(nextTick)

    const dialog = dialogByTitle(harness.root, '素材库 · 角色')
    assert.ok(dialog)
    const error = textContent(dialog)
    assert.match(error, /角色素材服务暂时不可用，请稍后重试/)
    assert.equal(describeServiceLoadError({ response: { status: 502 } }, { serviceLabel: '角色素材服务' }), '角色素材服务暂时不可用，请稍后重试')
    assert.doesNotMatch(error, /素材库暂无角色/)
    assert.ok(buttonByText(dialog, '重试'))

    globalThis.__filmListLibraryApis.character.list = async (params) => {
      listCalls.push(params)
      return { items: [], pagination: { total: 0, page: 1, page_size: 20 } }
    }
    buttonByText(dialog, '重试').props.onClick()
    await flushUi(nextTick)
    const emptyDialog = dialogByTitle(harness.root, '素材库 · 角色')
    assert.match(textContent(emptyDialog), /素材库暂无角色，可在项目中将角色「加入素材库」后在此查看/)
    assert.equal(buttonByText(emptyDialog, '清除搜索'), undefined)
    const closeEmpty = buttonByText(emptyDialog, '关闭并回到项目列表')
    assert.ok(closeEmpty, '空库应给出关闭并回到项目列表下一步')
    assert.equal(closeEmpty.props['aria-label'], '关闭角色库并回到项目列表')
    closeEmpty.props.onClick()
    await flushUi(nextTick)
    assert.equal(harness.showCharLibrary.value, false)
  } finally {
    harness.app.unmount()
  }
})

test('写锁禁用编辑删除，删除确认标题和按钮保持中文合同', async () => {
  resetHarnessState()
  const deletes = []
  globalThis.__filmListLibraryApis.character.list = async () => ({
    items: [{ id: 3, name: '女主', description: '长发', image_url: 'https://img.example/a.png' }],
    pagination: { total: 1, page: 1, page_size: 20 },
  })
  globalThis.__filmListLibraryApis.character.delete = async (id) => { deletes.push(id) }
  const confirmCalls = []
  const harness = mountLibraries({ listWriteLocked: true, listWriteLockReason: LOCK_REASON })
  try {
    harness.showCharLibrary.value = true
    await flushUi(nextTick)
    const dialog = dialogByTitle(harness.root, '素材库 · 角色')
    const editButton = buttonByText(dialog, '编辑')
    const deleteButton = buttonByText(dialog, '删除')
    assert.equal(editButton.props.disabled, true)
    assert.equal(deleteButton.props.disabled, true)
    assert.equal(editButton.props.title, LOCK_REASON)
    assert.equal(deleteButton.props.title, LOCK_REASON)
    editButton.props.onClick()
    await flushUi(nextTick)
    assert.equal(dialogByTitle(harness.root, '编辑素材角色'), undefined)

    harness.listWriteLocked.value = false
    harness.listWriteLockReason.value = ''
    await flushUi(nextTick)
    globalThis.__filmListLibraryFeedback.confirm = async (message, title, options) => {
      confirmCalls.push({ message, title, options })
      return true
    }
    buttonByText(dialogByTitle(harness.root, '素材库 · 角色'), '删除').props.onClick()
    await flushUi(nextTick)
    assert.equal(confirmCalls[0].title, '删除确认')
    assert.equal(confirmCalls[0].options.confirmButtonText, '删除')
    assert.equal(confirmCalls[0].options.cancelButtonText, '取消')
    assert.match(confirmCalls[0].message, /确定删除公共角色「女主」吗？/)
    assert.deepEqual(deletes, [3])
  } finally {
    harness.app.unmount()
  }
})

test('编辑弹窗里上传和生图互斥，预览走父级 ImagePreviewDialog', async () => {
  resetHarnessState()
  globalThis.__filmListLibraryApis.character.list = async () => ({
    items: [{ id: 8, name: '女主', description: '长发', image_url: 'https://img.example/a.png' }],
    pagination: { total: 1, page: 1, page_size: 20 },
  })
  const createDeferredUpload = createDeferred()
  globalThis.__filmListLibraryApis.images.create = () => createDeferredUpload.promise
  const harness = mountLibraries()
  try {
    harness.showCharLibrary.value = true
    await flushUi(nextTick)
    const listDialog = dialogByTitle(harness.root, '素材库 · 角色')
    const cover = findByType(listDialog, 'button').find((node) => String(node.props?.class || '').includes('library-item-cover'))
    cover.props.onClick()
    await flushUi(nextTick)
    const preview = findByType(harness.root, 'image-preview')[0]
    assert.equal(preview.props.src, 'https://img.example/a.png')
    assert.match(preview.props.alt, /角色素材「女主」预览图/)

    buttonByText(listDialog, '编辑').props.onClick()
    await flushUi(nextTick)
    const editDialog = dialogByTitle(harness.root, '编辑素材角色')
    assert.ok(editDialog)
    const generateButton = buttonByText(editDialog, 'AI 生成')
    generateButton.props.onClick()
    await flushUi(nextTick)
    const uploadButton = buttonByText(editDialog, '上传图片')
    assert.equal(uploadButton.props.disabled, true)
    assert.equal(uploadButton.props.title, '正在生成图片，请稍候')
    assert.equal(generateButton.props['data-loading'], true)
  } finally {
    harness.app.unmount()
  }
})

test('正在上传时不能生图，按钮给出中文原因', async () => {
  resetHarnessState()
  globalThis.__filmListLibraryApis.character.list = async () => ({
    items: [{ id: 8, name: '女主', description: '长发' }],
    pagination: { total: 1, page: 1, page_size: 20 },
  })
  const uploadDeferred = createDeferred()
  const createCalls = []
  globalThis.__filmListLibraryApis.upload.uploadImage = () => uploadDeferred.promise
  globalThis.__filmListLibraryApis.images.create = async (payload) => { createCalls.push(payload); return { task_id: 'should-not-run' } }
  const harness = mountLibraries()
  try {
    harness.showCharLibrary.value = true
    await flushUi(nextTick)
    buttonByText(dialogByTitle(harness.root, '素材库 · 角色'), '编辑').props.onClick()
    await flushUi(nextTick)
    const editDialog = dialogByTitle(harness.root, '编辑素材角色')
    const input = fileInputs(editDialog)[0]
    assert.ok(input)
    input.props.onChange({ target: { files: [{ name: 'a.png' }], value: 'a.png' } })
    await flushUi(nextTick)
    const generateButton = buttonByText(editDialog, 'AI 生成')
    const uploadButton = buttonByText(editDialog, '上传图片')
    assert.equal(generateButton.props.disabled, true)
    assert.equal(generateButton.props.title, '正在上传图片，请稍候')
    assert.equal(uploadButton.props['data-loading'], true)
    generateButton.props.onClick()
    await flushUi(nextTick)
    assert.equal(createCalls.length, 0)
  } finally {
    harness.app.unmount()
  }
})

test('场景和道具库同样走全局素材接口，删除确认文案不串库', async () => {
  resetHarnessState()
  const sceneLists = []
  const propLists = []
  const confirms = []
  globalThis.__filmListLibraryApis.scene.list = async (params) => {
    sceneLists.push(params)
    return { items: [{ id: 4, location: '茶馆', time: '夜晚' }], pagination: { total: 1 } }
  }
  globalThis.__filmListLibraryApis.prop.list = async (params) => {
    propLists.push(params)
    return { items: [{ id: 5, name: '油纸伞' }], pagination: { total: 1 } }
  }
  globalThis.__filmListLibraryFeedback.confirm = async (message, title, options) => {
    confirms.push({ message, title, options })
    throw new Error('cancel')
  }
  const harness = mountLibraries()
  try {
    harness.showSceneLibrary.value = true
    await flushUi(nextTick)
    assert.equal(sceneLists[0].global, 1)
    buttonByText(dialogByTitle(harness.root, '素材库 · 场景'), '删除').props.onClick()
    await flushUi(nextTick)
    assert.equal(confirms[0].title, '删除确认')
    assert.equal(confirms[0].options.confirmButtonText, '删除')
    assert.match(confirms[0].message, /确定删除公共场景「茶馆」吗？/)

    harness.showSceneLibrary.value = false
    harness.showPropLibrary.value = true
    await flushUi(nextTick)
    assert.equal(propLists[0].global, 1)
    buttonByText(dialogByTitle(harness.root, '素材库 · 道具'), '删除').props.onClick()
    await flushUi(nextTick)
    assert.equal(confirms[1].title, '删除确认')
    assert.match(confirms[1].message, /确定删除公共道具「油纸伞」吗？/)
    assert.equal(sceneLists.length, 1)
    assert.equal(propLists.length, 1)
  } finally {
    harness.app.unmount()
  }
})

test('取消后即使带回结果也不能当成生成成功，且素材 ID 与任务 ID 不相等', async () => {
  const formId = 41
  const taskId = 'task-cancel-77'
  assert.notEqual(String(formId), taskId)
  const messages = []
  const updates = []
  const actions = createLibraryImageActions({
    getListWriteLocked: () => false,
    imagesAPI: {
      async create(payload) {
        assert.equal(payload.drama_id, null)
        return { task_id: taskId }
      },
    },
    taskAPI: {
      async get(id) {
        assert.equal(id, taskId)
        return { status: 'cancelled', result: { image_url: 'https://img.example/should-not-apply.png' } }
      },
    },
    ElMessage: {
      success: (message) => messages.push(['success', message]),
      error: (message) => messages.push(['error', message]),
      warning: (message) => messages.push(['warning', message]),
    },
    isUserFacingAbort: (error) => error?.name === 'AbortError',
    toUserFacingError: (error, fallback) => error?.message || fallback,
    sleep: async () => {},
    maxAttempts: 2,
    pollIntervalMs: 0,
  })
  const form = { id: formId, imgUploading: false, imgGenerating: false, image_url: '', local_path: null }
  await actions.doGenerateLibImg(form, '林夏', { update: async (id, data) => { updates.push({ id, data }) } }, () => {})
  assert.equal(form.image_url, '')
  assert.equal(updates.length, 0)
  assert.equal(messages.some((item) => item[0] === 'success'), false)
})

test('素材库上传或生图进行中会参与离开保护，且与项目包导出 ID 不相等', () => {
  const exportingId = 11
  const formId = 41
  assert.notEqual(exportingId, formId)
  assert.equal(hasPendingLibraryImageWork({ form: { id: formId, imgGenerating: true } }), true)
  assert.equal(hasPendingLibraryImageWork({ form: { id: formId, imgUploading: true } }), true)
  assert.equal(hasPendingLibraryImageWork({ form: { id: formId }, saving: true }), true)
  assert.equal(hasPendingLibraryImageWork({ form: { id: formId, imgGenerating: false, imgUploading: false }, saving: false }), false)
  assert.match(LIBRARY_IMAGE_LEAVE_MESSAGE, /请完成后再离开/)
})
