import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AI_CONFIG_DISCARD_CANCEL_TEXT,
  AI_CONFIG_DISCARD_CONFIRM_TEXT,
  AI_CONFIG_DISCARD_MESSAGE,
  AI_CONFIG_DISCARD_TITLE,
  DEFAULT_MODEL_VALIDATION_MESSAGE,
  MASKED_SECRET,
  clearConfigFieldValidation,
  configFieldDescription,
  configFieldDescriptionId,
  configFormFingerprint,
  generationSettingsFingerprint,
  isConfigFieldInvalid,
  isDefaultModelSelectionValid,
  isMaskedSecret,
  useAiConfigUnsaved,
} from '../src/composables/useAiConfigUnsaved.js'

const MODEL_FIELD = 'model'
const MODEL_PROP = 'modelText'
const DEFAULT_MODEL_FIELD = 'default_model'
const IMAGE_CONCURRENCY = 3
const VIDEO_CONCURRENCY = 5
assert.notEqual(MODEL_FIELD, MODEL_PROP)
assert.notEqual(MODEL_FIELD, DEFAULT_MODEL_FIELD)
assert.notEqual(MODEL_PROP, DEFAULT_MODEL_FIELD)
assert.notEqual(IMAGE_CONCURRENCY, VIDEO_CONCURRENCY)

function refOf(value) {
  return { value }
}

function createUnsaved(overrides = {}) {
  const calls = {
    confirm: [],
    nextTick: 0,
    query: [],
  }
  const confirmResult = { value: overrides.confirmResult !== undefined ? overrides.confirmResult : true }
  const promptEditorRef = overrides.promptEditorRef || refOf({
    hasUnsavedChanges: () => false,
    markUnsavedChangesDiscarded() { calls.discarded = (calls.discarded || 0) + 1 },
  })
  const sceneModelMapRef = overrides.sceneModelMapRef || refOf({
    hasUnsavedChanges: () => false,
    markUnsavedChangesDiscarded() { calls.discarded = (calls.discarded || 0) + 1 },
  })
  const dialogVisible = overrides.dialogVisible || refOf(true)
  const api = useAiConfigUnsaved({
    formModelList: overrides.formModelList || refOf(['qwen-plus']),
    isComfyUiForm: overrides.isComfyUiForm || refOf(false),
    configValidationSummary: overrides.configValidationSummary || refOf([]),
    advancedFormSections: overrides.advancedFormSections || refOf([]),
    configDialogScrollRef: overrides.configDialogScrollRef || refOf({
      querySelector(selector) {
        calls.query.push(selector)
        return null
      },
    }),
    configFormDirty: overrides.configFormDirty || refOf(false),
    generationSettingsDirty: overrides.generationSettingsDirty || refOf(false),
    credentialDraftDirty: overrides.credentialDraftDirty || refOf(false),
    promptEditorRef,
    sceneModelMapRef,
    configDialogSaved: overrides.configDialogSaved || refOf(false),
    dialogVisible,
    oneKeyTongyiKey: overrides.oneKeyTongyiKey || refOf(''),
    oneKeyTongyiVisible: overrides.oneKeyTongyiVisible || refOf(false),
    oneKeyVolcKey: overrides.oneKeyVolcKey || refOf(''),
    oneKeyVolcVisible: overrides.oneKeyVolcVisible || refOf(false),
    oneKeyAgnesKey: overrides.oneKeyAgnesKey || refOf(''),
    oneKeyAgnesVisible: overrides.oneKeyAgnesVisible || refOf(false),
    bulkKeyInput: overrides.bulkKeyInput || refOf(''),
    bulkKeyVisible: overrides.bulkKeyVisible || refOf(false),
    nextTick: async () => { calls.nextTick += 1 },
    confirmBox: async (message, title, options) => {
      calls.confirm.push({ message, title, options })
      if (confirmResult.value) return true
      throw new Error('cancel')
    },
  })
  return { api, calls, dialogVisible, confirmResult }
}

test('masked secret only matches the exact placeholder, not nearby values', () => {
  assert.equal(isMaskedSecret(MASKED_SECRET), true)
  assert.equal(isMaskedSecret(' ******** '), true)
  assert.equal(isMaskedSecret('*******'), false)
  assert.equal(isMaskedSecret(''), false)
  assert.equal(isMaskedSecret('sk-live-secret'), false)
})

test('config form fingerprint and generation settings fingerprint stay independent', () => {
  const formA = { id: 11, name: '文本默认' }
  const formB = { id: 22, name: '文本默认' }
  assert.notEqual(formA.id, formB.id)
  assert.notEqual(configFormFingerprint(formA), configFormFingerprint(formB))
  assert.equal(configFormFingerprint(formA), configFormFingerprint({ ...formA }))

  const imageThenVideo = generationSettingsFingerprint(IMAGE_CONCURRENCY, VIDEO_CONCURRENCY)
  const swapped = generationSettingsFingerprint(VIDEO_CONCURRENCY, IMAGE_CONCURRENCY)
  assert.notEqual(imageThenVideo, swapped)
  assert.notEqual(IMAGE_CONCURRENCY, VIDEO_CONCURRENCY)
})

test('default model validation keeps the model-less ComfyUI exception and rejects other empty values', () => {
  assert.equal(isDefaultModelSelectionValid('', { isComfyUi: true, modelList: [] }), true)
  assert.equal(isDefaultModelSelectionValid('', { isComfyUi: false, modelList: [] }), false)
  assert.equal(isDefaultModelSelectionValid('qwen-plus', { isComfyUi: false, modelList: ['qwen-plus'] }), true)
  assert.equal(isDefaultModelSelectionValid('missing', { isComfyUi: false, modelList: ['qwen-plus'] }), false)
  assert.equal(isDefaultModelSelectionValid('qwen-plus', { isComfyUi: true, modelList: [] }), false)
})

test('field description helpers use field ids, not nearby prop names', () => {
  assert.equal(configFieldDescriptionId(MODEL_FIELD), 'ai-config-model-description')
  assert.notEqual(configFieldDescriptionId(MODEL_FIELD), configFieldDescriptionId(MODEL_PROP))
  assert.notEqual(configFieldDescriptionId(MODEL_FIELD), configFieldDescriptionId(DEFAULT_MODEL_FIELD))

  const summary = [
    { field: MODEL_FIELD, prop: MODEL_PROP, message: '请填写至少一个模型' },
    { field: DEFAULT_MODEL_FIELD, prop: DEFAULT_MODEL_FIELD, message: DEFAULT_MODEL_VALIDATION_MESSAGE },
  ]
  assert.equal(isConfigFieldInvalid(MODEL_FIELD, summary), true)
  assert.equal(isConfigFieldInvalid(MODEL_PROP, summary), false)
  assert.equal(isConfigFieldInvalid(DEFAULT_MODEL_FIELD, summary), true)
  assert.equal(configFieldDescription(MODEL_FIELD, summary), '请填写至少一个模型')
  assert.equal(configFieldDescription(DEFAULT_MODEL_FIELD, []), DEFAULT_MODEL_VALIDATION_MESSAGE)
  assert.equal(configFieldDescription('name', []), '请输入名称')

  const clearedByProp = clearConfigFieldValidation(summary, MODEL_PROP)
  assert.equal(clearedByProp.some((item) => item.field === MODEL_FIELD), false)
  assert.equal(clearedByProp.some((item) => item.field === DEFAULT_MODEL_FIELD), true)
  const clearedByField = clearConfigFieldValidation(summary, MODEL_FIELD)
  assert.equal(clearedByField.some((item) => item.prop === MODEL_PROP), false)
})

test('unsaved changes come from form, generation, credential and editor drafts independently', () => {
  assert.equal(createUnsaved().api.hasUnsavedChanges(), false)
  assert.equal(createUnsaved({ configFormDirty: refOf(true) }).api.hasUnsavedChanges(), true)
  assert.equal(createUnsaved({ generationSettingsDirty: refOf(true) }).api.hasUnsavedChanges(), true)
  assert.equal(createUnsaved({ credentialDraftDirty: refOf(true) }).api.hasUnsavedChanges(), true)
  assert.equal(createUnsaved({
    promptEditorRef: refOf({ hasUnsavedChanges: () => true }),
    sceneModelMapRef: refOf({ hasUnsavedChanges: () => false }),
  }).api.hasUnsavedChanges(), true)
  assert.equal(createUnsaved({
    promptEditorRef: refOf({ hasUnsavedChanges: () => false }),
    sceneModelMapRef: refOf({ hasUnsavedChanges: () => true }),
  }).api.hasUnsavedChanges(), true)
})

test('requestClose confirms only when something is dirty and never marks drafts discarded', async () => {
  const clean = createUnsaved()
  assert.equal(await clean.api.requestClose(), true)
  assert.equal(clean.calls.confirm.length, 0)

  const dirty = createUnsaved({ configFormDirty: refOf(true) })
  assert.equal(await dirty.api.requestClose(), true)
  assert.equal(dirty.calls.confirm.length, 1)
  assert.equal(dirty.calls.confirm[0].message, AI_CONFIG_DISCARD_MESSAGE)
  assert.equal(dirty.calls.confirm[0].title, AI_CONFIG_DISCARD_TITLE)
  assert.equal(dirty.calls.confirm[0].options.confirmButtonText, AI_CONFIG_DISCARD_CONFIRM_TEXT)
  assert.equal(dirty.calls.confirm[0].options.cancelButtonText, AI_CONFIG_DISCARD_CANCEL_TEXT)
  assert.equal(dirty.calls.discarded || 0, 0)

  const cancelled = createUnsaved({ configFormDirty: refOf(true), confirmResult: false })
  assert.equal(await cancelled.api.requestClose(), false)
  assert.equal(cancelled.calls.discarded || 0, 0)
})

test('config dialog close only consults config form dirty, not generation settings', async () => {
  const generationOnly = createUnsaved({
    generationSettingsDirty: refOf(true),
    configFormDirty: refOf(false),
  })
  const done = []
  await generationOnly.api.confirmConfigDialogClose(() => done.push('done'))
  assert.deepEqual(done, ['done'])
  assert.equal(generationOnly.calls.confirm.length, 0)

  const savedDirty = createUnsaved({
    configFormDirty: refOf(true),
    configDialogSaved: refOf(true),
  })
  await savedDirty.api.requestConfigDialogClose()
  assert.equal(savedDirty.calls.confirm.length, 0)
  assert.equal(savedDirty.dialogVisible.value, false)

  const cancelled = createUnsaved({
    configFormDirty: refOf(true),
    confirmResult: false,
  })
  await cancelled.api.requestConfigDialogClose()
  assert.equal(cancelled.calls.confirm.length, 1)
  assert.equal(cancelled.dialogVisible.value, true)

  const allowed = createUnsaved({ configFormDirty: refOf(true) })
  await allowed.api.requestConfigDialogClose()
  assert.equal(allowed.calls.confirm.length, 1)
  assert.equal(allowed.dialogVisible.value, false)
})

test('credential draft close only looks at its own input, not sibling drafts', async () => {
  const tongyiKey = refOf('')
  const volcKey = refOf('sk-volc-draft')
  const tongyiVisible = refOf(true)
  const volcVisible = refOf(true)
  const harness = createUnsaved({
    oneKeyTongyiKey: tongyiKey,
    oneKeyVolcKey: volcKey,
    oneKeyTongyiVisible: tongyiVisible,
    oneKeyVolcVisible: volcVisible,
    confirmResult: false,
  })
  const done = []
  await harness.api.confirmOneKeyTongyiClose(() => done.push('tongyi'))
  assert.deepEqual(done, ['tongyi'])
  assert.equal(harness.calls.confirm.length, 0)

  await harness.api.requestOneKeyVolcClose()
  assert.equal(harness.calls.confirm.length, 1)
  assert.equal(volcVisible.value, true)
})

test('validation failure builds a summary, expands the owning section, and clears recovered fields', async () => {
  const summaryRef = refOf([])
  const sections = refOf([])
  const harness = createUnsaved({
    configValidationSummary: summaryRef,
    advancedFormSections: sections,
  })

  await harness.api.handleConfigValidationFailure({
    [MODEL_PROP]: [{ message: '请填写至少一个模型' }],
    [DEFAULT_MODEL_FIELD]: [{ message: 'secret-should-not-leak' }],
    endpoint: [{ message: '请输入提交端点' }],
  })

  assert.deepEqual(summaryRef.value.map((item) => item.field), ['endpoint', MODEL_FIELD, DEFAULT_MODEL_FIELD])
  assert.equal(summaryRef.value.find((item) => item.field === DEFAULT_MODEL_FIELD).prop, DEFAULT_MODEL_FIELD)
  assert.equal(summaryRef.value.find((item) => item.field === MODEL_FIELD).prop, MODEL_PROP)
  assert.equal(summaryRef.value.some((item) => String(item.message).includes('secret-should-not-leak')), false)
  assert.equal(summaryRef.value.find((item) => item.field === DEFAULT_MODEL_FIELD).message, DEFAULT_MODEL_VALIDATION_MESSAGE)
  assert.deepEqual(sections.value, ['endpoint'])
  assert.equal(harness.calls.nextTick, 1)
  assert.deepEqual(harness.calls.query, ['[data-ai-config-field="endpoint"]'])

  harness.api.handleConfigFieldValidated(MODEL_PROP, true)
  assert.equal(summaryRef.value.some((item) => item.field === MODEL_FIELD), false)
  assert.equal(summaryRef.value.some((item) => item.field === DEFAULT_MODEL_FIELD), true)
  harness.api.clearConfigValidationSummary()
  assert.deepEqual(summaryRef.value, [])
})

test('bound default-model validator follows ComfyUI and model list refs', () => {
  const modelList = refOf([])
  const isComfyUiForm = refOf(true)
  const harness = createUnsaved({ formModelList: modelList, isComfyUiForm })
  assert.equal(harness.api.isDefaultModelSelectionValid(''), true)
  isComfyUiForm.value = false
  assert.equal(harness.api.isDefaultModelSelectionValid(''), false)
  modelList.value = ['qwen-plus']
  assert.equal(harness.api.isDefaultModelSelectionValid('qwen-plus'), true)
})
