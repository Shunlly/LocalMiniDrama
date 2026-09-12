/**
 * 组件测试用的 AccessibleDialog 替身，以及表单/警告的轻量覆盖。
 */
import { defineComponent, h, watch } from 'vue'

export const AccessibleDialogStub = defineComponent({
  name: 'AccessibleDialog',
  inheritAttrs: false,
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: '' },
    width: { type: [String, Number], default: '' },
    beforeClose: { type: Function, default: undefined },
    destroyOnClose: { type: Boolean, default: false },
    closeOnClickModal: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'closed', 'close'],
  setup(props, { emit, slots, attrs }) {
    watch(() => props.modelValue, (visible, previousVisible) => {
      if (previousVisible && !visible) {
        emit('close')
        emit('closed')
      }
    })
    return () => {
      if (!props.modelValue) return null
      return h('dialog', {
        ...attrs,
        'data-title': props.title || attrs['aria-label'] || '',
        role: 'dialog',
      }, [
        slots.header?.({ titleId: 'dialog-title', titleClass: 'dialog-title' })
          || h('strong', { id: 'dialog-title' }, props.title || ''),
        h('dialog-body', {}, slots.default?.()),
        h('dialog-footer', {}, slots.footer?.()),
      ])
    }
  },
})

export function createFormStubs() {
  const ElFormStub = defineComponent({
    name: 'ElFormStub',
    setup(_props, { slots, attrs }) {
      return () => h('form', { ...attrs }, slots.default?.())
    },
  })
  const ElFormItemStub = defineComponent({
    name: 'ElFormItemStub',
    props: ['label'],
    setup(props, { slots }) {
      return () => h('div', { 'data-el': 'el-form-item' }, [
        props.label ? h('span', props.label) : null,
        slots.default?.(),
      ])
    },
  })
  return {
    ElForm: ElFormStub,
    'el-form': ElFormStub,
    ElFormItem: ElFormItemStub,
    'el-form-item': ElFormItemStub,
  }
}

export function createAlertStubWithDescription() {
  const ElAlertStub = defineComponent({
    name: 'ElAlertStub',
    props: ['type', 'title', 'description', 'showIcon', 'closable'],
    setup(props) {
      return () => h('alert', {
        'data-type': props.type || '',
        role: props.type === 'error' ? 'alert' : 'status',
      }, [
        props.title || '',
        props.description ? h('p', {}, props.description) : null,
      ])
    },
  })
  return {
    ElAlert: ElAlertStub,
    'el-alert': ElAlertStub,
  }
}
