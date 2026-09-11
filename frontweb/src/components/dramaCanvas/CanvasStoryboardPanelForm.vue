<template>
  <el-form label-position="left" label-width="36px" size="small" class="panel-form compact-form">
    <el-form-item label="标题">
      <el-input v-model="form.title" :aria-label="storyboardControlLabel('标题')" placeholder="分镜标题" @blur="saveMeta" />
    </el-form-item>

    <slot name="relations" />
    <slot name="references" />

    <div class="meta-row">
      <el-form-item label="景别" class="meta-item">
        <el-input v-model="form.shot_type" :aria-label="storyboardControlLabel('景别')" placeholder="特写" @blur="saveMeta" />
      </el-form-item>
      <el-form-item label="时长" class="meta-item narrow">
        <el-input-number v-model="form.duration" :aria-label="storyboardControlLabel('时长')" :min="1" :max="120" controls-position="right" @change="saveMeta" />
      </el-form-item>
    </div>

    <slot name="frames" />

    <el-form-item v-if="gridImages.length" label="宫格">
      <el-select v-model="form.video_reference_image_id" :aria-label="storyboardControlLabel('视频参考图')" clearable placeholder="视频使用主图/首帧">
        <el-option
          v-for="image in gridImages"
          :key="image.id"
          :label="image.frame_type === 'nine_grid' ? `九宫格 #${image.id}` : `四宫格 #${image.id}`"
          :value="image.id"
        />
      </el-select>
    </el-form-item>

    <template v-if="isUniversal">
      <el-form-item label="全能词">
        <el-input
          v-model="form.universal_segment_text"
          type="textarea"
          :rows="2"
          resize="vertical"
          :aria-label="storyboardControlLabel('全能词')"
          placeholder="全能模式片段描述"
        />
      </el-form-item>
      <el-form-item label="视频词">
        <el-input
          v-model="form.video_prompt"
          type="textarea"
          :rows="2"
          resize="vertical"
          :aria-label="storyboardControlLabel('视频词')"
          placeholder="生视频提示词"
        />
      </el-form-item>
    </template>
    <template v-else>
      <div class="text-row-2">
        <el-form-item label="动作" class="flex-1">
          <el-input
            v-model="form.action"
            type="textarea"
            :rows="2"
            resize="vertical"
            :aria-label="storyboardControlLabel('动作')"
            placeholder="画面动作"
          />
        </el-form-item>
        <el-form-item label="对白" class="flex-1">
          <el-input
            v-model="form.dialogue"
            type="textarea"
            :rows="2"
            resize="vertical"
            :aria-label="storyboardControlLabel('对白')"
            placeholder="角色对白"
          />
        </el-form-item>
      </div>
      <el-form-item label="生图词">
        <el-input
          v-model="form.image_prompt"
          type="textarea"
          :rows="2"
          resize="vertical"
          :aria-label="storyboardControlLabel('生图词')"
          placeholder="图片提示词"
        />
      </el-form-item>
      <el-form-item label="视频词">
        <el-input
          v-model="form.video_prompt"
          type="textarea"
          :rows="2"
          resize="vertical"
          :aria-label="storyboardControlLabel('视频词')"
          placeholder="视频提示词"
        />
      </el-form-item>
    </template>
  </el-form>
</template>

<script setup>
defineProps({
  form: { type: Object, required: true },
  isUniversal: { type: Boolean, default: false },
  gridImages: { type: Array, default: () => [] },
  storyboardControlLabel: { type: Function, required: true },
  saveMeta: { type: Function, required: true },
})
</script>

<style scoped>
.compact-form :deep(.el-form-item) {
  margin-bottom: 6px;
}
.compact-form :deep(.el-form-item__label) {
  color: var(--canvas-text-subtle, #71717a);
  font-size: 11px;
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
.meta-row {
  display: flex;
  gap: 10px;
}
.meta-item { flex: 1; min-width: 0; }
.meta-item.narrow { max-width: 140px; flex: 0 0 140px; }
.text-row-2 {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.flex-1 { flex: 1; min-width: 0; }
</style>
