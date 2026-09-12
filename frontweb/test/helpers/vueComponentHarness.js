/**
 * 把 Vue SFC 编译成可挂载模块，并提供轻量宿主渲染器，供组件测试覆盖真实入口和失败态。
 */
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h } from 'vue'

export const vueUrl = import.meta.resolve('vue')

export function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

function rewriteImports(source, replacements) {
  let compiledSource = source
    .replaceAll("from 'vue'", `from ${JSON.stringify(vueUrl)}`)
    .replaceAll('from "vue"', `from ${JSON.stringify(vueUrl)}`)
  for (const [specifier, resolved] of replacements) {
    const target = `from ${JSON.stringify(resolved)}`
    compiledSource = compiledSource
      .replaceAll(`from '${specifier}'`, target)
      .replaceAll(`from "${specifier}"`, target)
  }
  return compiledSource
}

export function compileSfc(componentUrl, id, replacements = new Map()) {
  const source = readFileSync(componentUrl, 'utf8')
  const parsed = parse(source, { filename: componentUrl.pathname || String(componentUrl) })
  if (parsed.errors?.length) {
    const details = parsed.errors.map((error) => String(error)).join('\n')
    throw new Error(`编译 ${componentUrl} 失败：${details}`)
  }
  const compiledSource = compileScript(parsed.descriptor, { id, inlineTemplate: true }).content
  return dataModule(rewriteImports(compiledSource, replacements))
}

export async function loadCompiledSfc(componentUrl, id, replacements = new Map()) {
  return (await import(compileSfc(componentUrl, id, replacements))).default
}

export function compileIconStub(names) {
  const exports = names.map((name) => (
    `export const ${name} = icon(${JSON.stringify(name)})`
  )).join('\n')
  return dataModule(`
    import { defineComponent, h } from ${JSON.stringify(vueUrl)}
    const icon = (name) => defineComponent({
      name,
      setup() { return () => h('span', { 'data-icon': name }) },
    })
    ${exports}
  `)
}

export function createHostNode(type, text = '') {
  return {
    type,
    text,
    props: {},
    style: {},
    children: [],
    parent: null,
    focus() {},
    blur() {},
  }
}

function insertHostNode(child, parent, anchor = null) {
  if (child.parent) {
    const currentIndex = child.parent.children.indexOf(child)
    if (currentIndex >= 0) child.parent.children.splice(currentIndex, 1)
  }
  child.parent = parent
  const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1
  if (anchorIndex >= 0) parent.children.splice(anchorIndex, 0, child)
  else parent.children.push(child)
}

export function createHostRenderer() {
  return createRenderer({
    patchProp(element, key, _previous, next) {
      if (key === 'class') element.props.class = next
      else if (key === 'style' && next && typeof next === 'object') Object.assign(element.style, next)
      else element.props[key] = next
    },
    insert: insertHostNode,
    remove(child) {
      if (!child.parent) return
      const index = child.parent.children.indexOf(child)
      if (index >= 0) child.parent.children.splice(index, 1)
      child.parent = null
    },
    createElement(type) {
      return createHostNode(type)
    },
    createText(text) {
      return createHostNode('#text', text)
    },
    createComment(text) {
      return createHostNode('#comment', text)
    },
    setText(node, text) {
      node.text = text
    },
    setElementText(node, text) {
      const child = createHostNode('#text', text)
      child.parent = node
      node.children = [child]
    },
    parentNode(node) {
      return node.parent
    },
    nextSibling(node) {
      if (!node.parent) return null
      return node.parent.children[node.parent.children.indexOf(node) + 1] || null
    },
    querySelector() {
      return null
    },
    setScopeId(element, id) {
      if (!element.scopeIds) element.scopeIds = []
      element.scopeIds.push(id)
    },
    cloneNode(node) {
      return { ...node, props: { ...node.props }, style: { ...node.style }, children: [...node.children] }
    },
    insertStaticContent(content, parent, anchor) {
      const node = createHostNode('#static', content)
      insertHostNode(node, parent, anchor)
      return [node, node]
    },
  })
}

export function findAll(node, predicate, matches = []) {
  if (!node) return matches
  if (predicate(node)) matches.push(node)
  for (const child of node.children || []) findAll(child, predicate, matches)
  return matches
}

export function findByType(root, type) {
  return findAll(root, (node) => node.type === type)
}

export function textContent(node) {
  if (!node) return ''
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`
}

export function hasClass(node, className) {
  const value = node?.props?.class
  if (typeof value === 'string') return value.split(/\s+/).includes(className)
  if (Array.isArray(value)) return value.some((entry) => hasClass({ props: { class: entry } }, className))
  if (value && typeof value === 'object') return Boolean(value[className])
  return false
}

export function findByTestId(root, testId) {
  return findAll(root, (node) => node.props?.['data-testid'] === testId)
}

export function findByClass(root, className) {
  return findAll(root, (node) => hasClass(node, className))
}

export function buttonByText(root, label) {
  return findByType(root, 'button').find((node) => textContent(node).replace(/\s+/g, ' ').trim() === label)
}

export function buttonByAriaLabel(root, label) {
  return findByType(root, 'button').find((node) => node.props?.['aria-label'] === label)
}

export function click(node, extra = {}) {
  node.props.onClick?.({
    stopPropagation() {},
    preventDefault() {},
    ...extra,
  })
}

export function actionGateReasons(root) {
  return findByTestId(root, 'action-gate-reason').map((node) => textContent(node).trim())
}

function callListener(listener, value) {
  if (Array.isArray(listener)) {
    for (const entry of listener) entry(value)
    return
  }
  listener?.(value)
}

export function createElementPlusStubs() {
  const ElButtonStub = defineComponent({
    name: 'ElButtonStub',
    inheritAttrs: false,
    props: ['disabled', 'loading', 'nativeType', 'plain', 'size', 'type', 'link', 'title', 'circle'],
    setup(props, { attrs, slots }) {
      return () => h('button', {
        ...attrs,
        type: props.nativeType || 'button',
        disabled: Boolean(props.disabled),
        title: props.title ?? attrs.title,
        'aria-label': attrs['aria-label'],
        'aria-busy': attrs['aria-busy'],
        'data-loading': Boolean(props.loading),
        'data-variant': props.type || '',
        'data-link': Boolean(props.link),
      }, slots.default?.())
    },
  })

  const ElTooltipStub = defineComponent({
    name: 'ElTooltipStub',
    props: ['content', 'placement', 'visible'],
    setup(props, { slots }) {
      return () => h('tooltip', { 'data-content': props.content, visible: props.visible }, slots.default?.())
    },
  })

  const ElPopoverStub = defineComponent({
    name: 'ElPopoverStub',
    setup(_props, { slots }) {
      return () => h('popover', {}, [
        h('reference-slot', {}, slots.reference?.()),
        h('content-slot', {}, slots.default?.()),
      ])
    },
  })

  const ElIconStub = defineComponent({
    name: 'ElIconStub',
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h('span', { ...attrs, 'data-element-icon': 'true' }, slots.default?.())
    },
  })

  const ElSelectStub = defineComponent({
    name: 'ElSelectStub',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup(props, { attrs, emit, slots }) {
      return () => h('select', {
        ...attrs,
        value: props.modelValue,
        onChange: (event) => {
          const value = typeof props.modelValue === 'number'
            ? Number(event.target.value)
            : event.target.value
          emit('update:modelValue', value)
        },
      }, slots.default?.())
    },
  })

  const ElOptionStub = defineComponent({
    name: 'ElOptionStub',
    props: ['label', 'value'],
    setup(props) {
      return () => h('option', { value: props.value }, props.label)
    },
  })

  const ElTagStub = defineComponent({
    name: 'ElTagStub',
    props: ['type', 'size', 'effect'],
    setup(props, { slots }) {
      return () => h('span', { 'data-el-tag': props.type || '' }, slots.default?.())
    },
  })

  const ElInputStub = defineComponent({
    name: 'ElInputStub',
    props: ['modelValue', 'clearable', 'placeholder'],
    emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => h('input', {
        ...attrs,
        value: props.modelValue ?? '',
        placeholder: props.placeholder,
        onInput: (event) => {
          const value = event?.target?.value ?? event
          emit('update:modelValue', value)
          callListener(attrs.onInput, value)
        },
      })
    },
  })

  const ElRadioGroupStub = defineComponent({
    name: 'ElRadioGroupStub',
    props: ['modelValue', 'size'],
    emits: ['update:modelValue'],
    setup(props, { attrs, emit, slots }) {
      return () => h('radio-group', {
        ...attrs,
        value: props.modelValue,
        onSelect: (value) => {
          emit('update:modelValue', value)
          callListener(attrs.onChange, value)
        },
      }, slots.default?.())
    },
  })

  const ElRadioButtonStub = defineComponent({
    name: 'ElRadioButtonStub',
    props: ['value'],
    setup(props, { slots }) {
      return () => h('radio-button', { value: props.value }, slots.default?.())
    },
  })

  const ElPaginationStub = defineComponent({
    name: 'ElPaginationStub',
    props: ['currentPage', 'pageSize', 'total', 'layout'],
    setup(props, { attrs }) {
      return () => h('pagination', {
        ...attrs,
        currentPage: props.currentPage,
        pageSize: props.pageSize,
        total: props.total,
        onSelectPage: (value) => {
          callListener(attrs['onUpdate:currentPage'], value)
          callListener(attrs.onCurrentChange, value)
        },
      })
    },
  })

  const ElProgressStub = defineComponent({
    name: 'ElProgressStub',
    props: ['percentage', 'status'],
    setup(props) {
      return () => h('progress-bar', { percentage: props.percentage, status: props.status })
    },
  })

  const ElAlertStub = defineComponent({
    name: 'ElAlertStub',
    props: ['type', 'title', 'showIcon'],
    setup(props) {
      return () => h('alert', { 'data-type': props.type || '', role: props.type === 'error' ? 'alert' : 'status' }, props.title || '')
    },
  })

  const ElDropdownStub = defineComponent({
    name: 'ElDropdownStub',
    props: ['disabled', 'trigger'],
    emits: ['command'],
    setup(props, { emit, slots }) {
      return () => h('dropdown', { disabled: Boolean(props.disabled) }, [
        h('dropdown-trigger', {}, slots.default?.()),
        h('dropdown-items', {
          onCommand: (command) => emit('command', command),
        }, slots.dropdown?.()),
      ])
    },
  })

  const ElDropdownMenuStub = defineComponent({
    name: 'ElDropdownMenuStub',
    setup(_props, { slots }) {
      return () => h('dropdown-menu', {}, slots.default?.())
    },
  })

  const ElDropdownItemStub = defineComponent({
    name: 'ElDropdownItemStub',
    props: ['command'],
    setup(props, { slots }) {
      return () => h('button', {
        type: 'button',
        'data-command': props.command,
        onClick: () => {},
      }, slots.default?.())
    },
  })

  const ElCheckboxStub = defineComponent({
    name: 'ElCheckboxStub',
    props: ['modelValue', 'label', 'disabled'],
    setup(props, { attrs, slots }) {
      return () => h('checkbox', {
        ...attrs,
        checked: Boolean(props.modelValue),
        disabled: Boolean(props.disabled),
      }, slots.default?.() || props.label)
    },
  })

  const ElInputNumberStub = defineComponent({
    name: 'ElInputNumberStub',
    props: ['modelValue', 'min', 'max', 'step', 'disabled', 'placeholder'],
    setup(props, { attrs }) {
      return () => h('input', {
        ...attrs,
        type: 'number',
        value: props.modelValue ?? '',
        min: props.min,
        max: props.max,
        step: props.step,
        disabled: Boolean(props.disabled),
        placeholder: props.placeholder,
      })
    },
  })

  return {
    ElButtonStub,
    ElTooltipStub,
    ElPopoverStub,
    ElIconStub,
    ElSelectStub,
    ElOptionStub,
    ElTagStub,
    ElInputStub,
    ElRadioGroupStub,
    ElRadioButtonStub,
    ElPaginationStub,
    ElProgressStub,
    ElAlertStub,
    ElDropdownStub,
    ElDropdownMenuStub,
    ElDropdownItemStub,
    ElCheckboxStub,
    ElInputNumberStub,
  }
}

export function registerElementStubs(app, extra = {}) {
  const stubs = createElementPlusStubs()
  const mapping = {
    'el-button': stubs.ElButtonStub,
    ElButton: stubs.ElButtonStub,
    'el-tooltip': stubs.ElTooltipStub,
    ElTooltip: stubs.ElTooltipStub,
    'el-popover': stubs.ElPopoverStub,
    ElPopover: stubs.ElPopoverStub,
    'el-icon': stubs.ElIconStub,
    ElIcon: stubs.ElIconStub,
    'el-select': stubs.ElSelectStub,
    ElSelect: stubs.ElSelectStub,
    'el-option': stubs.ElOptionStub,
    ElOption: stubs.ElOptionStub,
    'el-tag': stubs.ElTagStub,
    ElTag: stubs.ElTagStub,
    'el-input': stubs.ElInputStub,
    ElInput: stubs.ElInputStub,
    'el-radio-group': stubs.ElRadioGroupStub,
    ElRadioGroup: stubs.ElRadioGroupStub,
    'el-radio-button': stubs.ElRadioButtonStub,
    ElRadioButton: stubs.ElRadioButtonStub,
    'el-pagination': stubs.ElPaginationStub,
    ElPagination: stubs.ElPaginationStub,
    'el-progress': stubs.ElProgressStub,
    ElProgress: stubs.ElProgressStub,
    'el-alert': stubs.ElAlertStub,
    ElAlert: stubs.ElAlertStub,
    'el-dropdown': stubs.ElDropdownStub,
    ElDropdown: stubs.ElDropdownStub,
    'el-dropdown-menu': stubs.ElDropdownMenuStub,
    ElDropdownMenu: stubs.ElDropdownMenuStub,
    'el-dropdown-item': stubs.ElDropdownItemStub,
    ElDropdownItem: stubs.ElDropdownItemStub,
    'el-checkbox': stubs.ElCheckboxStub,
    ElCheckbox: stubs.ElCheckboxStub,
    'el-input-number': stubs.ElInputNumberStub,
    ElInputNumber: stubs.ElInputNumberStub,
    ...extra,
  }
  for (const [name, component] of Object.entries(mapping)) {
    app.component(name, component)
  }
  app.directive('loading', {})
  return stubs
}

export function mountHarness(renderer, render, options = {}) {
  const root = createHostNode('root')
  const Harness = defineComponent({
    setup() {
      return render
    },
  })
  const app = renderer.createApp(Harness)
  registerElementStubs(app, options.components)
  if (options.provide) {
    for (const [key, value] of Object.entries(options.provide)) app.provide(key, value)
  }
  app.mount(root)
  return { app, root }
}

export function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export function flushUi(nextTick) {
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => nextTick())
}