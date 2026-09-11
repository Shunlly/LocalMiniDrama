<template>
  <div class="film-list-library-dialogs">
    <FilmListCharLibraryDialogs
      v-model="showCharLibrary"
      :list-write-locked="listWriteLocked"
      :list-write-lock-reason="listWriteLockReason"
      @preview="openImagePreview"
    />
    <FilmListSceneLibraryDialogs
      v-model="showSceneLibrary"
      :list-write-locked="listWriteLocked"
      :list-write-lock-reason="listWriteLockReason"
      @preview="openImagePreview"
    />
    <FilmListPropLibraryDialogs
      v-model="showPropLibrary"
      :list-write-locked="listWriteLocked"
      :list-write-lock-reason="listWriteLockReason"
      @preview="openImagePreview"
    />
    <ImagePreviewDialog
      v-model="showImagePreview"
      :src="previewImage.src"
      :alt="previewImage.alt"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import FilmListCharLibraryDialogs from './FilmListCharLibraryDialogs.vue'
import FilmListSceneLibraryDialogs from './FilmListSceneLibraryDialogs.vue'
import FilmListPropLibraryDialogs from './FilmListPropLibraryDialogs.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  listWriteLocked: { type: Boolean, default: false },
  listWriteLockReason: { type: String, default: '' },
})

const showCharLibrary = defineModel('showCharLibrary', { type: Boolean, default: false })
const showSceneLibrary = defineModel('showSceneLibrary', { type: Boolean, default: false })
const showPropLibrary = defineModel('showPropLibrary', { type: Boolean, default: false })

const showImagePreview = ref(false)
const previewImage = ref({ src: '', alt: '图片预览' })
function openImagePreview(url, alt = '图片预览') {
  const src = String(url || '').trim()
  if (!src) return
  previewImage.value = { src, alt }
  showImagePreview.value = true
}
</script>
