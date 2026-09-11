<template>
  <div class="protocol-help">
    <p class="ph-disclaimer">{{ disclaimer }}</p>
    <template v-for="(section, sectionIndex) in displayedSections" :key="section.id || sectionIndex">
      <div
        class="ph-section-title"
        :class="{ 'ph-section-title-follow': sectionIndex > 0 }"
      >{{ section.title }}</div>
      <el-collapse accordion>
        <el-collapse-item
          v-for="item in section.items || []"
          :key="item.name"
          :name="item.name"
        >
          <template #title><span class="ph-tag" :class="tagClass(item.tag)">{{ tagLabel(item.tag) }}</span> {{ item.title }}</template>
          <AiConfigPresetHelpBody :blocks="item.body || []" />
        </el-collapse-item>
      </el-collapse>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import AiConfigPresetHelpBody from '@/components/aiConfig/AiConfigPresetHelpBody.vue'
import {
  PRESET_HELP_DISCLAIMER,
  PRESET_HELP_SECTIONS,
  PRESET_HELP_TAG,
} from '@/components/aiConfig/aiConfigPresetHelpSections.js'

const props = defineProps({
  sections: { type: Array, default: () => PRESET_HELP_SECTIONS },
  disclaimer: { type: String, default: PRESET_HELP_DISCLAIMER },
})

const displayedSections = computed(() => (
  Array.isArray(props.sections)
    ? props.sections.filter((section) => section && typeof section === 'object')
    : []
))

function tagMeta(tag) {
  return PRESET_HELP_TAG[tag] || { label: '', className: '' }
}

function tagClass(tag) {
  return tagMeta(tag).className
}

function tagLabel(tag) {
  return tagMeta(tag).label
}
</script>

<style scoped>
.ph-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular, #606266);
  padding: 4px 0 6px;
  border-bottom: 1px solid var(--el-border-color-light, #ebeef5);
  margin-bottom: 4px;
}
.ph-section-title-follow {
  margin-top: 16px;
}
.ph-tag {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 6px;
  font-weight: 600;
  vertical-align: middle;
}
.ph-tag-img {
  background: #ecf5ff;
  color: #409eff;
  border: 1px solid #b3d8ff;
}
.ph-tag-vid {
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #b3e19d;
}
.ph-tag-text {
  background: #f4f4f5;
  color: #606266;
  border: 1px solid #d3d4d6;
}
.ph-tag-tts {
  background: #fdf6ec;
  color: #e6a23c;
  border: 1px solid #f5dab1;
}
.ph-tag-ocr {
  background: #fff1f2;
  color: #be123c;
  border: 1px solid #fecdd3;
}
.ph-tag-asr {
  background: #ecfeff;
  color: #0f766e;
  border: 1px solid #a5f3fc;
}
.protocol-help .ph-disclaimer {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular, #606266);
  margin: 0 0 12px;
}
</style>
