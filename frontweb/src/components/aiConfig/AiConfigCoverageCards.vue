<template>
  <div class="coverage-grid">
    <AiConfigCoverageCard
      v-for="item in orderedCoverageServices"
      :key="item.type"
      :item="item"
      :selected="activeServiceFilter === item.type"
      :coverage-actions="coverageActions"
      :is-coverage-action-testing="isCoverageActionTesting"
      :is-coverage-action-disabled="isCoverageActionDisabled"
      :set-coverage-card-ref="setCoverageCardRef"
      @select="$emit('select', $event)"
      @action="(item, action) => $emit('action', item, action)"
    />
  </div>
  <section class="extraction-coverage" aria-labelledby="ai-extraction-coverage-title">
    <div class="extraction-coverage-header">
      <h3 id="ai-extraction-coverage-title">素材抽取</h3>
      <p>用于 PDF/图片识别和音频/视频转写。缺省不会把正式制作标成未就绪。</p>
    </div>
    <div class="coverage-grid coverage-grid-extraction">
      <AiConfigCoverageCard
        v-for="item in orderedExtractionCoverageServices"
        :key="item.type"
        compact
        :item="item"
        :selected="activeServiceFilter === item.type"
        :coverage-actions="coverageActions"
        :is-coverage-action-testing="isCoverageActionTesting"
        :is-coverage-action-disabled="isCoverageActionDisabled"
        :set-coverage-card-ref="setCoverageCardRef"
        @select="$emit('select', $event)"
        @action="(item, action) => $emit('action', item, action)"
      />
    </div>
  </section>
</template>

<script setup>
import AiConfigCoverageCard from '@/components/aiConfig/AiConfigCoverageCard.vue'

defineProps({
  orderedCoverageServices: { type: Array, default: () => [] },
  orderedExtractionCoverageServices: { type: Array, default: () => [] },
  activeServiceFilter: { type: String, default: '' },
  coverageActions: { type: Function, required: true },
  isCoverageActionTesting: { type: Function, required: true },
  isCoverageActionDisabled: { type: Function, required: true },
  setCoverageCardRef: { type: Function, required: true },
})

defineEmits(['select', 'action'])
</script>

<style scoped>
.coverage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}
.extraction-coverage {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-light, #e4e7ed);
}
.extraction-coverage-header h3 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 650;
  color: var(--el-text-color-primary, #303133);
}
.extraction-coverage-header p {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary, #909399);
}
.coverage-grid-extraction {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
@media (max-width: 1120px) {
  .coverage-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 760px) {
  .coverage-grid,
  .coverage-grid-extraction {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
