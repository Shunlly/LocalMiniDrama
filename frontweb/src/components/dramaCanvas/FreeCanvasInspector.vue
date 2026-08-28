<template>
  <aside
    v-if="node"
    class="free-canvas-inspector nodrag nopan"
    role="complementary"
    aria-label="自由节点检查器"
    tabindex="-1"
    @keydown.esc.stop.prevent="emit('close')"
  >
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
        <el-input
          :model-value="draft.title"
          aria-label="节点标题"
          :disabled="editorDisabled"
          @update:model-value="updateDraftField('title', $event)"
        />
      </el-form-item>
      <el-form-item label="内容">
        <el-input
          :model-value="draft.content"
          type="textarea"
          resize="none"
          :rows="6"
          aria-label="节点内容"
          :disabled="editorDisabled"
          @update:model-value="updateDraftField('content', $event)"
        />
      </el-form-item>
      <el-form-item label="素材引用">
        <el-select v-model="draft.asset_ref" aria-label="素材引用" clearable :disabled="editorDisabled" placeholder="不关联素材" @change="emitUpdate">
          <el-option v-for="option in assetOptions" :key="option.id" :label="option.label" :value="option.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="分镜引用">
        <el-select v-model="draft.storyboard_ref" aria-label="分镜引用" clearable :disabled="editorDisabled" placeholder="不关联分镜" @change="emitUpdate">
          <el-option v-for="option in storyboardOptions" :key="option.id" :label="option.label" :value="option.id" />
        </el-select>
      </el-form-item>
    </el-form>

    <section v-if="isConfigNode" class="config-panel" aria-label="生成配置状态">
      <div class="config-panel-heading">
        <h3>生成配置</h3>
        <el-tag size="small" :type="configTagType">{{ configRuntime.statusLabel }}</el-tag>
      </div>
      <dl class="config-details">
        <div>
          <dt>输入</dt>
          <dd>{{ configRuntime.inputSummary }}</dd>
        </div>
        <div v-if="configRuntime.providerLabel">
          <dt>服务</dt>
          <dd>{{ configRuntime.providerLabel }}<span v-if="configRuntime.modelLabel"> · {{ configRuntime.modelLabel }}</span></dd>
        </div>
      </dl>
      <p class="config-message" :class="`state-${configRuntime.status}`" role="status">{{ configRuntime.reason }}</p>
      <div class="inspector-actions">
        <el-button v-if="configRuntime.canConfigure" :disabled="readonly || busy" @click="emit('configure', node.id)">
          <el-icon><Setting /></el-icon>
          AI 配置
        </el-button>
        <el-button
          v-if="configRuntime.canCancel"
          :disabled="readonly || busy"
          title="停止当前页面等待；已提交任务可能继续执行或计费"
          @click="emit('cancel-config', node.id)"
        >
          <el-icon><CircleClose /></el-icon>
          停止等待
        </el-button>
        <el-button v-if="configRuntime.canRetry" type="primary" :disabled="readonly || busy" @click="emit('retry-config', node.id)">
          <el-icon><RefreshRight /></el-icon>
          重试检查
        </el-button>
      </div>
    </section>

    <section class="conversion-panel" aria-label="转换为制作内容">
      <h3>转换为制作内容</h3>
      <el-select v-model="conversionTarget" aria-label="转换目标" :disabled="editorDisabled" placeholder="选择转换目标">
        <el-option v-for="target in conversionTargets" :key="target.value" :label="target.label" :value="target.value" />
      </el-select>
      <div class="inspector-actions">
        <el-button
          :loading="converting"
          :disabled="editorDisabled || !conversionTarget"
          @click="emitConvertReference"
        >
          转换引用
        </el-button>
        <el-button
          type="primary"
          :loading="savingAsset"
          :disabled="editorDisabled || !saveAssetEligibility.eligible"
          :aria-label="saveAssetAriaLabel"
          :title="saveAssetEligibility.reason || '保存为素材'"
          @click="emitSaveAsset"
        >
          保存为素材
        </el-button>
      </div>
      <p v-if="!saveAssetEligibility.eligible" class="asset-save-reason" role="note">
        {{ saveAssetEligibility.reason }}
      </p>
    </section>
  </aside>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { CircleClose, Close, RefreshRight, Setting } from '@element-plus/icons-vue'

const props = defineProps({
  node: { type: Object, default: null },
  readonly: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  converting: { type: Boolean, default: false },
  savingAsset: { type: Boolean, default: false },
  saveAssetEligibility: {
    type: Object,
    default: () => ({ eligible: false, path: '', reason: '仅本地图片或视频节点可保存为项目素材' }),
  },
  configRuntime: {
    type: Object,
    default: () => ({
      status: 'blocked',
      statusLabel: '需要配置',
      inputSummary: '尚未连接文本、图片、视频或制作引用',
      reason: '视频生成未就绪，请前往 AI 配置完成配置。',
      providerLabel: '',
      modelLabel: '',
      canConfigure: true,
      canCancel: false,
      canRetry: false,
    }),
  },
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

const emit = defineEmits([
  'update-node',
  'convert-reference',
  'save-asset',
  'close',
  'configure',
  'cancel-config',
  'retry-config',
])

const draft = ref({ title: '', content: '', asset_ref: null, storyboard_ref: null })
const conversionTarget = ref('')
const isConfigNode = computed(() => props.node?.type === 'config')
const editorDisabled = computed(() => (
  props.readonly || props.busy || (isConfigNode.value && props.configRuntime?.status === 'running')
))
const saveAssetAriaLabel = computed(() => (
  props.saveAssetEligibility?.eligible
    ? '保存为素材'
    : `保存为素材不可用：${props.saveAssetEligibility?.reason || '当前节点不符合保存条件'}`
))
const configTagType = computed(() => ({
  blocked: 'danger',
  error: 'danger',
  checking: 'info',
  failed: 'danger',
  mock: 'warning',
  ready: 'success',
  running: 'primary',
  cancelled: 'info',
}[props.configRuntime?.status] || 'info'))

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

function updateDraftField(field, value) {
  if (!['title', 'content'].includes(field) || editorDisabled.value) return
  draft.value = { ...draft.value, [field]: String(value ?? '') }
  emitUpdate()
}

function emitConvertReference() {
  if (!props.node || props.readonly || !conversionTarget.value) return
  emit('convert-reference', { id: props.node.id, target: conversionTarget.value, ...draft.value })
}

function emitSaveAsset() {
  if (!props.node || props.readonly || !props.saveAssetEligibility?.eligible) return
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
.conversion-panel h3,
.config-panel h3 {
  margin: 0;
  font-size: 14px;
}

.conversion-panel {
  display: grid;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #3f3f46);
}

.config-panel {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--border-color, #3f3f46);
  border-bottom: 1px solid var(--border-color, #3f3f46);
}

.config-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.config-details {
  display: grid;
  gap: 8px;
  margin: 0;
}

.config-details div {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 8px;
}

.config-details dt,
.config-details dd,
.config-message {
  margin: 0;
  color: var(--canvas-text-muted, var(--text-muted, #a1a1aa));
  font-size: 12px;
  line-height: 18px;
}

.config-details dd {
  color: var(--canvas-text-primary, var(--text-primary, #e4e4e7));
  white-space: pre-line;
}

.config-message.state-blocked,
.config-message.state-error,
.config-message.state-failed { color: var(--canvas-danger-text, #f87171); }

.config-message.state-mock { color: var(--canvas-amber-text, #fbbf24); }

.asset-save-reason {
  margin: 0;
  color: var(--canvas-text-muted, var(--text-muted, #a1a1aa));
  font-size: 11px;
  line-height: 16px;
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
