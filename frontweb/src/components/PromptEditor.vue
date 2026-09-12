<template>
  <div class="prompt-editor-page">
    <div v-if="loading && !hasSuccessfulLoad" v-loading="true" class="loading-wrap" />
    <template v-else>
      <el-alert
        v-if="loadError"
        class="load-error-alert"
        type="error"
        show-icon
        :closable="false"
        :title="loadError"
      >
        <el-button
          size="small"
          type="primary"
          plain
          :loading="loading"
          :disabled="loading"
          :title="loading ? '正在重新加载提示词，请稍候' : undefined"
          aria-label="重新加载提示词"
          @click="load"
        >
          重新加载
        </el-button>
      </el-alert>

      <el-empty
        v-if="hasSuccessfulLoad && !loadError && !prompts.length"
        description="暂无系统提示词。这些提示词来自系统预置，可重新加载后再试。"
      >
        <el-button
          size="small"
          plain
          :loading="loading"
          :disabled="loading"
          :title="loading ? '正在重新加载提示词，请稍候' : undefined"
          aria-label="重新加载提示词"
          @click="load"
        >
          重新加载
        </el-button>
      </el-empty>

      <div v-else-if="hasSuccessfulLoad" class="editor-layout">
        <PromptEditorSidebar
          :prompts="prompts"
          :current-key="currentKey"
          :is-dirty="isDirty"
          :select-prompt="selectPrompt"
        />
        <div class="right-content">
          <p class="page-desc">
            可自定义 AI 生成各阶段使用的系统提示词。蓝色锁定区为 JSON
            格式要求，不可修改以确保输出格式正确。
          </p>
          <PromptEditorPane
            v-if="currentPrompt"
            :prompt="currentPrompt"
            :body="editState[currentPrompt.key]"
            :saving="savingKey === currentPrompt.key"
            :resetting="resettingKey === currentPrompt.key"
            :save-disabled-reason="saveDisabledReason"
            :reset-disabled-reason="resetDisabledReason"
            @update:body="onUpdateBody"
            @save="save(currentPrompt)"
            @reset="reset(currentPrompt)"
          />
          <el-empty v-else description="请选择一条提示词" />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { isUserFacingAbort, toUserFacingError } from '@/utils/userFacingError.js'
import { promptsAPI } from '@/api/prompts'
import PromptEditorSidebar from './promptEditor/PromptEditorSidebar.vue'
import PromptEditorPane from './promptEditor/PromptEditorPane.vue'

const loading = ref(false)
const loadError = ref('')
const hasSuccessfulLoad = ref(false)
const prompts = ref([])
const editState = ref({})
const isDirty = ref({})
const savingKey = ref(null)
const resettingKey = ref(null)
const currentKey = ref(null)

const currentPrompt = computed(() => {
  return prompts.value.find((p) => p.key === currentKey.value)
})

function describeSaveDisabledReason(prompt, dirty) {
  if (!prompt) return '当前没有可保存的提示词'
  if (dirty) return ''
  return '当前没有未保存的修改'
}

function describeResetDisabledReason(prompt, dirty) {
  if (!prompt) return '当前没有可恢复的提示词'
  if (prompt.is_customized || dirty) return ''
  return '当前已是系统默认提示词，无需恢复'
}

const saveDisabledReason = computed(() => {
  const prompt = currentPrompt.value
  return describeSaveDisabledReason(prompt, Boolean(prompt && isDirty.value[prompt.key]))
})

const resetDisabledReason = computed(() => {
  const prompt = currentPrompt.value
  return describeResetDisabledReason(prompt, Boolean(prompt && isDirty.value[prompt.key]))
})

async function load() {
  loading.value = true
  try {
    const data = await promptsAPI.list()
    prompts.value = data.prompts || []
    for (const p of prompts.value) {
      editState.value[p.key] = p.current_body || p.default_body
    }
    if (prompts.value.length > 0 && !prompts.value.some((p) => p.key === currentKey.value)) {
      currentKey.value = prompts.value[0].key
    }
    loadError.value = ''
    hasSuccessfulLoad.value = true
  } catch (_) {
    loadError.value = '加载提示词失败'
    ElMessage.error('加载提示词失败')
  } finally {
    loading.value = false
  }
}

function selectPrompt(key) {
  currentKey.value = key
}

function markDirty(key) {
  const p = prompts.value.find((x) => x.key === key)
  if (!p) return
  const current = p.current_body || p.default_body
  isDirty.value[key] = editState.value[key] !== current
}

function onUpdateBody(value) {
  const key = currentKey.value
  if (!key) return
  editState.value[key] = value
  markDirty(key)
}

function hasUnsavedChanges() {
  return Object.values(isDirty.value).some(Boolean)
}

defineExpose({
  hasUnsavedChanges,
})

async function save(p) {
  const content = editState.value[p.key]
  if (!content?.trim()) {
    ElMessage.warning('内容不能为空')
    return
  }
  savingKey.value = p.key
  try {
    await promptsAPI.update(p.key, content.trim())
    p.current_body = content.trim()
    p.is_customized = true
    isDirty.value[p.key] = false
    ElMessage.success('已保存')
  } catch (error) {
    if (isUserFacingAbort(error)) return
    ElMessage.error(toUserFacingError(error, '保存提示词失败，请稍后重试'))
  } finally {
    savingKey.value = null
  }
}

async function reset(p) {
  try {
    await ElMessageBox.confirm(`确定将「${p.label}」恢复为系统默认提示词？`, '恢复默认', {
      type: 'warning',
      confirmButtonText: '恢复默认',
      cancelButtonText: '取消',
      distinguishCancelAndClose: true,
    })
  } catch (error) {
    if (isUserFacingAbort(error) || error === 'close') return
    ElMessage.error(toUserFacingError(error, '恢复默认失败，请稍后重试'))
    return
  }
  resettingKey.value = p.key
  try {
    await promptsAPI.reset(p.key)
    p.current_body = null
    p.is_customized = false
    editState.value[p.key] = p.default_body
    isDirty.value[p.key] = false
    ElMessage.success('已恢复默认')
  } catch (error) {
    if (isUserFacingAbort(error)) return
    ElMessage.error(toUserFacingError(error, '恢复默认失败，请稍后重试'))
  } finally {
    resettingKey.value = null
  }
}

onMounted(() => load())
</script>

<style scoped>
.prompt-editor-page {
  padding: 0;
  height: 100%;
}
.loading-wrap {
  min-height: 200px;
}
.editor-layout {
  display: flex;
  height: 100%;
  min-height: calc(100vh - 120px);
}
.right-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}
.page-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-muted, #71717a);
  line-height: 1.6;
  padding: 10px 14px;
  background: var(--bg-inner, #f8f8f8);
  border-radius: 8px;
  border-left: 3px solid var(--el-color-primary, #7c3aed);
}
.load-error-alert {
  margin-bottom: 16px;
}
</style>
