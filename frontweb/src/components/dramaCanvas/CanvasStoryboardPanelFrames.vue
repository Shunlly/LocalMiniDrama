<template>
  <section
    class="frame-preview-row"
    aria-label="首尾帧"
  >
    <div class="frame-slot">
      <img v-if="firstFrameUrl" :src="firstFrameUrl" :alt="storyboardControlLabel('首帧')" />
      <div v-else class="frame-empty">暂无首帧</div>
      <span class="frame-slot-label">首帧</span>
    </div>
    <div class="frame-slot">
      <img v-if="lastFrameUrl" :src="lastFrameUrl" :alt="storyboardControlLabel('尾帧')" />
      <div v-else class="frame-empty">暂无尾帧</div>
      <span class="frame-slot-label">尾帧</span>
    </div>
  </section>
</template>

<script setup>
defineProps({
  firstFrameUrl: { type: String, default: '' },
  lastFrameUrl: { type: String, default: '' },
  storyboardControlLabel: { type: Function, required: true },
})
</script>

<style scoped>
.frame-preview-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 0 0 10px;
}
.frame-slot {
  position: relative;
  overflow: hidden;
  min-height: 72px;
  border: 1px solid var(--canvas-divider-strong, #3f3f46);
  border-radius: 6px;
  background: var(--canvas-media-well, #09090b);
}
.frame-slot img {
  display: block;
  width: 100%;
  height: 72px;
  object-fit: cover;
}
.frame-empty {
  display: grid;
  place-items: center;
  height: 72px;
  color: var(--canvas-text-subtle, #71717a);
  font-size: 11px;
}
.frame-slot-label {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 10px;
  line-height: 18px;
}
</style>
