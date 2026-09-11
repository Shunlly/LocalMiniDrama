<template>
  <div class="generation-settings">
    <div class="gs-section-title">⚡ 一键生成并发设置</div>
    <p class="gs-desc">控制「一键生成视频」和「补全并生成」流水线中，各类任务同时并行生成的数量。并发数越高速度越快，但过高可能触发接口限流（请求过于频繁）。建议根据你的 API 额度选择。</p>

    <div
      v-if="generationSettingsLoadState === 'error'"
      class="generation-settings-load-state generation-settings-load-state--error"
      role="alert"
      aria-live="assertive"
    >
      <div class="generation-settings-load-copy">
        <strong>生成设置读取失败</strong>
        <span>{{ generationSettingsLoadError }}</span>
      </div>
      <el-button size="small" type="primary" plain @click="loadGenerationSettings">重试</el-button>
    </div>
    <div
      v-else-if="generationSettingsLoadState === 'loading'"
      class="generation-settings-load-state"
      role="status"
      aria-live="polite"
    >
      正在读取生成设置...
    </div>
    <template v-else>
    <div class="gs-row">
      <span class="gs-label">图片并发数</span>
      <el-select
        v-model="genConcurrencyInput"
        filterable
        allow-create
        default-first-option
        aria-label="图片并发数"
        placeholder="选择或输入并发数"
        no-data-text="暂无可选项，可直接输入"
        style="width: 180px"
        @change="onConcurrencyChange"
      >
        <el-option label="1（串行，最稳定）" :value="1" />
        <el-option label="2" :value="2" />
        <el-option label="3（默认）" :value="3" />
        <el-option label="5" :value="5" />
        <el-option label="8" :value="8" />
        <el-option label="10" :value="10" />
      </el-select>
      <span class="gs-unit">个任务同时生成</span>
    </div>

    <div class="gs-row" style="margin-top: 10px">
      <span class="gs-label">视频并发数</span>
      <el-select
        v-model="genVideoConcurrencyInput"
        filterable
        allow-create
        default-first-option
        aria-label="视频并发数"
        placeholder="选择或输入并发数"
        no-data-text="暂无可选项，可直接输入"
        style="width: 180px"
        @change="onVideoConcurrencyChange"
      >
        <el-option label="1（串行，最稳定）" :value="1" />
        <el-option label="2" :value="2" />
        <el-option label="3（默认）" :value="3" />
        <el-option label="5" :value="5" />
        <el-option label="8" :value="8" />
        <el-option label="10" :value="10" />
      </el-select>
      <span class="gs-unit">个任务同时生成</span>
    </div>

    <div style="margin-top: 14px">
      <el-button
        type="primary"
        size="small"
        aria-label="保存生成设置"
        :loading="genSettingSaving"
        :disabled="generationSettingsWriteLocked"
        :title="generationSettingsWriteLocked ? generationSettingsWriteLockReason : undefined"
        @click="saveGenerationSettings"
      >保存</el-button>
    </div>
    <el-alert
      v-if="genSettingSaved"
      type="success"
      title="已保存"
      :closable="false"
      show-icon
      style="margin-top: 12px; width: fit-content"
    />
    </template>
    <div class="gs-tip-box">
      <div class="gs-tip-title">📌 适用范围</div>
      <ul class="gs-tip-list">
        <li>图片并发：步骤 2 角色图、步骤 4 场景图、步骤 6 分镜图</li>
        <li>视频并发：步骤 7 分镜视频</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
defineProps({
  generationSettingsLoadState: { type: String, default: 'loading' },
  generationSettingsLoadError: { type: String, default: '' },
  genSettingSaving: { type: Boolean, default: false },
  genSettingSaved: { type: Boolean, default: false },
  generationSettingsWriteLocked: { type: Boolean, default: false },
  generationSettingsWriteLockReason: { type: String, default: '' },
  loadGenerationSettings: { type: Function, required: true },
  saveGenerationSettings: { type: Function, required: true },
  onConcurrencyChange: { type: Function, required: true },
  onVideoConcurrencyChange: { type: Function, required: true },
})

const genConcurrencyInput = defineModel('genConcurrencyInput')
const genVideoConcurrencyInput = defineModel('genVideoConcurrencyInput')
</script>

<style scoped>
.generation-settings {
  max-width: 600px;
}
.generation-settings-load-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 52px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
}
.generation-settings-load-state--error {
  border-color: var(--el-color-danger-light-5, #fab6b6);
  background: var(--el-color-danger-light-9, #fef0f0);
}
.generation-settings-load-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}
.generation-settings-load-copy strong {
  color: var(--el-color-danger, #f56c6c);
}
.generation-settings-load-copy span {
  overflow-wrap: anywhere;
}
.gs-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 8px;
}
.gs-desc {
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.6;
  margin-bottom: 20px;
}
.gs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.gs-label {
  font-size: 13px;
  color: var(--el-text-color-primary, #303133);
  font-weight: 500;
  white-space: nowrap;
}
.gs-unit {
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  white-space: nowrap;
}
.gs-tip-box {
  margin-top: 20px;
  background: var(--el-fill-color-light, #f5f7fa);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  padding: 14px 16px;
  font-size: 13px;
}
.gs-tip-title {
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 8px;
}
.gs-tip-list {
  margin: 0 0 8px 16px;
  padding: 0;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.8;
}
.gs-tip-note {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
}
@media (max-width: 760px) {
  .generation-settings-load-state {
    align-items: stretch;
    flex-direction: column;
  }
  .gs-row {
    flex-wrap: wrap;
  }
}
</style>