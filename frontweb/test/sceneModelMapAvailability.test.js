import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/SceneModelMap.vue', import.meta.url), 'utf8')

test('场景模型映射失败时不伪装成空列表，并标出配置可用性', () => {
  assert.match(source, /const loadError = ref\(''\)/)
  assert.match(source, /const hasSuccessfulLoad = ref\(false\)/)
  assert.match(source, /v-if="loadError"/)
  assert.match(source, /aria-label="重新加载场景模型映射"/)
  assert.match(source, /description="暂无场景模型映射配置"/)
  assert.match(source, /v-else-if="hasSuccessfulLoad && !loadError"/)
  assert.match(source, /绑定配置不可用/)
  assert.match(source, /绑定配置已停用/)
  assert.match(source, /服务类型不匹配/)
  assert.match(source, /当前服务类型没有可用的启用中 AI 配置/)
  assert.match(source, /ElMessage.error\(toUserFacingError\(err, '加载场景模型映射失败'\)\)/)
  assert.doesNotMatch(source, /console\.log/)
  assert.match(source, /config_missing/)
  assert.match(source, /item\.is_active/)
})

test('场景模型映射禁用按钮给出中文原因', () => {
  assert.match(source, /from ['"]@\/utils\/elementPlusFeedback\.js['"]/)
  assert.doesNotMatch(source, /from ['"]element-plus['"]/)
  assert.match(source, /:title="loading \? '正在重新加载场景模型映射，请稍候' : undefined"/)
  assert.match(source, /:disabled="saving" :title="saving \? '正在保存场景模型映射，请稍候' : undefined"/)
  assert.match(source, /const writeLocked = computed\(\(\) => loading\.value \|\| !hasSuccessfulLoad\.value \|\| Boolean\(loadError\.value\)\)/)
  assert.match(source, /if \(loading\.value\) return '场景模型映射正在加载，请稍候'/)
  assert.match(source, /场景模型映射刷新失败，成功重试前不能修改/)
  assert.match(source, /场景模型映射加载失败，成功重试前不能添加/)
  assert.match(source, /场景模型映射尚未就绪/)
  assert.equal(
    (source.match(/:disabled="writeLocked" :title="writeLocked \? writeLockReason : undefined"/g) || []).length,
    4,
  )
  assert.match(source, /function openAdd\(\) \{\s*if \(writeLocked\.value\) return/)
  assert.match(source, /function openEdit\(row\) \{\s*if \(writeLocked\.value\) return/)
  assert.match(source, /async function onDelete\(row\) \{\s*if \(writeLocked\.value\) return/)
  assert.match(source, /:title="editingKey \? '已保存的业务场景不能修改标识' : undefined"/)
  assert.match(source, /editingKey \? '已保存的业务场景不能修改标识' : '选择后会自动设置对应的服务类型'/)
  assert.match(source, /getSceneKeyLabel\(row.key\) \|\| row.key/)
  assert.doesNotMatch(source, /<code class="scene-key">\{\{ row.key \}\}<\/code>/)
  assert.match(source, /title="由场景键自动决定，不可更改"/)
  assert.match(source, /const modelOverrideDisabledReason = computed/)
  assert.match(source, /return '请先选择 AI 配置'/)
  assert.match(source, /:title="saving \? '正在保存场景模型映射，请稍候' : undefined"/)
})

test('场景模型映射用户可见文案不出现 scene_key，保存仍用内部 key', () => {
  assert.doesNotMatch(source, /scene_key/)
  assert.match(source, /label="场景键"/)
  assert.doesNotMatch(source, /场景键 \(scene_key\)/)
  assert.match(source, /当文本生成请求指定业务场景时/)
  assert.match(source, /value: 'image_polish', label: '分镜图提示词润色'/)
  assert.match(source, /await sceneModelMapAPI\.create\(\{ \.\.\.body, key: form\.value\.key \}\)/)
  assert.match(source, /await sceneModelMapAPI\.update\(editingKey\.value, body\)/)
  assert.match(source, /await sceneModelMapAPI\.delete\(row\.key\)/)
  assert.match(source, /确定要删除场景「\$\{getSceneKeyLabel\(row\.key\) \|\| row\.key\}」的模型映射配置吗？/)
})
