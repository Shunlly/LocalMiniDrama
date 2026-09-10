import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { ElMessage } from 'element-plus'
import { useFilmCreateStoryboardCrud } from '../src/composables/filmCreate/useFilmCreateStoryboardCrud.js'
import {
  applyStoryboardMove,
  encodeStoryboardReorderIndex,
  parseStoryboardReorderIndex,
  runStoryboardReorder,
  snapshotStoryboardOrder,
  storyboardMoveButtonCopy,
  storyboardMoveDisabledReason,
  toStoryboardReorderUserError,
  useFilmCreateStoryboardReorder,
} from '../src/composables/filmCreate/useFilmCreateStoryboardReorder.js'

const panelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url), 'utf8')
const crudSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateStoryboardCrud.js', import.meta.url), 'utf8')
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

function board(id, number, title) {
  return { id, episode_id: 21, storyboard_number: number, title }
}

test('相邻分镜上移下移会改写 storyboard_number 并保持同一对象', () => {
  const a = board(11, 1, '开场')
  const b = board(12, 2, '对峙')
  const c = board(13, 3, '收束')
  const list = [a, b, c]
  assert.equal(applyStoryboardMove(list, 1, 0), true)
  assert.deepEqual(list.map((sb) => sb.id), [12, 11, 13])
  assert.equal(list[0], b)
  assert.equal(b.storyboard_number, 1)
  assert.equal(a.storyboard_number, 2)
  assert.equal(c.storyboard_number, 3)
  assert.equal(applyStoryboardMove(list, 0, 0), false)
  assert.equal(applyStoryboardMove(list, 0, 3), false)
})

test('拖拽序号编码只接受本面板前缀', () => {
  assert.equal(encodeStoryboardReorderIndex(2), 'lmd-storyboard-index:2')
  assert.equal(parseStoryboardReorderIndex('lmd-storyboard-index:2'), 2)
  assert.equal(parseStoryboardReorderIndex('lmd-storyboard-index:0'), 0)
  assert.equal(parseStoryboardReorderIndex('text/plain'), null)
  assert.equal(parseStoryboardReorderIndex('2'), null)
})

test('排序保存走已有 update API，失败时回滚列表和镜号', async () => {
  const a = board(11, 1, '开场')
  const b = board(12, 2, '对峙')
  const list = [a, b]
  const updates = []
  await runStoryboardReorder({
    list,
    fromIndex: 0,
    toIndex: 1,
    storyboardsAPI: {
      async update(id, payload) {
        updates.push({ id, payload })
      },
    },
  })
  assert.deepEqual(list.map((sb) => sb.id), [12, 11])
  assert.equal(a.storyboard_number, 2)
  assert.equal(b.storyboard_number, 1)
  assert.deepEqual(updates, [
    { id: 12, payload: { storyboard_number: 1 } },
    { id: 11, payload: { storyboard_number: 2 } },
  ])

  const failed = []
  const restored = []
  await assert.rejects(
    () => runStoryboardReorder({
      list,
      fromIndex: 0,
      toIndex: 1,
      storyboardsAPI: {
        async update(id, payload) {
          failed.push({ id, payload })
          throw new Error('The storyboard could not be claimed')
        },
      },
    }),
    /could not be claimed/,
  )
  assert.deepEqual(list.map((sb) => [sb.id, sb.storyboard_number]), [[12, 1], [11, 2]])
  assert.ok(failed.length >= 1)
  restored.push(snapshotStoryboardOrder(list).map((item) => item.ref.id))
  assert.deepEqual(restored[0], [12, 11])
})

test('CRUD 上移下移复用插入删除同款 update 保存，失败中文提示并回滚', async () => {
  const a = board(11, 1, '开场')
  const b = board(12, 2, '对峙')
  const store = { storyboards: [a, b] }
  const updates = []
  const originalError = ElMessage.error
  const errors = []
  ElMessage.error = (message) => { errors.push(message) }
  try {
    const crud = useFilmCreateStoryboardCrud({
      currentEpisodeId: { value: 21 },
      dramaId: { value: 7 },
      store,
      storyboardsAPI: {
        async update(id, payload) {
          updates.push({ id, payload })
        },
      },
      loadDrama: async () => {
        throw new Error('排序不应整剧刷新')
      },
    })
    await crud.onMoveStoryboardDown(a, 0)
    assert.deepEqual(store.storyboards.map((sb) => sb.id), [12, 11])
    assert.equal(a.storyboard_number, 2)
    assert.equal(errors.length, 0)

    const failing = useFilmCreateStoryboardCrud({
      currentEpisodeId: { value: 21 },
      dramaId: { value: 7 },
      store,
      storyboardsAPI: {
        async update() {
          throw new Error('Network Error')
        },
      },
      loadDrama: async () => {},
    })
    await assert.doesNotReject(() => failing.onMoveStoryboardUp(a, 1))
    assert.deepEqual(store.storyboards.map((sb) => [sb.id, sb.storyboard_number]), [[12, 1], [11, 2]])
    assert.match(String(errors.at(-1)), /调整分镜顺序失败/)
  } finally {
    ElMessage.error = originalError
  }
})

test('分镜面板行头接线不依赖制作页绑定袋', () => {
  assert.match(panelSource, /useFilmCreateStoryboardReorder/)
  assert.match(panelSource, /onMoveStoryboardUp/)
  assert.match(panelSource, /onMoveStoryboardDown/)
  assert.match(panelSource, /onReorderDragStart/)
  assert.match(crudSource, /useFilmCreateStoryboardReorder/)
  assert.match(crudSource, /onMoveStoryboardUp/)
  assert.doesNotMatch(panelSource, /onMoveStoryboard:\s*\{\s*type:\s*Function,\s*required:\s*true/)
  assert.match(panelSource, /getStoryboardsAPI:\s*\(\)\s*=>\s*props\.storyboardsAPI/)
  assert.match(filmCreateSource, /storyboardPanel: \{[\s\S]*storyboardsAPI/)
})

test('面板排序在保存时才读取 API，不在 setup 时钉死', async () => {
  const a = board(11, 1, '开场')
  const b = board(12, 2, '对峙')
  const list = [a, b]
  const updates = []
  let current = {
    async update() {
      throw new Error('旧 API 不应被调用')
    },
  }
  const { onMoveStoryboardDown } = useFilmCreateStoryboardReorder({
    getList: () => list,
    getStoryboardsAPI: () => current,
  })
  current = {
    async update(id, payload) {
      updates.push({ id, payload })
    },
  }
  assert.equal(await onMoveStoryboardDown(a, 0), true)
  assert.deepEqual(list.map((sb) => sb.id), [12, 11])
  assert.deepEqual(updates, [
    { id: 12, payload: { storyboard_number: 1 } },
    { id: 11, payload: { storyboard_number: 2 } },
  ])
})

test('分镜面板排序改动后仍可编译', () => {
  const parsed = parse(panelSource, { filename: 'FilmCreateStoryboardPanel.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'storyboard-reorder-panel' }))
})

test('首末镜和忙碌时给出中文禁用原因', () => {
  assert.equal(storyboardMoveDisabledReason({ index: 0, length: 3, offset: -1 }), '已经是第一条分镜')
  assert.equal(storyboardMoveDisabledReason({ index: 2, length: 3, offset: 1 }), '已经是最后一条分镜')
  assert.equal(storyboardMoveDisabledReason({ index: 0, length: 1, offset: 1 }), '至少两条分镜才能调整顺序')
  assert.equal(storyboardMoveDisabledReason({ index: 1, length: 3, offset: -1, generating: true }), '正在生成分镜，请等待完成')
  assert.equal(storyboardMoveDisabledReason({ index: 1, length: 3, offset: 1, polishing: true }), '正在润色全能分镜提示词，请等待完成')
  assert.equal(storyboardMoveDisabledReason({ index: 1, length: 3, offset: -1, busy: true }), '正在调整分镜顺序')
  assert.equal(storyboardMoveDisabledReason({ index: 1, length: 3, offset: -1 }), '')
  assert.match(panelSource, /moveStoryboardUpReason\(index\)/)
  assert.match(panelSource, /storyboardMoveCopies/)
})

test('首末镜按钮文案同时带上移下移和中文原因', () => {
  const firstUp = storyboardMoveButtonCopy({
    actionLabel: '上移',
    index: 0,
    reason: storyboardMoveDisabledReason({ index: 0, length: 3, offset: -1 }),
  })
  const lastDown = storyboardMoveButtonCopy({
    actionLabel: '下移',
    index: 2,
    reason: storyboardMoveDisabledReason({ index: 2, length: 3, offset: 1 }),
  })
  const midUp = storyboardMoveButtonCopy({
    actionLabel: '上移',
    index: 1,
    reason: storyboardMoveDisabledReason({ index: 1, length: 3, offset: -1 }),
  })
  assert.equal(firstUp.disabled, true)
  assert.equal(firstUp.title, '上移不可用：已经是第一条分镜')
  assert.equal(firstUp.ariaLabel, '上移分镜1不可用：已经是第一条分镜')
  assert.notEqual(firstUp.title, '上移')
  assert.notEqual(firstUp.ariaLabel, '上移')
  assert.equal(lastDown.disabled, true)
  assert.equal(lastDown.title, '下移不可用：已经是最后一条分镜')
  assert.equal(lastDown.ariaLabel, '下移分镜3不可用：已经是最后一条分镜')
  assert.equal(midUp.disabled, false)
  assert.equal(midUp.title, '上移')
  assert.equal(midUp.ariaLabel, '上移分镜2')
})

test('拖拽保存失败把英文异常收成中文', async () => {
  assert.equal(toStoryboardReorderUserError(new Error('The storyboard could not be claimed')), '调整分镜顺序失败')
  assert.equal(toStoryboardReorderUserError(new Error('Network Error')), '调整分镜顺序失败')
  assert.equal(
    toStoryboardReorderUserError({ response: { data: { error: { message: 'The storyboard could not be claimed' } } } }),
    '调整分镜顺序失败',
  )
  assert.equal(toStoryboardReorderUserError(new Error('无法保存分镜顺序，请稍后重试')), '无法保存分镜顺序，请稍后重试')

  const a = board(11, 1, '开场')
  const b = board(12, 2, '对峙')
  const list = [a, b]
  const originalError = ElMessage.error
  const errors = []
  ElMessage.error = (message) => { errors.push(message) }
  try {
    const { onReorderDrop } = useFilmCreateStoryboardReorder({
      getList: () => list,
      getStoryboardsAPI: () => ({
        async update() {
          throw new Error('The storyboard could not be claimed')
        },
      }),
    })
    await onReorderDrop({
      preventDefault() {},
      dataTransfer: {
        files: [],
        getData: () => encodeStoryboardReorderIndex(0),
      },
    }, 1)
    assert.deepEqual(list.map((sb) => [sb.id, sb.storyboard_number]), [[11, 1], [12, 2]])
    assert.equal(errors.at(-1), '调整分镜顺序失败')
    assert.doesNotMatch(String(errors.at(-1)), /could not be claimed|Network Error/)
  } finally {
    ElMessage.error = originalError
  }
})

test('编译后的上移下移是原生按钮，title 和 aria 绑到按钮上', () => {
  const parsed = parse(panelSource, { filename: 'FilmCreateStoryboardPanel.vue' })
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename: 'FilmCreateStoryboardPanel.vue',
    id: 'storyboard-reorder-native-buttons',
  })
  assert.deepEqual(compiled.errors, [])
  assert.match(compiled.code, /_createElementVNode\("button"[\s\S]{0,800}storyboardMoveCopies/)
  assert.match(compiled.code, /title:\s*[^\n]*storyboardMoveCopies/)
  assert.match(compiled.code, /"aria-label":\s*[^\n]*storyboardMoveCopies/)
  assert.match(panelSource, /class="sb-ctrl-reorder-wrap"/)
  assert.match(panelSource, /:title="storyboardMoveCopies\[i\]\.up\.title"/)
  assert.match(panelSource, /:aria-label="storyboardMoveCopies\[i\]\.up\.ariaLabel"/)
  assert.match(panelSource, /:title="storyboardMoveCopies\[i\]\.down\.title"/)
  assert.match(panelSource, /:aria-label="storyboardMoveCopies\[i\]\.down\.ariaLabel"/)
  assert.doesNotMatch(panelSource, /<el-button[\s\S]{0,180}sb-ctrl-reorder-btn/)
})
