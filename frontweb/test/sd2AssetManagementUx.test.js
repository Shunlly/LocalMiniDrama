import test from 'node:test'
import assert from 'node:assert/strict'
import { readSd2AssetSources } from './helpers/sd2AssetSources.js'

const sources = readSd2AssetSources()
const source = sources.combined
const parentSource = sources.parent

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

const template = [sources.parent, sources.groupList, sources.assetList, sources.filter, sources.dialogs, sources.intro, sources.connectionForm, sources.lastResponse].map(templateOnly).join('\n')
const TITLE_BINDING = ':title="mutationLocked ? mutationLockReason : undefined"'

test('写锁定按钮给出中文原因，隐藏输入不加 title', () => {
  assert.match(source, /from ['"]@\/utils\/elementPlusFeedback\.js['"]/)
  assert.doesNotMatch(source, /from ['"]element-plus['"]/)
  assert.match(source, /const mutationLocked = computed\(\(\) => props\.writeLocked\)/)
  assert.match(source, /const mutationLockReason = computed\(\(\) => \(/)
  assert.match(source, /配置尚未就绪，暂时不能修改资产/)
  assert.match(source, /正在保存到 AI 配置，请稍候/)
  assert.match(source, /正在提交资产请求，请稍候/)
  assert.match(source, /正在刷新资产组，请稍候/)
  assert.match(source, /正在刷新资产列表，请稍候/)
  assert.match(source, /title="已保存的资产组标识不能修改"/)
  assert.match(source, /title="已保存的资产标识不能修改"/)
  assert.equal(
    (source.match(/:disabled="dlgLoading" :title="dlgLoading \? '正在提交资产请求，请稍候' : undefined"/g) || []).length,
    4,
  )
  assert.match(source, /writeLocked:\s*\{\s*type:\s*Boolean,\s*default:\s*true/)
  assert.match(source, /if \(mutationLocked\.value && MUTATING_ACTIONS\.has\(action\)\)/)
  assert.match(source, /function openCreateGroup\([\s\S]*if \(mutationLocked\.value\) return/)
  assert.match(source, /function openCreateAsset\([\s\S]*if \(mutationLocked\.value\) return/)
  assert.match(source, /async function deleteGroup\([\s\S]*if \(mutationLocked\.value\) return/)
  assert.match(source, /async function deleteAsset\([\s\S]*if \(mutationLocked\.value\) return/)

  const lockedControls = openingTags(template, ['el-button', 'el-input', 'input', 'button']).filter((tag) => (
    tag.includes(':disabled="mutationLocked"')
  ))
  assert.equal(lockedControls.length, 6)

  const busyControls = openingTags(template, ['el-button']).filter((tag) => (
    tag.includes('saveLockReason')
    || tag.includes('submitLockReason')
    || tag.includes('refreshGroupsLockReason')
    || tag.includes('refreshAssetsLockReason')
  ))
  assert.equal(busyControls.length, 7)
  for (const tag of busyControls) {
    assert.match(tag, /:title="(?:saveLockReason|submitLockReason|refreshGroupsLockReason|refreshAssetsLockReason)"/)
    assert.match(tag, /:disabled="Boolean\((?:saveLockReason|submitLockReason|refreshGroupsLockReason|refreshAssetsLockReason)\)"/)
  }

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

test('即梦资产说明不泄漏英文错误码、HTTP 状态码和 ListAssetGroups', () => {
  assert.match(sources.connectionForm, /若仍提示没有权限/)
  assert.doesNotMatch(sources.connectionForm, /报\s*40[13]/)
  assert.doesNotMatch(sources.connectionForm, /\b(?:HTTP\s*)?40[13]\b/)
  assert.doesNotMatch(sources.intro, /Invalid Authorization/)
  assert.doesNotMatch(sources.connectionForm, /Invalid Authorization/)
  const visible = [sources.intro, sources.connectionForm, sources.groupList, sources.assetList, sources.filter, sources.dialogs, sources.lastResponse].join('\n')
  assert.doesNotMatch(visible, /Invalid Authorization/)
  assert.doesNotMatch(visible, /ListAssetGroups/)
  assert.doesNotMatch(visible, /\bHTTP\s*\d{3}\b/)
  assert.match(parentSource, /call\('ListAssetGroups'/)
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

test('认证资产管理页把列表、筛选和对话框交给 sd2 子组件，写操作仍留在页内', () => {
  assert.match(parentSource, /import Sd2AssetIntro from ['"]@\/components\/sd2\/Sd2AssetIntro\.vue['"]/)
  assert.match(parentSource, /import Sd2AssetConnectionForm from ['"]@\/components\/sd2\/Sd2AssetConnectionForm\.vue['"]/)
  assert.match(parentSource, /import Sd2AssetGroupList from ['"]@\/components\/sd2\/Sd2AssetGroupList\.vue['"]/)
  assert.match(parentSource, /import Sd2AssetList from ['"]@\/components\/sd2\/Sd2AssetList\.vue['"]/)
  assert.match(parentSource, /import Sd2AssetLastResponse from ['"]@\/components\/sd2\/Sd2AssetLastResponse\.vue['"]/)
  assert.match(parentSource, /import Sd2AssetDialogs from ['"]@\/components\/sd2\/Sd2AssetDialogs\.vue['"]/)
  assert.match(parentSource, /<Sd2AssetGroupList[\s\S]*:on-group-row-change="onGroupRowChange"/)
  assert.match(parentSource, /<Sd2AssetList[\s\S]*v-model:asset-group-id-input="assetGroupIdInput"/)
  assert.match(parentSource, /<Sd2AssetConnectionForm[\s\S]*:save-to-ai-config="saveToAiConfig"/)
  assert.match(parentSource, /<Sd2AssetConnectionForm[\s\S]*:video-like-configs="videoLikeConfigs"/)
  assert.match(parentSource, /<Sd2AssetLastResponse[\s\S]*v-model="lastRawJson"/)
  assert.match(parentSource, /<Sd2AssetDialogs[\s\S]*:submit-create-group="submitCreateGroup"/)
  assert.match(sources.assetList, /<Sd2AssetFilter v-model="assetGroupIdInput"/)
  assert.doesNotMatch(parentSource, /<AccessibleDialog/)
  assert.doesNotMatch(parentSource, /<el-table/)
  assert.doesNotMatch(parentSource, /<el-form[\s>]/)
  assert.doesNotMatch(parentSource, /<el-alert[\s>]/)
  assert.doesNotMatch(parentSource, /async function loadList\(/)
  assert.doesNotMatch(parentSource, /async function openTest\(/)
  for (const [name, body] of Object.entries({
    groupList: sources.groupList,
    assetList: sources.assetList,
    filter: sources.filter,
    dialogs: sources.dialogs,
    intro: sources.intro,
    connectionForm: sources.connectionForm,
    lastResponse: sources.lastResponse,
  })) {
    assert.doesNotMatch(body, /async function loadList\(/, `${name} 不应抽 AI 配置 loadList`)
    assert.doesNotMatch(body, /async function openTest\(/, `${name} 不应抽 AI 配置 openTest`)
    assert.doesNotMatch(body, /aiAPI\./, `${name} 不应直接调 aiAPI`)
    assert.doesNotMatch(body, /from ['"]element-plus['"]/)
  }
})
