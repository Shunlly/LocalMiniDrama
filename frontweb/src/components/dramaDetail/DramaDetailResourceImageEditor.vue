<template>
  <el-form-item label="图片">
    <div class="lib-img-editor">
      <button v-if="imageUrl" type="button" class="lib-img-thumb" v-bind="previewThumbBindings" :aria-label="previewLabel" @click="emit('preview', imageUrl)">
        <img v-if="hasStoredImage" :src="imageUrl" :alt="imageAlt" />
        <span v-else class="lib-img-empty"><el-icon aria-hidden="true"><PictureFilled /></el-icon></span>
      </button>
      <button v-else type="button" v-bind="previewThumbBindings" class="lib-img-thumb lib-img-thumb--empty" :aria-label="previewLabel" @click="emit('preview', imageUrl)">
        <span class="lib-img-empty"><el-icon aria-hidden="true"><PictureFilled /></el-icon></span>
      </button>
      <div class="lib-img-btns">
        <el-tooltip :content="uploadDisabledReason" :disabled="!uploadDisabledReason" placement="top">
          <span
            class="tooltip-trigger"
            :tabindex="uploadDisabledReason ? 0 : undefined"
            :aria-label="uploadDisabledReason ? `上传图片不可用：${uploadDisabledReason}` : undefined"
            :aria-describedby="uploadDisabledReason ? uploadReasonId : undefined"
          >
            <p v-if="uploadDisabledReason" :id="uploadReasonId" class="visually-hidden">{{ uploadDisabledReason }}</p>
            <el-button
              size="small"
              :loading="Boolean(form?.imgUploading)"
              :disabled="Boolean(uploadDisabledReason)"
              :title="uploadDisabledReason || undefined"
              :aria-describedby="uploadDisabledReason ? uploadReasonId : undefined"
              :aria-label="form?.imgUploading ? '正在上传图片' : (uploadDisabledReason || '上传图片')"
              @click="pickFile"
            >上传图片</el-button>
          </span>
        </el-tooltip>
        <el-tooltip :content="generateDisabledReason" :disabled="!generateDisabledReason" placement="top">
          <span
            class="tooltip-trigger"
            :tabindex="generateDisabledReason ? 0 : undefined"
            :aria-label="generateDisabledReason ? `AI 生成图片不可用：${generateDisabledReason}` : undefined"
            :aria-describedby="generateDisabledReason ? generateReasonId : undefined"
          >
            <p v-if="generateDisabledReason" :id="generateReasonId" class="visually-hidden">{{ generateDisabledReason }}</p>
            <el-button
              size="small"
              type="primary"
              :loading="Boolean(form?.imgGenerating)"
              :disabled="Boolean(generateDisabledReason)"
              :title="generateDisabledReason || undefined"
              :aria-describedby="generateDisabledReason ? generateReasonId : undefined"
              :aria-label="form?.imgGenerating ? '正在生成图片' : (generateDisabledReason || 'AI 生成图片')"
              @click="emit('generate')"
            >AI 生成</el-button>
          </span>
        </el-tooltip>
      </div>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      style="display:none"
      @change="emit('upload', $event)"
    />
  </el-form-item>
</template>

<script setup>
import { computed, ref } from 'vue'
import { PictureFilled } from '@element-plus/icons-vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  form: { type: Object, default: null },
  previewLabel: { type: String, required: true },
  fallbackAlt: { type: String, required: true },
  altKey: { type: String, default: 'name' },
  assetImageUrl: { type: Function, required: true },
})

const emit = defineEmits(['preview', 'upload', 'generate'])
const fileInput = ref(null)

const imageUrl = computed(() => props.assetImageUrl(props.form) || '')
const hasStoredImage = computed(() => Boolean(props.form?.image_url || props.form?.local_path))
const imageAlt = computed(() => props.form?.[props.altKey] || props.fallbackAlt)
const previewTitle = computed(() => (imageUrl.value ? undefined : '暂无图片'))
// disabled 必须是布尔值：裸 disabled 会编成空字符串，有图时也不能缺省成 undefined。
const previewThumbBindings = computed(() => (
  imageUrl.value
    ? { disabled: false }
    : { disabled: true, title: previewTitle.value || '暂无图片' }
))
const uploadDisabledReason = computed(() => (props.form?.imgGenerating ? '正在生成图片，请稍候' : ''))
const generateDisabledReason = computed(() => (props.form?.imgUploading ? '正在上传图片，请稍候' : ''))
const uploadReasonId = computed(() => `resource-image-upload-reason-${props.form?.id || 'new'}`)
const generateReasonId = computed(() => `resource-image-generate-reason-${props.form?.id || 'new'}`)

function pickFile() {
  fileInput.value?.click?.()
}
</script>

<style scoped>
.lib-img-editor { display: flex; align-items: center; gap: 14px; }
.lib-img-thumb { width: 88px; height: 88px; padding: 0; border-radius: 8px; overflow: hidden; cursor: zoom-in; background: var(--bg-inner, #1c1c1e); color: inherit; font: inherit; border: 1px solid var(--border-color, #27272a); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.lib-img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.lib-img-empty { color: var(--text-faint, #52525b); font-size: 26px; }
.lib-img-btns { display: flex; flex-direction: column; gap: 8px; }
.lib-img-thumb:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.lib-img-thumb:disabled { cursor: default; }
.lib-img-thumb--empty { cursor: default; }
.tooltip-trigger { display: inline-flex; }
.tooltip-trigger:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
