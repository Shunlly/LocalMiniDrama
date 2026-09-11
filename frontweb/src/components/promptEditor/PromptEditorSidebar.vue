<template>
  <div class="left-sidebar">
    <nav class="sidebar-menu" aria-label="提示词列表">
      <button
        v-for="p in prompts"
        :key="p.key"
        type="button"
        tabindex="0"
        :class="['menu-item', { active: currentKey === p.key }]"
        :aria-current="currentKey === p.key ? 'true' : undefined"
        @click="selectPrompt(p.key)"
        @keydown.enter.prevent="selectPrompt(p.key)"
        @keydown.space.prevent="selectPrompt(p.key)"
      >
        <div class="menu-item-content">
          <span class="menu-label">{{ p.label }}</span>
          <el-tag
            v-if="p.is_customized"
            type="warning"
            size="small"
            class="menu-tag"
          >已自定义</el-tag>
          <el-tag v-else type="info" size="small" class="menu-tag">默认</el-tag>
        </div>
        <div v-if="isDirty[p.key]" class="dirty-indicator" aria-hidden="true" />
      </button>
    </nav>
  </div>
</template>

<script setup>
defineProps({
  prompts: { type: Array, default: () => [] },
  currentKey: { type: [String, Number], default: null },
  isDirty: { type: Object, default: () => ({}) },
  selectPrompt: { type: Function, required: true },
})
</script>

<style scoped>
.left-sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--bg-card, #fff);
  border-right: 1px solid var(--border-color, #e4e4e7);
  display: flex;
  flex-direction: column;
}

.sidebar-menu {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 12px 16px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 4px;
  position: relative;
}
.menu-item:focus-visible {
  outline: 2px solid var(--el-color-primary, #7c3aed);
  outline-offset: 2px;
}

.menu-item:hover {
  background: var(--bg-inner, #f8f8f8);
}

.menu-item.active {
  background: var(--el-color-primary-light-9, #f3e8ff);
}

.menu-item.active .menu-label {
  color: var(--el-color-primary, #7c3aed);
  font-weight: 600;
}

.menu-item-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.menu-label {
  font-size: 13px;
  color: var(--text-bright, #18181b);
  flex: 1;
}

.menu-tag {
  font-size: 10px;
  transform: scale(0.9);
}

.dirty-indicator {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 6px;
  height: 6px;
  background: var(--el-color-warning, #f59e0b);
  border-radius: 50%;
}
</style>