<template>
  <span v-if="backupWriteLockReason" id="backup-failure-write-reason" class="visually-hidden">{{ backupWriteLockReason }}</span>
  <span v-if="loading" id="backup-list-loading-reason" class="visually-hidden">备份列表正在加载，请稍候</span>
  <span v-if="restoring" id="backup-restoring-reason" class="visually-hidden">正在恢复备份，请稍候</span>
  <span v-if="creating" id="backup-creating-reason" class="visually-hidden">正在创建备份，请稍候</span>
  <section
    v-if="listError"
    id="backup-list-load-error"
    class="data-load-state"
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
  >
    <div class="data-load-state__content">
      <h2>{{ listIsStale ? '备份列表刷新失败' : '备份列表加载失败' }}</h2>
      <p>暂时无法确认服务器中的备份。已有备份文件没有被删除。</p>
      <p v-if="listIsStale" class="data-load-state__stale">下方显示上次成功加载的数据，当前内容已过期；成功重试前不能从列表恢复。</p>
      <p v-else>加载失败时不会显示备份列表。</p>
      <p class="data-load-state__detail">错误详情：{{ listError }}</p>
    </div>
    <el-button
      type="primary"
      plain
      :loading="loading"
      :disabled="loading"
      :title="loading ? '备份列表正在加载，请稍候' : undefined"
      :aria-describedby="loading ? 'backup-list-loading-reason' : 'backup-list-load-error'"
      aria-label="重试加载备份列表"
      @click="loadBackups"
    >
      <el-icon aria-hidden="true"><Refresh /></el-icon>重试加载
    </el-button>
  </section>

  <section
    v-if="fileError"
    id="backup-file-error"
    ref="fileErrorEl"
    class="data-load-state import-failure-state"
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
    tabindex="-1"
  >
    <div class="data-load-state__content">
      <h2>备份文件选择失败</h2>
      <p v-if="fileErrorName" class="import-failure-filename">文件：{{ fileErrorName }}</p>
      <p>{{ fileError }}</p>
    </div>
    <div class="import-failure-actions">
      <el-button
        type="primary"
        plain
        :disabled="accessState.writeLocked"
        :title="accessState.writeLocked ? backupWriteLockReason : undefined"
        :aria-describedby="accessState.writeLocked ? 'backup-failure-write-reason' : 'backup-file-error'"
        aria-label="重新选择备份文件"
        @click="triggerFileSelect"
      >
        <el-icon aria-hidden="true"><Refresh /></el-icon>重新选择备份文件
      </el-button>
      <el-button
        plain
        :disabled="restoring"
        :title="restoring ? '正在恢复备份，请稍候' : undefined"
        :aria-describedby="restoring ? 'backup-restoring-reason' : undefined"
        aria-label="关闭备份文件错误"
        @click="dismissFileError"
      >关闭</el-button>
    </div>
  </section>

  <section
    v-if="actionError"
    id="backup-action-error"
    ref="actionErrorEl"
    class="data-load-state"
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
    tabindex="-1"
  >
    <div class="data-load-state__content">
      <h2>备份操作失败</h2>
      <p>{{ actionError }}</p>
    </div>
    <div class="import-failure-actions">
      <el-button
        v-if="lastFailedAction === 'restore'"
        type="primary"
        :loading="restoring"
        :disabled="accessState.restoreLocked"
        :title="accessState.restoreLocked ? backupWriteLockReason : undefined"
        :aria-describedby="accessState.restoreLocked ? 'backup-failure-write-reason' : 'backup-action-error'"
        aria-label="重试恢复备份"
        @click="onRetryRestore"
      >
        重试恢复
      </el-button>
      <el-button
        v-else
        type="primary"
        :loading="creating"
        :disabled="accessState.createLocked"
        :title="accessState.createLocked ? backupWriteLockReason : undefined"
        :aria-describedby="accessState.createLocked ? 'backup-failure-write-reason' : 'backup-action-error'"
        aria-label="重试创建备份"
        @click="onCreateBackup"
      >
        重试创建备份
      </el-button>
      <el-button
        plain
        :disabled="restoring || creating"
        :title="(restoring || creating) ? backupWriteLockReason : undefined"
        :aria-describedby="(restoring || creating) ? 'backup-failure-write-reason' : undefined"
        aria-label="关闭备份操作错误"
        @click="dismissActionError"
      >关闭</el-button>
    </div>
  </section>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'

const props = defineProps({
  listError: { type: String, default: '' },
  listIsStale: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  fileError: { type: String, default: '' },
  fileErrorName: { type: String, default: '' },
  actionError: { type: String, default: '' },
  lastFailedAction: { type: String, default: '' },
  creating: { type: Boolean, default: false },
  restoring: { type: Boolean, default: false },
  accessState: { type: Object, required: true },
  backupWriteLockReason: { type: String, default: '' },
  loadBackups: { type: Function, required: true },
  triggerFileSelect: { type: Function, required: true },
  dismissFileError: { type: Function, required: true },
  onRetryRestore: { type: Function, required: true },
  onCreateBackup: { type: Function, required: true },
  dismissActionError: { type: Function, required: true },
})

const fileErrorEl = ref(null)
const actionErrorEl = ref(null)

watch(
  () => [props.fileError, props.actionError],
  async (current, previous = []) => {
    const [fileError, actionError] = current
    const [prevFile, prevAction] = previous
    if (!fileError && !actionError) return
    await nextTick()
    if (fileError && fileError !== prevFile) {
      fileErrorEl.value?.focus?.()
      return
    }
    if (actionError && actionError !== prevAction) {
      actionErrorEl.value?.focus?.()
    }
  },
)
</script>

<style scoped src="./backupPage.css"></style>