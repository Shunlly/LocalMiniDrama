import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  hasChinese,
  dramaDetailUserError,
  characterRoleLabel,
  propTypeLabel,
} from '../src/components/dramaDetail/dramaDetailResourceEdit.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const helperSource = read('../src/components/dramaDetail/dramaDetailResourceEdit.js')
const pageSource = read('../src/views/DramaDetail.vue')
const editorsSource = read('../src/components/dramaDetail/dramaDetailProductionEditors.js')
const leaveSource = read('../src/components/dramaDetail/dramaDetailResourceEditorLeave.js')
const listsSource = read('../src/components/dramaDetail/dramaDetailResourceLists.js')

test('hasChinese 只认汉字，空值和英文都不算', () => {
  assert.equal(hasChinese('主角'), true)
  assert.equal(hasChinese('关键道具'), true)
  assert.equal(hasChinese('main'), false)
  assert.equal(hasChinese(''), false)
  assert.equal(hasChinese(null), false)
  assert.equal(hasChinese(undefined), false)
})

test('characterRoleLabel 映射已知角色，未知英文归其他，中文自定义原样返回', () => {
  assert.equal(characterRoleLabel('main'), '主角')
  assert.equal(characterRoleLabel('supporting'), '配角')
  assert.equal(characterRoleLabel('extra'), '群演')
  assert.equal(characterRoleLabel('minor'), '次要')
  assert.equal(characterRoleLabel('  main  '), '主角')
  assert.equal(characterRoleLabel(''), '')
  assert.equal(characterRoleLabel(null), '')
  assert.equal(characterRoleLabel('客串'), '客串')
  assert.equal(characterRoleLabel('npc'), '其他')
  assert.equal(characterRoleLabel('NPC'), '其他')
})

test('propTypeLabel 映射已知类型，未知英文归其他，中文自定义原样返回', () => {
  assert.equal(propTypeLabel('key'), '关键道具')
  assert.equal(propTypeLabel('background'), '背景物件')
  assert.equal(propTypeLabel('handheld'), '手持道具')
  assert.equal(propTypeLabel('costume'), '服饰')
  assert.equal(propTypeLabel('  key  '), '关键道具')
  assert.equal(propTypeLabel(''), '')
  assert.equal(propTypeLabel(null), '')
  assert.equal(propTypeLabel('信物'), '信物')
  assert.equal(propTypeLabel('gadget'), '其他')
})

test('dramaDetailUserError 走统一中文转义并带上服务名', () => {
  assert.equal(dramaDetailUserError({ message: '请先填写名称' }, '保存失败'), '请先填写名称')
  assert.equal(dramaDetailUserError({ message: 'Network Error' }, '保存失败'), '保存失败')
  assert.equal(dramaDetailUserError('cancel'), '操作已取消')
  assert.equal(
    dramaDetailUserError({ response: { status: 500 } }, '角色库加载失败，请重试', '角色库'),
    '角色库暂时不可用，请稍后重试',
  )
  assert.equal(
    dramaDetailUserError({ response: { status: 503 } }),
    '项目服务暂时不可用，请稍后重试',
  )
  assert.doesNotMatch(dramaDetailUserError({ message: 'Failed to fetch' }, '上传失败'), /Failed to fetch/i)
})

test('DramaDetail 只消费纯函数，open/save 由制作资源工厂装配且未抽成 composable', () => {
  assert.match(
    pageSource,
    /import \{ dramaDetailUserError, characterRoleLabel, propTypeLabel \} from '@\/components\/dramaDetail\/dramaDetailResourceEdit\.js'/,
  )
  assert.match(pageSource, /characterRoleLabel,/)
  assert.match(pageSource, /propTypeLabel,/)
  assert.match(pageSource, /dramaDetailUserError\(/)
  assert.doesNotMatch(pageSource, /function hasChinese\(/)
  assert.doesNotMatch(pageSource, /function dramaDetailUserError\(/)
  assert.doesNotMatch(pageSource, /function characterRoleLabel\(/)
  assert.doesNotMatch(pageSource, /function propTypeLabel\(/)
  assert.doesNotMatch(pageSource, /from '@\/utils\/userFacingError'/)
  assert.match(pageSource, /createDramaDetailProductionEditors\(/)
  assert.match(pageSource, /createDramaDetailResourceEditorLeave\(/)
  assert.match(pageSource, /openEditDramaChar,/)
  assert.match(pageSource, /saveDramaChar,/)
  assert.match(pageSource, /createDramaDetailResourceLists\(/)
  assert.match(pageSource, /openEditChar,/)
  assert.match(pageSource, /saveChar,/)
  assert.match(pageSource, /openEditDramaScene,/)
  assert.match(pageSource, /saveDramaScene,/)
  assert.match(pageSource, /openEditScene,/)
  assert.match(pageSource, /saveScene,/)
  assert.match(pageSource, /openEditDramaProp,/)
  assert.match(pageSource, /saveDramaProp,/)
  assert.match(pageSource, /openEditProp,/)
  assert.match(pageSource, /saveProp,/)
  assert.match(listsSource, /function openEditChar\(/)
  assert.match(listsSource, /async function saveChar\(/)
  assert.match(listsSource, /function openEditScene\(/)
  assert.match(listsSource, /async function saveScene\(/)
  assert.match(listsSource, /function openEditProp\(/)
  assert.match(listsSource, /async function saveProp\(/)
  assert.match(editorsSource, /function openEditDramaChar\(/)
  assert.match(editorsSource, /async function saveDramaChar\(/)
  assert.match(editorsSource, /function openEditDramaScene\(/)
  assert.match(editorsSource, /async function saveDramaScene\(/)
  assert.match(editorsSource, /function openEditDramaProp\(/)
  assert.match(editorsSource, /async function saveDramaProp\(/)
  assert.match(leaveSource, /export function snapshotResourceEdit\(/)
  assert.match(leaveSource, /export function createDramaDetailResourceEditorLeave\(/)
  assert.doesNotMatch(pageSource, /useDramaDetailResourceEdit/)
  assert.doesNotMatch(editorsSource, /useDramaDetailResourceEdit/)
  assert.doesNotMatch(leaveSource, /useDramaDetailResourceEdit/)
  assert.doesNotMatch(listsSource, /useDramaDetailResourceEdit/)
  assert.doesNotMatch(helperSource, /from 'vue'/)
  assert.doesNotMatch(helperSource, /\b(?:ref|reactive|computed)\s*\(/)
  assert.match(helperSource, /export function hasChinese\(/)
  assert.match(helperSource, /export function dramaDetailUserError\(/)
  assert.match(helperSource, /export function characterRoleLabel\(/)
  assert.match(helperSource, /export function propTypeLabel\(/)
})
