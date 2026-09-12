<template>
  <el-tooltip
    :content="item.name || '未命名素材'"
    placement="top"
    popper-class="media-name-tooltip"
    :show-after="250"
    :visible="tooltipVisible"
  >
    <button
      type="button"
      class="picker-card"
      :class="{
        'picker-card--selected': selected,
        'picker-card--incompatible': !compatible,
      }"
      :aria-pressed="selected"
      :aria-label="cardLabel"
      :aria-describedby="`media-card-name-${item.id}`"
      @click="emit('select')"
      @focus="focused = true"
      @blur="focused = false"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
      @keydown.enter.prevent="emit('confirm')"
      @keydown.space.prevent="emit('select')"
    >
      <span :id="`media-card-name-${item.id}`" class="visually-hidden">
        完整素材名称：{{ item.name || '未命名素材' }}
      </span>
      <div class="picker-card__thumb">
        <video
          v-if="item.type === 'video'"
          :src="thumbUrl"
          muted
          preload="metadata"
          aria-hidden="true"
          class="picker-card__video"
        />
        <img
          v-else
          :src="thumbUrl"
          :alt="`${item.name || '未命名素材'} 预览图`"
          class="picker-card__image"
        />
      </div>
      <div class="picker-card__body">
        <div class="picker-card__title-row">
          <span class="picker-card__title">{{ item.name || '未命名素材' }}</span>
          <span class="picker-card__type">{{ item.type === 'video' ? '视频' : '图片' }}</span>
        </div>
        <div class="picker-card__meta">
          <span>{{ originLabel }}</span>
          <span v-if="sizeLabel">{{ sizeLabel }}</span>
        </div>
        <div v-if="selected" class="picker-card__selection">
          {{ compatible ? '已选中' : incompatibleReason }}
        </div>
      </div>
    </button>
  </el-tooltip>
</template>

<script setup>
import { computed, ref } from 'vue'

defineProps({
  item: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  compatible: { type: Boolean, default: true },
  originLabel: { type: String, default: '' },
  sizeLabel: { type: String, default: '' },
  cardLabel: { type: String, default: '' },
  thumbUrl: { type: String, default: '' },
  incompatibleReason: { type: String, default: '' },
})

const emit = defineEmits(['select', 'confirm'])

const focused = ref(false)
const hovered = ref(false)
const tooltipVisible = computed(() => focused.value || hovered.value)

</script>

<style scoped>
.picker-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: inherit;
  text-align: left;
  overflow: hidden;
}

.picker-card:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.picker-card--selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary-light-5);
}

.picker-card--incompatible {
  opacity: 0.72;
}

.picker-card__thumb {
  aspect-ratio: 16 / 10;
  background: var(--bg-page);
  overflow: hidden;
}

.picker-card__image,
.picker-card__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.picker-card__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
}

.picker-card__title-row,
.picker-card__meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.picker-card__title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-card__type,
.picker-card__meta,
.picker-card__selection {
  font-size: 12px;
  color: var(--text-muted);
}

.picker-card__selection {
  color: var(--el-color-primary);
}

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

:global(.media-name-tooltip) {
  max-width: min(560px, calc(100vw - 32px));
  overflow-wrap: anywhere;
}
</style>
