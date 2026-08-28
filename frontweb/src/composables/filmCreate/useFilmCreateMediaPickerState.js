import { ref } from 'vue'

/** 素材中心选择器目标，不把 dramaId 当成 picker target */
export function useFilmCreateMediaPickerState() {
  const showGlobalMediaPicker = ref(false)
  const globalMediaPickerMode = ref('reference')
  const globalMediaPickerTarget = ref(null)

  return {
    showGlobalMediaPicker,
    globalMediaPickerMode,
    globalMediaPickerTarget,
  }
}
