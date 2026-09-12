<template>
  <div :id="panelId" class="drama-res-list res-tabpanel" role="tabpanel" :aria-labelledby="labelledBy" tabindex="0">
    <template v-if="items.length">
      <div v-for="item in items" :key="item.id" class="drama-res-item">
        <slot name="item" :item="item" />
      </div>
    </template>
    <slot v-else name="empty" />
  </div>
</template>

<script setup>
// 制作资源列表只负责面板、条目槽和空态槽，封面与提取入口仍由父级传入
defineProps({
  panelId: { type: String, required: true },
  labelledBy: { type: String, required: true },
  items: { type: Array, default: () => [] },
})
</script>

<style scoped>
.drama-res-list { display: flex; flex-wrap: wrap; gap: 12px; padding: 4px 0 8px; min-width: 0; }
.drama-res-item { display: flex; gap: 12px; width: calc(50% - 6px); min-width: 0; background: var(--bg-inner, #1c1c1e); border: 1px solid var(--border-color, #27272a); border-radius: 8px; padding: 10px; box-sizing: border-box; }
@media (max-width: 760px) {
  .drama-res-item {
    width: 100%;
  }
}
</style>
