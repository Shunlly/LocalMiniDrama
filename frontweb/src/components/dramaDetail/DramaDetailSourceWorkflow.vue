<template>
  <SourceIntakeWorkflowPanel
    :drama-id="dramaId"
    :drama="drama"
    :source-import-intent="sourceImportIntent"
    @refresh="emit('refresh')"
    @enter-production="emit('enter-production')"
    @focus-episode-list="emit('focus-episode-list')"
  />
</template>

<script setup>
import SourceIntakeWorkflowPanel from '@/components/SourceIntakeWorkflowPanel.vue'

// 详情页只转发素材流程入口、深链接意图和动作，不改 SourceIntake 实现
defineProps({
  dramaId: { type: Number, required: true },
  drama: { type: Object, default: null },
  sourceImportIntent: { type: Boolean, default: false },
})

const emit = defineEmits(['refresh', 'enter-production', 'focus-episode-list'])
</script>
