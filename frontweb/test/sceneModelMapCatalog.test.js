import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applySceneKeyChange,
  createEmptySceneModelForm,
  decorateMapRow,
  describeModelOverrideDisabledReason,
  describeWriteLockReason,
  filterConfigsForService,
  formFromMapRow,
  getSceneKeyLabel,
  isWriteLocked,
  SCENE_MODEL_PREDEFINED_KEYS,
  serviceTypeLabel,
} from '../src/components/sceneModelMap/sceneModelMapCatalog.js'

const TEXT_CONFIG_ID = 41
const IMAGE_CONFIG_ID = 77
assert.notEqual(TEXT_CONFIG_ID, IMAGE_CONFIG_ID)

const textConfig = {
  id: TEXT_CONFIG_ID,
  name: '文本模型',
  provider: 'openai',
  service_type: 'text',
  is_active: true,
}
const imageConfig = {
  id: IMAGE_CONFIG_ID,
  name: '文本模型',
  provider: 'openai',
  service_type: 'image',
  is_active: true,
}

test('写锁区分首次加载失败和刷新失败，文案为简体中文', () => {
  assert.equal(isWriteLocked({ loading: true, loadError: '', hasSuccessfulLoad: false }), true)
  assert.equal(describeWriteLockReason({ loading: true, loadError: '', hasSuccessfulLoad: false }), '场景模型映射正在加载，请稍候')
  assert.equal(
    describeWriteLockReason({ loading: false, loadError: '网络中断', hasSuccessfulLoad: false }),
    '场景模型映射加载失败，成功重试前不能添加',
  )
  assert.equal(
    describeWriteLockReason({ loading: false, loadError: '网络中断', hasSuccessfulLoad: true }),
    '场景模型映射刷新失败，成功重试前不能修改',
  )
  assert.equal(describeWriteLockReason({ loading: false, loadError: '', hasSuccessfulLoad: false }), '场景模型映射尚未就绪')
  assert.equal(describeWriteLockReason({ loading: false, loadError: '', hasSuccessfulLoad: true }), '')
  assert.equal(isWriteLocked({ loading: false, loadError: '', hasSuccessfulLoad: true }), false)
})

test('装饰映射行按配置 id 匹配，不把同名或不同服务类型的配置当成同一个', () => {
  const row = decorateMapRow({
    key: 'image_polish',
    config_id: String(TEXT_CONFIG_ID),
    service_type: 'text',
  }, [imageConfig, { ...textConfig, id: TEXT_CONFIG_ID }])
  assert.equal(row.config_name, '文本模型')
  assert.equal(row.config_missing, false)
  assert.equal(row.config_type_mismatch, false)

  const missing = decorateMapRow({
    key: 'image_polish',
    config_id: TEXT_CONFIG_ID,
    service_type: 'text',
  }, [imageConfig])
  assert.equal(missing.config_missing, true)
  assert.equal(missing.config_name, null)

  const mismatch = decorateMapRow({
    key: 'image_polish',
    config_id: IMAGE_CONFIG_ID,
    service_type: 'text',
  }, [imageConfig])
  assert.equal(mismatch.config_missing, false)
  assert.equal(mismatch.config_type_mismatch, true)

  const inactive = decorateMapRow({
    key: 'image_polish',
    config_id: TEXT_CONFIG_ID,
    service_type: 'text',
  }, [{ ...textConfig, is_active: false }])
  assert.equal(inactive.config_inactive, true)
})

test('筛选配置不会把其他服务类型或未选中的停用项混进来', () => {
  const inactiveText = { ...textConfig, is_active: false }
  const mixed = [inactiveText, imageConfig, { ...textConfig, id: 88, name: '启用文本' }]
  const filtered = filterConfigsForService(mixed, 'text', TEXT_CONFIG_ID)
  assert.deepEqual(filtered.map((item) => item.id), [TEXT_CONFIG_ID, 88])
  assert.equal(filterConfigsForService(mixed, 'text', null).map((item) => item.id).join(','), '88')
  assert.equal(describeModelOverrideDisabledReason([], ''), '请先选择 AI 配置')
  assert.equal(describeModelOverrideDisabledReason(['gpt-4o'], ''), '')
})

test('改场景键会重置配置和模型，不会沿用上一条映射的 config_id', () => {
  const form = {
    ...createEmptySceneModelForm(),
    key: 'story_generation',
    service_type: 'text',
    config_id: TEXT_CONFIG_ID,
    model_override: 'gpt-old',
  }
  const next = applySceneKeyChange(form, 'image_polish')
  assert.equal(next.key, 'image_polish')
  assert.equal(next.service_type, 'text')
  assert.equal(next.config_id, null)
  assert.equal(next.model_override, '')
  assert.equal(getSceneKeyLabel('image_polish'), '分镜图提示词润色')
  assert.equal(getSceneKeyLabel('missing-key'), '')
  assert.equal(serviceTypeLabel('text'), '文本/对话')
  assert.ok(SCENE_MODEL_PREDEFINED_KEYS.every((item) => item.service_type === 'text'))
  const fromRow = formFromMapRow({
    key: 'image_polish',
    description: '润色',
    service_type: 'text',
    config_id: TEXT_CONFIG_ID,
    model_override: 'gpt-4o',
  })
  assert.equal(fromRow.config_id, TEXT_CONFIG_ID)
  assert.notEqual(fromRow.config_id, IMAGE_CONFIG_ID)
})
