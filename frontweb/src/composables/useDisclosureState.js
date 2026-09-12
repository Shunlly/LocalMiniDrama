import { ref, watch } from 'vue'

export function useDisclosureState({ defaultExpanded = false, forceExpanded } = {}) {
  const expanded = ref(Boolean(defaultExpanded))

  function toggle() {
    expanded.value = !expanded.value
  }

  function setExpanded(value) {
    expanded.value = Boolean(value)
  }

  if (forceExpanded) {
    watch(forceExpanded, (value) => {
      if (value) expanded.value = true
    }, { immediate: true })
  }

  return { expanded, toggle, setExpanded }
}
