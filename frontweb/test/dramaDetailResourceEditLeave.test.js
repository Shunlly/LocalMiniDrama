import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dramaDetailSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')

function readTopLevelFunction(source, name) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing ${name}`)
  const brace = source.indexOf('{', start)
  let depth = 0
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  assert.fail(`unclosed ${name}`)
}

function loadDramaDetailHelpers(names) {
  const body = names.map((name) => readTopLevelFunction(dramaDetailSource, name)).join('\n')
  return new Function(`${body}; return { ${names.join(', ')} }`)()
}

test('角色场景道具编辑弹窗未保存关闭和离开都要中文确认', () => {
  const editors = [
    ['editDramaCharVisible', 'dramaChar'],
    ['editDramaSceneVisible', 'dramaScene'],
    ['editDramaPropVisible', 'dramaProp'],
    ['editCharVisible', 'char'],
    ['editSceneVisible', 'scene'],
    ['editPropVisible', 'prop'],
  ]
  for (const [visible, kind] of editors) {
    assert.match(
      dramaDetailSource,
      new RegExp(`<AccessibleDialog v-model="${visible}"[^>]*:before-close="\\(done\\) => requestResourceEditorClose\\('${kind}', done\\)"`),
    )
    assert.match(
      dramaDetailSource,
      new RegExp(`@click="requestResourceEditorClose\\('${kind}'\\)">取消`),
    )
    assert.match(
      dramaDetailSource,
      new RegExp(`captureResourceEditorBaseline\\('${kind}'\\)`),
    )
  }
  assert.match(
    dramaDetailSource,
    /async function confirmInfoLeave\(\) \{\s*if \(\(await confirmBatchImportLeave\(\)\) === false\) return false\s*if \(\(await confirmResourceEditLeave\(\)\) === false\) return false/,
  )
  assert.match(
    dramaDetailSource,
    /function handleInfoBeforeUnload\(event\) \{\s*if \(!shouldProtectInfoLeave\.value && !episodeBatchImportDialogRef\.value\?\.hasUnsavedWork\?\.\(\) && !hasUnsavedResourceEdits\(\)\) return/,
  )
  assert.match(dramaDetailSource, /当前角色、场景或道具尚未保存，关闭后本次修改会丢失。/)
  assert.match(dramaDetailSource, /放弃未保存修改？/)
  assert.match(dramaDetailSource, /confirmButtonText: '放弃修改'/)
  assert.match(dramaDetailSource, /cancelButtonText: '继续编辑'/)
  assert.match(dramaDetailSource, /:title="assetImageUrl\(editDramaCharForm\) \? undefined : '暂无图片'"/)
  assert.match(dramaDetailSource, /:title="assetImageUrl\(editPropForm\) \? undefined : '暂无图片'"/)
  assert.match(dramaDetailSource, /<header class="header">/)
  assert.match(dramaDetailSource, /editDramaCharVisible\.value = false/)
  assert.match(dramaDetailSource, /editCharVisible\.value = false/)
})

test('资源编辑脏检查只看未保存字段，图片单独变更不算脏', () => {
  const { snapshotResourceEdit, isResourceEditDirty } = loadDramaDetailHelpers([
    'snapshotResourceEdit',
    'isResourceEditDirty',
  ])
  const keys = ['name', 'description']
  const baseline = snapshotResourceEdit({ name: '阿宁', description: '主角' }, keys)

  assert.equal(
    isResourceEditDirty(true, { name: '阿宁', description: '主角' }, baseline, keys),
    false,
  )
  assert.equal(
    isResourceEditDirty(true, { name: '阿宁改', description: '主角' }, baseline, keys),
    true,
  )
  assert.equal(
    isResourceEditDirty(true, { name: '阿宁', description: '主角', image_url: 'https://cdn.example/new.png' }, baseline, keys),
    false,
  )
  assert.equal(
    isResourceEditDirty(true, { name: '阿宁', description: '主角', imgGenerating: true }, baseline, keys),
    true,
  )
  assert.equal(
    isResourceEditDirty(false, { name: '阿宁改', description: '主角' }, baseline, keys),
    false,
  )
})
