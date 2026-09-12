<template>
  <section
    v-if="readinessError"
    id="backup-readiness-error"
    class="data-load-state"
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
  >
    <span v-if="readinessLoading" id="backup-readiness-loading-reason" class="visually-hidden">维护状态正在加载，请稍候</span>
    <div class="data-load-state__content">
      <h2>{{ hasSuccessfulReadinessLoad ? '维护状态刷新失败' : '维护状态加载失败' }}</h2>
      <p>暂时无法确认维护租约。这不会删除已有备份。</p>
      <p class="data-load-state__hint" data-testid="backup-readiness-ready-hint">{{ BACKUP_READY_NOT_SPA_HINT }}</p>
      <p
        v-if="readinessLooksLikeSpaHtml"
        class="data-load-state__detail"
        data-testid="backup-readiness-spa-html"
      >{{ BACKUP_READY_SPA_HTML_MESSAGE }}</p>
      <p v-if="hasSuccessfulReadinessLoad" class="data-load-state__stale">下方显示上次成功读取的维护状态，当前内容已过期。</p>
      <p v-else>维护正常空态不会在连接恢复前显示。</p>
      <p
        v-if="!readinessLooksLikeSpaHtml"
        class="data-load-state__detail"
      >错误详情：{{ readinessDisplayError }}</p>
    </div>
    <el-button
      type="primary"
      plain
      :loading="readinessLoading"
      :disabled="readinessLoading"
      :title="readinessLoading ? '维护状态正在加载，请稍候' : undefined"
      :aria-describedby="readinessLoading ? 'backup-readiness-loading-reason' : 'backup-readiness-error'"
      aria-label="重试加载维护状态"
      @click="loadReadiness"
    >
      <el-icon aria-hidden="true"><Refresh /></el-icon>重试加载
    </el-button>
  </section>
  <section
    v-else-if="readinessLoading && !hasSuccessfulReadinessLoad"
    class="maintenance-status"
    role="status"
    aria-live="polite"
    data-testid="backup-readiness-loading"
  >
    <strong>正在确认维护租约</strong>
    <p>请稍候，正在确认当前能否安全执行备份或恢复。</p>
  </section>
  <section
    v-if="hasSuccessfulReadinessLoad && readiness"
    class="maintenance-status"
    :class="{
      'is-ready': readiness.ready,
      'is-blocked': !readiness.ready,
      'is-stale': Boolean(readinessError) || readinessLoading,
    }"
    :role="readiness.ready ? 'status' : 'alert'"
    aria-live="polite"
    data-testid="backup-readiness-status"
  >
    <strong>{{ readiness.ready ? '维护租约正常' : '维护租约不可用' }}</strong>
    <p v-if="readinessLoading" class="data-load-state__stale">正在刷新维护状态。</p>
    <p v-else-if="readinessError" class="data-load-state__stale">当前内容已过期，以上为上次成功读取的维护状态。</p>
    <p v-if="!readiness.ready">{{ readiness.maintenanceError || '当前不能安全执行备份或恢复。' }}</p>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import {
  BACKUP_READY_NOT_SPA_HINT,
  BACKUP_READY_SPA_HTML_MESSAGE,
  describeBackupReadinessDisplayError,
  looksLikeBackupReadySpaHtmlFailure,
} from './backupPageCopy.js'

const props = defineProps({
  readinessError: { type: String, default: '' },
  readinessLoading: { type: Boolean, default: false },
  hasSuccessfulReadinessLoad: { type: Boolean, default: false },
  readiness: { default: null },
  loadReadiness: { type: Function, required: true },
})

const readinessLooksLikeSpaHtml = computed(() => looksLikeBackupReadySpaHtmlFailure(props.readinessError))
const readinessDisplayError = computed(() => describeBackupReadinessDisplayError(props.readinessError))
</script>

<style scoped src="./backupPage.css"></style>
