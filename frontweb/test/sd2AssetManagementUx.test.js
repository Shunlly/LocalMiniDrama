import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/Sd2AssetManagement.vue', import.meta.url), 'utf8')

function templateOnly(vueSource) {
  const start = vueSource.indexOf('<template')
  const end = vueSource.indexOf('<script', start)
  assert.ok(start >= 0 && end > start, '组件必须包含 template 与 script')
  return vueSource.slice(start, end)
}

function openingTags(fragment, tagNames) {
  const names = new Set(tagNames)
  const tags = []
  const matcher = /<([A-Za-z][\w-]*)\b/g
  let match
  while ((match = matcher.exec(fragment))) {
    if (!names.has(match[1])) continue
    let quote = ''
    let index = matcher.lastIndex
    for (; index < fragment.length; index += 1) {
      const character = fragment[index]
      if (quote) {
        if (character === quote) quote = ''
      } else if (character === '"' || character === "'") quote = character
      else if (character === '>') break
    }
    tags.push(fragment.slice(match.index, index + 1))
    matcher.lastIndex = index + 1
  }
  return tags
}

function isHiddenInput(opening) {
  return /type\s*=\s*['"]hidden['"]/.test(opening)
    || ((/type\s*=\s*['"]file['"]/.test(opening) || opening.startsWith('<input'))
      && (/aria-hidden/.test(opening) || /display:\s*none/.test(opening)))
}

const template = templateOnly(source)
const TITLE_BINDING = ':title="mutationLocked ? mutationLockReason : undefined"'

test('写锁定按钮给出中文原因，隐藏输入不加 title', () => {
  assert.match(source, /const mutationLocked = computed\(\(\) => props\.writeLocked\)/)
  assert.match(source, /const mutationLockReason = computed\(\(\) => \(/)
  assert.match(source, /配置尚未就绪，暂时不能修改资产/)
  assert.match(source, /writeLocked:\s*\{\s*type:\s*Boolean,\s*default:\s*true/)
  assert.match(source, /if \(mutationLocked\.value && MUTATING_ACTIONS\.has\(action\)\)/)
  assert.match(source, /function openCreateGroup\([\s\S]*if \(mutationLocked\.value\) return/)
  assert.match(source, /function openCreateAsset\([\s\S]*if \(mutationLocked\.value\) return/)
  assert.match(source, /async function deleteGroup\([\s\S]*if \(mutationLocked\.value\) return/)
  assert.match(source, /async function deleteAsset\([\s\S]*if \(mutationLocked\.value\) return/)

  const lockedControls = openingTags(template, ['el-button', 'el-input', 'input', 'button']).filter((tag) => (
    tag.includes(':disabled="mutationLocked"')
  ))
  assert.equal(lockedControls.length, 11)

  for (const tag of lockedControls) {
    if (isHiddenInput(tag)) {
      assert.doesNotMatch(tag, /\s(?:|:|v-bind:)title\s*=/, `隐藏输入不应带 title：${tag}`)
      continue
    }
    assert.ok(tag.includes(TITLE_BINDING), `写锁定控件缺少中文原因：${tag}`)
  }

  const hiddenInputs = openingTags(template, ['el-input', 'input']).filter(isHiddenInput)
  for (const tag of hiddenInputs) {
    assert.doesNotMatch(tag, /\s(?:|:|v-bind:)title\s*=/, `隐藏输入不应带 title：${tag}`)
  }
})

test('用户可见的资产组 Id 改为编号，接口字段名保持原文', () => {
  assert.match(source, /label="默认资产组编号"/)
  assert.match(source, /与下方「资产」列表使用的组编号一致/)
  assert.match(source, /资产（需组编号）/)
  assert.match(source, /placeholder="组编号，或左侧点选一行"/)
  assert.match(source, /<el-form-item label="资产组编号" required>/)
  assert.match(source, /placeholder="资产组编号"/)
  assert.match(source, /ElMessage\.warning\('请填写默认资产组编号（创作页「认证资产」需要）'\)/)
  assert.match(source, /ElMessage\.warning\('请填写或选择资产组编号'\)/)
  assert.match(source, /ElMessage\.warning\('请填写资产组编号与名称'\)/)

  assert.doesNotMatch(source, /默认资产组 Id/)
  assert.doesNotMatch(source, /组 Id/)
  assert.doesNotMatch(source, /资产组 Id/)

  assert.match(source, /<el-table-column prop="Id"/)
  assert.match(source, /payload = \{ Id: editGroupId\.value, Name: editGroupName\.value \}/)
  assert.match(source, /payload = \{ Id: editAssetId\.value, Name: editAssetName\.value \}/)
  assert.match(source, /call\('DeleteAssetGroup', \{ Id: row\.Id \}\)/)
  assert.match(source, /call\('DeleteAsset', \{ Id: row\.Id \}\)/)
  assert.match(source, /GroupId: formAssetGroupId\.value\.trim\(\)/)
  assert.match(source, /placeholder='若填写则优先整段作为请求体（须含 Id）'/)
  assert.match(source, /placeholder="若填写则整段作为请求体（须含 Id）"/)
})
