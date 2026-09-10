import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function readSource(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
}

const vueSource = readSource(new URL('../src/components/AIConfigContent.vue', import.meta.url))
const modelListSource = readSource(new URL('../src/components/aiConfig/AiConfigModelListSection.vue', import.meta.url))
const sd2Source = readSource(new URL('../src/components/Sd2AssetManagement.vue', import.meta.url))
const apiSource = readSource(new URL('../src/api/ai.js', import.meta.url))

function extractNamedFunction(source, name) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing ${name}`)
  let i = source.indexOf('{', start)
  assert.notEqual(i, -1, `${name} missing body`)
  let depth = 0
  for (; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unclosed ${name}`)
}

function loadHelper(name) {
  const parseModelTextCode = extractNamedFunction(vueSource, 'parseModelText')
  const code = extractNamedFunction(vueSource, name)
  return new Function(`${parseModelTextCode}; ${code}; return ${name};`)()
}

function templateWithoutScript(source) {
  return source
    .replace(/<script\b[\s\S]*?<\/script>/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

function collectElMessageLiterals(source) {
  const values = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (!/ElMessage(?:Box)?\.(?:success|error|warning|info|confirm|alert)/.test(lines[i])) continue
    const related = [lines[i]]
    if (/\(\s*$/.test(lines[i])) {
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
        related.push(lines[j])
        if (/\)\s*$/.test(lines[j].trim()) || lines[j].includes('})')) break
      }
    }
    const chunk = related.join('\n')
    for (const match of chunk.matchAll(/`([^`]+)`|'((?:\\'|[^'])+)'|"((?:\\"|[^"])+)"/g)) {
      const value = (match[1] || match[2] || match[3] || '').trim()
      if (value) values.push(value)
    }
  }
  return values
}

function collectUserFacingText(source) {
  const template = templateWithoutScript(source)
  const attrValues = []
  const attrPattern = /(?<!:)\b(?:label|title|placeholder|aria-label|description|empty-text|no-data-text)\s*=\s*(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1/g
  for (const match of template.matchAll(attrPattern)) attrValues.push(match[2])
  return [template, ...attrValues, ...collectElMessageLiterals(source)].join('\n')
}

const parseModelText = loadHelper('parseModelText')
const extractDiscoveredModelIds = loadHelper('extractDiscoveredModelIds')
const mergeModelTextWithDiscovered = loadHelper('mergeModelTextWithDiscovered')

test('AI 配置页提供从服务读取模型按钮，并接上 discoverModels API', () => {
  assert.match(apiSource, /discoverModels\(body, options = \{\}\) \{\s*return request\.post\('\/ai-configs\/discover-models', body, options\)/)
  assert.match(vueSource, /:discover-models-from-service="discoverModelsFromService"/)
  assert.match(modelListSource, /@click="discoverModelsFromService"/)
  assert.match(modelListSource, />从服务读取模型</)
  assert.match(modelListSource, /:disabled="discoverModelsDisabled"/)
  assert.match(modelListSource, /:loading="discoverModelsLoading"/)
  assert.match(vueSource, /请先填写接口地址/)
  assert.match(vueSource, /请先填写 API 密钥后再读取模型/)
  assert.match(modelListSource, /正在从服务读取模型/)
  assert.match(modelListSource, /aria-label="模型列表"/)
  assert.doesNotMatch(modelListSource, /<el-input[^>]*data-ai-config-field="model"[^>]*readonly/)
  assert.match(modelListSource, /aria-label="追加预设模型"/)
  assert.match(vueSource, /<el-option label="Fal\.ai" value="fal" \/>/)
  assert.match(vueSource, /<el-option label="Replicate" value="replicate" \/>/)
})

test('读取到的模型 id 去重追加，不覆盖用户已有项', () => {
  const merged = mergeModelTextWithDiscovered('gpt-4o, my-custom', ['gpt-4o', 'deepseek-v3', 'my-custom', 'qwen-plus'])
  assert.equal(merged.text, 'gpt-4o, my-custom\ndeepseek-v3\nqwen-plus')
  assert.deepEqual(merged.appended, ['deepseek-v3', 'qwen-plus'])
  assert.deepEqual(merged.merged, ['gpt-4o', 'my-custom', 'deepseek-v3', 'qwen-plus'])
  assert.deepEqual(parseModelText(merged.text), merged.merged)

  const unchanged = mergeModelTextWithDiscovered('gpt-4o\nmy-custom', ['gpt-4o', 'my-custom'])
  assert.equal(unchanged.text, 'gpt-4o\nmy-custom')
  assert.deepEqual(unchanged.appended, [])

  assert.deepEqual(extractDiscoveredModelIds({ models: [{ id: 'a' }, { name: 'b' }, 'c'] }), ['a', 'b', 'c'])
  assert.deepEqual(extractDiscoveredModelIds({ data: [{ id: 'only-id' }] }), ['only-id'])
  assert.deepEqual(extractDiscoveredModelIds({ models: [] }), [])
})

test('读取模型失败或目录为空时不改已填模型列表', () => {
  const discoverFn = extractNamedFunction(vueSource, 'discoverModelsFromService')
  assert.match(discoverFn, /ElMessage\.warning\('服务没有返回模型目录，请手工填写模型名'\)/)
  assert.match(discoverFn, /const result = mergeModelTextWithDiscovered\(form\.value\.modelText, ids\)/)
  const emptyIdx = discoverFn.indexOf("服务没有返回模型目录，请手工填写模型名")
  const assignIdx = discoverFn.indexOf('form.value.modelText = result.text')
  assert.ok(emptyIdx >= 0 && assignIdx > emptyIdx)
  const emptyReturnIdx = discoverFn.indexOf('return', emptyIdx)
  assert.ok(emptyReturnIdx > emptyIdx && emptyReturnIdx < assignIdx)
  const catchStart = discoverFn.indexOf('} catch (e) {')
  const finallyStart = discoverFn.indexOf('} finally {', catchStart)
  const catchBody = discoverFn.slice(catchStart, finallyStart)
  assert.match(catchBody, /toUserFacingError\(e, '暂时无法读取模型目录，请稍后重试或手工填写模型名。'/)
  assert.doesNotMatch(catchBody, /form\.value\.modelText/)
  assert.doesNotMatch(catchBody, /Network Error/)
  assert.doesNotMatch(discoverFn, /form\.value\.modelText = ids/)
  assert.match(vueSource, /suppressErrorToast: true/)
  assert.match(vueSource, /if \(!String\(form\.value\.default_model \|\| ''\)\.trim\(\) && result\.merged\.length\)/)
})

test('连接测试成功后仅轻量提示读取模型目录，不自动覆盖列表', () => {
  const connectionTest = vueSource.slice(
    vueSource.indexOf('async function openTest'),
    vueSource.indexOf('async function onDelete'),
  )
  assert.match(vueSource, /也可以读取模型目录，不会自动覆盖已填写的模型列表。/)
  assert.match(vueSource, /v-if="testSuggestDiscoverModels"/)
  assert.match(connectionTest, /testSuggestDiscoverModels\.value = isOpenAiCompatibleConfig\(row\)/)
  assert.doesNotMatch(connectionTest, /aiAPI\.discoverModels/)
  assert.doesNotMatch(connectionTest, /form\.value\.modelText/)
})

test('允许修改的 AI 配置页用户可见文案不再使用 SD2 认证产品词', () => {
  const vueVisible = collectUserFacingText(vueSource)
  const sd2Visible = collectUserFacingText(sd2Source)
  const forbidden = /SD2\s*认证|SD2认证|SD2\s*资产管理|SD2\s*资产库/
  assert.doesNotMatch(vueVisible, forbidden)
  assert.doesNotMatch(sd2Visible, forbidden)
  assert.match(vueSource, /label="认证资产管理" name="sd2_assets"/)
  assert.match(vueSource, /model_ark_asset: '认证资产库'/)
  assert.match(vueSource, /请在「认证资产管理」标签页编辑此配置/)
  assert.match(vueSource, /点击「认证资产」验证/)
  assert.match(sd2Source, /创作页「认证资产」将优先使用/)
  assert.match(sd2Source, /name: '认证资产库'/)
  assert.match(vueSource, /name="sd2_assets"/)
})
