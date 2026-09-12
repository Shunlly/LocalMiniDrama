import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
} from './helpers/vueComponentHarness.js'

const panelDir = new URL('../src/components/dramaCanvas/', import.meta.url)
const iconStubUrl = compileIconStub(['MagicStick', 'Refresh'])
const compiledActionGateUrl = compileSfc(
  new URL('./CanvasActionGate.vue', panelDir),
  'storyboard-panel-actions-gate',
)
const Actions = await loadCompiledSfc(
  new URL('./CanvasStoryboardPanelActions.vue', panelDir),
  'storyboard-panel-actions-menu',
  new Map([
    ['@element-plus/icons-vue', iconStubUrl],
    ['./CanvasActionGate.vue', compiledActionGateUrl],
  ]),
)

const renderer = createHostRenderer()

const ElDropdownItemStub = defineComponent({
  name: 'ElDropdownItemStub',
  inheritAttrs: false,
  props: {
    command: { default: undefined },
    disabled: { type: Boolean, default: false },
    title: { type: String, default: '' },
  },
  setup(props, { attrs, slots }) {
    return () => h('button', {
      type: 'button',
      disabled: Boolean(props.disabled),
      title: props.title || undefined,
      'aria-label': attrs['aria-label'],
      'data-command': props.command,
      onClick: (event) => {
        if (props.disabled) return
        const handler = attrs.onClick
        if (Array.isArray(handler)) {
          for (const fn of handler) fn?.(event)
          return
        }
        handler?.(event)
      },
    }, slots.default?.())
  },
})

function mountActions(props) {
  return mountHarness(renderer, () => h(Actions, props), {
    components: {
      'el-dropdown-item': ElDropdownItemStub,
      ElDropdownItem: ElDropdownItemStub,
    },
  })
}

function requiredActionProps(overrides = {}) {
  return {
    saving: false,
    busyStep: '',
    isUniversal: false,
    useFirstLast: false,
    universalSegmentText: '',
    videoAction: { reason: '', serviceType: 'video' },
    ttsAction: { reason: '', serviceType: 'tts' },
    videoReasonId: 'video-reason-actions',
    ttsReasonId: 'tts-reason-actions',
    audioActionDisabledReason: '',
    narrationActionDisabledReason: '',
    ttsNarrationReasonId: 'tts-narration-reason-actions',
    saveFields: () => {},
    polishPrompt: () => {},
    runUniversalPrompt: () => {},
    runStep: () => {},
    deleteStoryboard: () => {},
    canMoveUp: true,
    canMoveDown: true,
    reorderBusy: false,
    reorderDisabledReason: '',
    moveStoryboardUp: () => {},
    moveStoryboardDown: () => {},
    insertStoryboardBefore: () => {},
    insertStoryboardAfter: () => {},
    appendStoryboard: () => {},
    ...overrides,
  }
}

async function openStructureMenu(root) {
  const trigger = buttonByText(root, '分镜结构')
  assert.ok(trigger)
  assert.equal(trigger.props['aria-label'], '分镜结构：上移、下移、前插、后插、追加')
  click(trigger)
  await nextTick()
  return trigger
}

test('默认只露出分镜结构，生成类按钮仍在原位', () => {
  const harness = mountActions(requiredActionProps())
  try {
    const text = textContent(harness.root)
    assert.match(text, /分镜结构/)
    assert.ok(buttonByText(harness.root, '保存'))
    assert.ok(buttonByText(harness.root, '润色'))
    assert.ok(buttonByText(harness.root, '生图'))
    assert.ok(buttonByText(harness.root, '生视频'))
    assert.ok(buttonByText(harness.root, '配音'))
    assert.ok(buttonByText(harness.root, '旁白'))
    assert.ok(buttonByText(harness.root, '删除'))
    assert.ok(buttonByAriaLabel(harness.root, '分镜结构：上移、下移、前插、后插、追加'))
    assert.equal(buttonByText(harness.root, '上移'), undefined)
    assert.equal(buttonByText(harness.root, '下移'), undefined)
    assert.equal(buttonByText(harness.root, '前插'), undefined)
    assert.equal(buttonByText(harness.root, '后插'), undefined)
    assert.equal(buttonByText(harness.root, '追加'), undefined)
    assert.doesNotMatch(text, /取消生成/)
  } finally {
    harness.app.unmount()
  }
})

test('点击分镜结构后五项仍可点，且不把项目/剧集/分镜 id 互换', async () => {
  const events = []
  const projectId = 101
  const episodeId = 202
  const storyboardId = 303
  assert.notEqual(projectId, episodeId)
  assert.notEqual(episodeId, storyboardId)
  assert.notEqual(projectId, storyboardId)
  const harness = mountActions(requiredActionProps({
    moveStoryboardUp: () => events.push({ action: 'up', storyboardId }),
    moveStoryboardDown: () => events.push({ action: 'down', storyboardId }),
    insertStoryboardBefore: () => events.push({ action: 'before', storyboardId }),
    insertStoryboardAfter: () => events.push({ action: 'after', storyboardId }),
    appendStoryboard: () => events.push({ action: 'append', episodeId, projectId }),
  }))
  try {
    await openStructureMenu(harness.root)
    const opened = textContent(harness.root)
    assert.match(opened, /上移/)
    assert.match(opened, /下移/)
    assert.match(opened, /前插/)
    assert.match(opened, /后插/)
    assert.match(opened, /追加/)
    assert.ok(buttonByText(harness.root, '保存'))
    assert.ok(buttonByText(harness.root, '润色'))
    assert.ok(buttonByText(harness.root, '生图'))
    assert.ok(buttonByText(harness.root, '生视频'))
    assert.ok(buttonByText(harness.root, '配音'))
    assert.ok(buttonByText(harness.root, '旁白'))
    assert.ok(buttonByText(harness.root, '删除'))

    for (const label of ['上移', '下移', '前插', '后插', '追加']) {
      const item = buttonByText(harness.root, label)
      assert.ok(item)
      let stopped = false
      item.props.onClick({
        stopPropagation() {
          stopped = true
        },
      })
      assert.equal(stopped, true, `${label} 应 @click.stop`)
      await nextTick()
    }
    assert.deepEqual(events, [
      { action: 'up', storyboardId },
      { action: 'down', storyboardId },
      { action: 'before', storyboardId },
      { action: 'after', storyboardId },
      { action: 'append', episodeId, projectId },
    ])
    assert.notEqual(events[0].storyboardId, episodeId)
    assert.notEqual(events[0].storyboardId, projectId)
    assert.notEqual(events[4].episodeId, storyboardId)
    assert.notEqual(events[4].episodeId, projectId)
    assert.notEqual(events[4].projectId, storyboardId)
  } finally {
    harness.app.unmount()
  }
})

test('结构菜单保持原有禁用、loading 和中文 title', async () => {
  const first = mountActions(requiredActionProps({
    canMoveUp: false,
    canMoveDown: true,
  }))
  try {
    await openStructureMenu(first.root)
    const moveUp = buttonByText(first.root, '上移')
    const insertBefore = buttonByText(first.root, '前插')
    const insertAfter = buttonByText(first.root, '后插')
    const append = buttonByText(first.root, '追加')
    assert.equal(moveUp.props.disabled, true)
    assert.equal(moveUp.props.title, '上移不可用：已经是本集第一条分镜')
    assert.equal(moveUp.props['aria-label'], '上移不可用：已经是本集第一条分镜')
    assert.ok(String(moveUp.props['aria-label']).includes('上移'))
    assert.equal(insertBefore.props.title, '在此分镜前插入空白分镜')
    assert.equal(insertBefore.props['aria-label'], '在此分镜前插入空白分镜')
    assert.equal(insertAfter.props.title, '在此分镜后插入空白分镜')
    assert.equal(append.props.title, '在本集末尾追加空白分镜')
  } finally {
    first.app.unmount()
  }

  const last = mountActions(requiredActionProps({
    canMoveUp: true,
    canMoveDown: false,
  }))
  try {
    await openStructureMenu(last.root)
    const moveDown = buttonByText(last.root, '下移')
    assert.equal(moveDown.props.disabled, true)
    assert.equal(moveDown.props.title, '下移不可用：已经是本集最后一条分镜')
    assert.equal(moveDown.props['aria-label'], '下移不可用：已经是本集最后一条分镜')
    assert.ok(String(moveDown.props['aria-label']).includes('下移'))
  } finally {
    last.app.unmount()
  }

  const reason = '请先保存当前分镜修改，再调整顺序'
  const blocked = mountActions(requiredActionProps({
    canMoveUp: true,
    canMoveDown: true,
    reorderDisabledReason: reason,
  }))
  try {
    await openStructureMenu(blocked.root)
    for (const label of ['上移', '下移', '前插', '后插', '追加']) {
      const item = buttonByText(blocked.root, label)
      assert.equal(item.props.disabled, true)
      assert.equal(item.props.title, `${label}不可用：${reason}`)
      assert.equal(item.props['aria-label'], `${label}不可用：${reason}`)
      assert.ok(String(item.props['aria-label']).includes(label))
    }
  } finally {
    blocked.app.unmount()
  }

  const busy = mountActions(requiredActionProps({
    canMoveUp: true,
    canMoveDown: true,
    reorderBusy: true,
  }))
  try {
    const trigger = buttonByText(busy.root, '分镜结构')
    assert.equal(trigger.props['data-loading'], true)
    await openStructureMenu(busy.root)
    const moveUp = buttonByText(busy.root, '上移')
    assert.equal(moveUp.props.disabled, false)
    assert.equal(moveUp.props.title, '上移分镜')
  } finally {
    busy.app.unmount()
  }
})
