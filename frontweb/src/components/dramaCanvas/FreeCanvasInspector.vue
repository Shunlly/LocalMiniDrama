<template>
  <aside v-if="node" class="free-canvas-inspector nodrag nopan" aria-label="自由节点检查器">
    <header class="inspector-header">
      <h2>节点设置</h2>
      <el-tooltip content="关闭检查器" placement="bottom">
        <el-button size="small" circle aria-label="关闭检查器" title="关闭检查器" @click="emit('close')">
          <el-icon><Close /></el-icon>
        </el-button>
      </el-tooltip>
    </header>

    <el-form label-position="top" size="small">
      <el-form-item label="标题">
        <el-input v-model="draft.title" :disabled="readonly" @change="emitUpdate" />
      </el-form-item>
      <el-form-item label="内容">
        <el-input v-model="draft.content" type="textarea" resize="none" :rows="6" :disabled="readonly" @change="emitUpdate" />
      </el-form-item>
      <el-form-item label="素材引用">
        <el-select v-model="draft.asset_ref" aria-label="素材引用" clearable :disabled="readonly" placeholder="不关联素材" @change="emitUpdate">
          <el-option v-for="option in assetOptions" :key="option.id" :label="option.label" :value="option.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="分镜引用">
        <el-select v-model="draft.storyboard_ref" aria-label="分镜引用" clearable :disabled="readonly" placeholder="不关联分镜" @change="emitUpdate">
          <el-option v-for="option in storyboardOptions" :key="option.id" :label="option.label" :value="option.id" />
        </el-select>
      </el-form-item>
    </el-form>

    <section class="conversion-panel" aria-label="转换为制作内容">
      <h3>转换为制作内容</h3>
      <el-select v-model="conversionTarget" aria-label="转换目标" :disabled="readonly" placeholder="选择转换目标">
        <el-option v-for="target in conversionTargets" :key="target.value" :label="target.label" :value="target.value" />
      </el-select>
      <div class="inspector-actions">
        <el-button :disabled="readonly || !conversionTarget" @click="emitConvertReference">转换引用</el-button>
        <el-button type="primary" :disabled="readonly" @click="emitSaveAsset">保存为素材</el-button>
      </div>
    </section>
  </aside>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Close } from '@element-plus/icons-vue'

const props = defineProps({
  node: { type: Object, default: null },
  readonly: { type: Boolean, default: false },
  assetOptions: { type: Array, default: () => [] },
  storyboardOptions: { type: Array, default: () => [] },
  conversionTargets: {
    type: Array,
    default: () => [
      { value: 'asset', label: '素材' },
      { value: 'storyboard', label: '分镜' },
    ],
  },
})

const emit = defineEmits(['update-node', 'convert-reference', 'save-asset', 'close'])

const draft = ref({ title: '', content: '', asset_ref: null, storyboard_ref: null })
const conversionTarget = ref('')

watch(
  () => props.node,
  (node) => {
    draft.value = {
      title: String(node?.title || node?.label || ''),
      content: String(node?.content ?? node?.text ?? node?.description ?? ''),
      asset_ref: node?.asset_ref ?? null,
      storyboard_ref: node?.storyboard_ref ?? null,
    }
    conversionTarget.value = ''
  },
  { immediate: true, deep: true },
)

function emitUpdate() {
  if (!props.node || props.readonly) return
  emit('update-node', { id: props.node.id, ...draft.value })
}

function emitConvertReference() {
  if (!props.node || props.readonly || !conversionTarget.value) return
  emit('convert-reference', { id: props.node.id, target: conversionTarget.value, ...draft.value })
}

function emitSaveAsset() {
  if (!props.node || props.readonly) return
  emit('save-asset', { id: props.node.id, ...draft.value })
}
</script>

<style scoped>
.free-canvas-inspector {
  box-sizing: border-box;
  width: 340px;
  max-height: min(680px, calc(100vh - 160px));
  overflow-y: auto;
  padding: 14px;
  border: 1px solid var(--border-color, #3f3f46);
  border-radius: 6px;
  background: var(--canvas-panel-surface, var(--bg-card, #18181b));
  color: var(--canvas-text-primary, var(--text-primary, #e4e4e7));
  box-shadow: var(--canvas-raised-shadow, var(--shadow, 0 12px 32px rgba(0, 0, 0, 0.45)));
}

.inspector-header,
.inspector-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.inspector-header h2,
.conversion-panel h3 {
  margin: 0;
  font-size: 14px;
}

.conversion-panel {
  display: grid;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #3f3f46);
}

.inspector-actions {
  justify-content: flex-end;
}

.free-canvas-inspector :deep(.el-input__wrapper.is-focus),
.free-canvas-inspector :deep(.el-textarea__inner:focus),
.free-canvas-inspector :deep(.el-button:focus-visible) {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 2px;
}
</style>
