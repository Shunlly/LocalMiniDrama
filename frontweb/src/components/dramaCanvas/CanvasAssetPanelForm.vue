<template>
  <div class="form-col">
    <el-form label-position="left" label-width="44px" size="small" class="panel-form compact-form">
      <template v-if="kind === 'character'">
        <div class="form-row-2">
          <el-form-item label="名称" class="flex-1">
            <el-input v-model="form.name" aria-label="角色名称" placeholder="角色名" />
          </el-form-item>
          <el-form-item label="类型" class="type-field">
            <el-select
              v-model="form.role"
              :aria-label="`角色${form.name || '未命名角色'}类型`"
              clearable
              placeholder="类型"
              teleported
              popper-class="canvas-panel-popper"
              @visible-change="onSelectVisibleChange"
            >
              <el-option label="主角" value="main" />
              <el-option label="配角" value="supporting" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="外貌">
          <el-input
            v-model="form.appearance"
            type="textarea"
            :rows="2"
            resize="vertical"
            aria-label="角色外貌"
            placeholder="外貌描述"
          />
        </el-form-item>
        <el-form-item label="简介">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            resize="vertical"
            aria-label="角色简介"
            placeholder="角色简介"
          />
        </el-form-item>
      </template>

      <template v-else-if="kind === 'scene'">
        <div class="form-row-2">
          <el-form-item label="地点" class="flex-1">
            <el-input v-model="form.location" aria-label="场景地点" placeholder="场景地点" />
          </el-form-item>
          <el-form-item label="时间" class="time-field">
            <el-input v-model="form.time" aria-label="场景时间" placeholder="白天/夜" />
          </el-form-item>
        </div>
        <el-form-item label="描述">
          <el-input
            v-model="form.prompt"
            type="textarea"
            :rows="2"
            resize="vertical"
            aria-label="场景描述"
            placeholder="场景描述"
          />
        </el-form-item>
        <slot />
      </template>

      <template v-else>
        <el-form-item label="名称">
          <el-input v-model="form.name" aria-label="道具名称" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            resize="vertical"
            aria-label="道具描述"
            placeholder="道具描述"
          />
        </el-form-item>
        <el-form-item label="提示">
          <el-input
            v-model="form.prompt"
            type="textarea"
            :rows="2"
            resize="vertical"
            aria-label="道具提示词"
            placeholder="生图提示词"
          />
        </el-form-item>
      </template>
    </el-form>
  </div>
</template>

<script setup>
defineProps({
  kind: { type: String, required: true },
  form: { type: Object, required: true },
  onSelectVisibleChange: { type: Function, required: true },
})
</script>

<style scoped>
.form-col {
  flex: 1;
  min-width: 0;
}
.compact-form :deep(.el-form-item) {
  margin-bottom: 6px;
}
.compact-form :deep(.el-form-item__label) {
  color: var(--canvas-text-subtle, #71717a);
  font-size: 11px;
  padding-right: 6px;
}
.compact-form :deep(.el-input__wrapper),
.compact-form :deep(.el-select__wrapper) {
  min-height: 28px;
}
.compact-form :deep(.el-textarea__inner) {
  resize: vertical;
  min-height: 52px;
  line-height: 1.45;
}
.form-row-2 {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.flex-1 { flex: 1; min-width: 0; }
.type-field { width: 108px; flex-shrink: 0; }
.time-field { width: 96px; flex-shrink: 0; }
</style>

<style>
.canvas-panel-popper {
  z-index: 4000 !important;
}
.canvas-panel-popper.el-select__popper .el-select-dropdown__wrap {
  max-height: 168px !important;
}
</style>
