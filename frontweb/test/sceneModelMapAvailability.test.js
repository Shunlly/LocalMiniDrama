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
