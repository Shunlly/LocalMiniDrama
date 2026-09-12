import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

const parentSource = read('../src/components/SceneModelMap.vue')
const tableSource = read('../src/components/sceneModelMap/SceneModelMapTable.vue')
const formSource = read('../src/components/sceneModelMap/SceneModelMapForm.vue')
const catalogSource = read('../src/components/sceneModelMap/sceneModelMapCatalog.js')
const source = [parentSource, tableSource, formSource, catalogSource].join('\n')

test('场景模型映射失败时不伪装成空列表，并标出配置可用性', () => {
  assert.match(parentSource, /const loadError = ref\(''\)/)
  assert.match(parentSource, /const hasSuccessfulLoad = ref\(false\)/)
  assert.match(parentSource, /v-if="loadError"/)
  assert.match(parentSource, /aria-label="重新加载场景模型映射"/)
  assert.match(parentSource, /description="暂无场景模型映射配置"/)
  assert.match(parentSource, /v-else-if="hasSuccessfulLoad && !loadError"/)
  assert.match(tableSource, /绑定配置不可用/)
  assert.match(tableSource, /绑定配置已停用/)
  assert.match(tableSource, /服务类型不匹配/)
  assert.match(formSource, /当前服务类型没有可用的启用中 AI 配置/)
  assert.match(parentSource, /ElMessage\.error\(toUserFacingError\(err, '加载场景模型映射失败'\)\)/)
  assert.doesNotMatch(source, /console\.log/)
  assert.match(catalogSource, /config_missing/)
  assert.match(catalogSource, /item\.is_active/)
})

test('场景模型映射禁用按钮给出中文原因', () => {
  assert.match(parentSource, /from ['"]@\/utils\/elementPlusFeedback\.js['"]/)
  assert.doesNotMatch(source, /from ['"]element-plus['"]/)
  assert.match(parentSource, /:title="loading \? '正在重新加载场景模型映射，请稍候' : undefined"/)
  assert.match(parentSource, /:disabled="saving" :title="saving \? '正在保存场景模型映射，请稍候' : undefined"/)
  assert.match(parentSource, /const writeLocked = computed\(\(\) => isWriteLocked\(\{/)
  assert.match(catalogSource, /if \(loading\) return '场景模型映射正在加载，请稍候'/)
  assert.match(catalogSource, /场景模型映射刷新失败，成功重试前不能修改/)
  assert.match(catalogSource, /场景模型映射加载失败，成功重试前不能添加/)
  assert.match(catalogSource, /场景模型映射尚未就绪/)
  assert.equal(
    (source.match(/:disabled="writeLocked" :title="writeLocked \? writeLockReason : undefined"/g) || []).length,
    4,
  )
  assert.match(parentSource, /function openAdd\(\) \{\s*if \(writeLocked\.value\) return/)
  assert.match(parentSource, /function openEdit\(row\) \{\s*if \(writeLocked\.value\) return/)
  assert.match(parentSource, /async function onDelete\(row\) \{\s*if \(writeLocked\.value\) return/)
  assert.match(formSource, /:title="editingKey \? '已保存的业务场景不能修改标识' : undefined"/)
  assert.match(formSource, /editingKey \? '已保存的业务场景不能修改标识' : '选择后会自动设置对应的服务类型'/)
  assert.match(tableSource, /getSceneKeyLabel\(row\.key\) \|\| row\.key/)
  assert.doesNotMatch(source, /<code class="scene-key">\{\{ row.key \}\}<\/code>/)
  assert.match(formSource, /title="由场景键自动决定，不可更改"/)
  assert.match(parentSource, /const modelOverrideDisabledReason = computed/)
  assert.match(catalogSource, /return '请先选择 AI 配置'/)
  assert.match(parentSource, /:title="saving \? '正在保存场景模型映射，请稍候' : undefined"/)
})

test('场景模型映射用户可见文案不出现 scene_key，保存仍用内部 key', () => {
  assert.doesNotMatch(source, /scene_key/)
  assert.match(tableSource, /label="场景键"/)
  assert.doesNotMatch(source, /场景键 \(scene_key\)/)
  assert.match(parentSource, /当文本生成请求指定业务场景时/)
  assert.match(catalogSource, /value: 'image_polish', label: '分镜图提示词润色'/)
  assert.match(parentSource, /await sceneModelMapAPI\.create\(\{ \.\.\.body, key: form\.value\.key \}\)/)
  assert.match(parentSource, /await sceneModelMapAPI\.update\(editingKey\.value, body\)/)
  assert.match(parentSource, /await sceneModelMapAPI\.delete\(row\.key\)/)
  assert.match(parentSource, /确定要删除场景「\$\{getSceneKeyLabel\(row\.key\) \|\| row\.key\}」的模型映射配置吗？/)
  assert.match(parentSource, /from '\.\/sceneModelMap\/SceneModelMapTable\.vue'/)
  assert.match(parentSource, /from '\.\/sceneModelMap\/SceneModelMapForm\.vue'/)
  assert.match(parentSource, /:before-close="confirmDialogClose"/)
})
