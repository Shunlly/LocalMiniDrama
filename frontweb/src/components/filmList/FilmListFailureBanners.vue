<template>
  <section
    v-if="listError"
    id="project-list-load-error"
    ref="listErrorEl"
    class="data-load-state"
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
    tabindex="-1"
  >
    <div class="data-load-state__content">
      <h2>{{ listIsStale ? '项目列表刷新失败' : '项目数据加载失败' }}</h2>
      <p>暂时无法确认服务器中的最新项目。您的项目数据没有被删除。</p>
      <p v-if="listIsStale" class="data-load-state__stale">下方显示上次成功加载的数据，当前内容已过期；成功重试前不能新增、导入、编辑或移除项目。</p>
      <p v-else class="data-load-state__detail">请先重试加载。成功后即可新建或导入项目。</p>
      <p class="data-load-state__detail">错误详情：{{ listError }}</p>
    </div>
    <el-button type="primary" plain :loading="loading" :aria-label="loading ? '正在加载项目列表' : '重试加载'" @click="loadList">
      <el-icon><RefreshLeft /></el-icon>重试加载
    </el-button>
  </section>

  <section
    v-if="exportFailure"
    ref="exportFailureEl"
    class="export-failure-state"
    role="alert"
    aria-live="assertive"
    tabindex="-1"
  >
    <div>
      <strong>项目“{{ exportFailure.drama.title || '未命名项目' }}”导出失败</strong>
      <p>{{ exportFailure.message }}。项目内容未受影响，可以重试。</p>
    </div>
    <el-tooltip :content="exportingId !== null && exportingId !== exportFailure.drama.id ? '正在导出其他项目，请稍候' : ''" :disabled="!(exportingId !== null && exportingId !== exportFailure.drama.id)" placement="top">
      <span
        class="tooltip-trigger"
        :tabindex="exportingId !== null && exportingId !== exportFailure.drama.id ? 0 : undefined"
        :aria-label="exportingId !== null && exportingId !== exportFailure.drama.id ? '重试导出不可用：正在导出其他项目，请稍候' : undefined"
        :aria-describedby="exportingId !== null && exportingId !== exportFailure.drama.id ? 'project-export-busy-reason' : undefined"
      >
        <p v-if="exportingId !== null && exportingId !== exportFailure.drama.id" id="project-export-busy-reason" class="visually-hidden">正在导出其他项目，请稍候</p>
    <el-button
      type="primary"
      plain
      :loading="exportingId === exportFailure.drama.id"
      :disabled="exportingId !== null && exportingId !== exportFailure.drama.id"
      :title="exportingId !== null && exportingId !== exportFailure.drama.id ? '正在导出其他项目，请稍候' : undefined"
      :aria-describedby="exportingId !== null && exportingId !== exportFailure.drama.id ? 'project-export-busy-reason' : undefined"
      :aria-label="exportingId === exportFailure.drama.id ? '正在导出项目包' : (exportingId !== null && exportingId !== exportFailure.drama.id ? '正在导出其他项目，请稍候' : '重试导出项目包')" @click="onExport(exportFailure.drama)"
    >
      <el-icon><RefreshLeft /></el-icon>重试导出
    </el-button>
      </span>
    </el-tooltip>
  </section>

  <section
    v-if="importFailure"
    ref="importFailureEl"
    class="export-failure-state import-failure-state"
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
    tabindex="-1"
  >
    <div>
      <strong>项目包导入失败</strong>
      <p class="import-failure-filename">文件：{{ importFailure.fileName }}</p>
      <p>{{ importFailure.message }}</p>
    </div>
    <div class="import-failure-actions">
      <el-tooltip :content="listWriteLockReason" :disabled="!listWriteLocked" placement="top">
        <span
          class="tooltip-trigger"
          :tabindex="listWriteLocked ? 0 : undefined"
          :aria-label="listWriteLocked ? `重新选择项目包不可用：${listWriteLockReason}` : undefined"
          :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined"
        >
      <el-button
        type="primary"
        plain
        :loading="importing"
        :disabled="listWriteLocked"
        :title="listWriteLocked ? listWriteLockReason : undefined"
        :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined"
        :aria-label="importing ? '正在导入项目包' : (listWriteLocked ? `重新选择项目包不可用：${listWriteLockReason}` : '重新选择项目包')" @click="triggerImport"
      >
        <el-icon><RefreshLeft /></el-icon>重新选择项目包
      </el-button>
        </span>
      </el-tooltip>
      <el-tooltip :content="importing ? '正在导入项目包，请稍候' : ''" :disabled="!importing" placement="top">
        <span
          class="tooltip-trigger"
          :tabindex="importing ? 0 : undefined"
          :aria-label="importing ? '关闭导入失败提示不可用：正在导入项目包，请稍候' : undefined"
        >
          <el-button plain :disabled="importing" :title="importing ? '正在导入项目包，请稍候' : undefined" :aria-label="importing ? '正在导入项目包，请稍候' : '关闭导入失败提示'" @click="dismissImportFailure">
            关闭
          </el-button>
        </span>
      </el-tooltip>
    </div>
  </section>
  </template>

<script setup>
// 项目列表失败横幅：加载、导出和导入失败，保留 assertive 播报
import { nextTick, ref, watch } from 'vue'
import { RefreshLeft } from '@element-plus/icons-vue'

const props = defineProps({
  listError: { type: String, default: '' },
  listIsStale: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  exportFailure: { default: null },
  exportingId: { default: null },
  importFailure: { default: null },
  importing: { type: Boolean, default: false },
  listWriteLocked: { type: Boolean, default: false },
  listWriteLockReason: { type: String, default: '' },
  loadList: { type: Function, required: true },
  onExport: { type: Function, required: true },
  triggerImport: { type: Function, required: true },
  dismissImportFailure: { type: Function, required: true },
})

const listErrorEl = ref(null)
const exportFailureEl = ref(null)
const importFailureEl = ref(null)

watch(
  () => [props.listError, props.exportFailure, props.importFailure],
  async (current, previous = []) => {
    const [listError, exportFailure, importFailure] = current
    const [prevListError, prevExport, prevImport] = previous
    if (!listError && !exportFailure && !importFailure) return
    await nextTick()
    if (importFailure && importFailure !== prevImport) {
      importFailureEl.value?.focus?.()
      return
    }
    if (exportFailure && exportFailure !== prevExport) {
      exportFailureEl.value?.focus?.()
      return
    }
    if (listError && listError !== prevListError) {
      listErrorEl.value?.focus?.()
    }
  },
)
</script>

<style scoped>
.data-load-state,
.export-failure-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 24px;
  margin-bottom: 18px;
  padding: 16px 18px;
  border: 1px solid rgba(248, 113, 113, 0.45);
  border-left: 4px solid #f87171;
  border-radius: 8px;
  background: rgba(127, 29, 29, 0.16);
  color: #fecaca;
}
.export-failure-state {
  border-color: rgba(251, 191, 36, 0.42);
  border-left-color: #fbbf24;
  background: rgba(120, 53, 15, 0.14);
  color: #fde68a;
}
.data-load-state__content,
.export-failure-state > div {
  min-width: 0;
}
.import-failure-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.import-failure-filename {
  color: inherit;
  overflow-wrap: anywhere;
}
.data-load-state h2,
.export-failure-state strong {
  display: block;
  margin: 0 0 5px;
  color: #fff7ed;
  font-size: 0.96rem;
  line-height: 1.4;
}
.data-load-state p,
.export-failure-state p {
  margin: 3px 0 0;
  font-size: 0.84rem;
  line-height: 1.55;
}
.data-load-state__stale {
  color: #fde68a;
}
.data-load-state__detail {
  color: #fca5a5;
  overflow-wrap: anywhere;
}
html.light .data-load-state,
html.light .export-failure-state {
  background: #fff7ed;
  border-color: #fdba74;
  border-left-color: #dc2626;
  color: #9a3412;
}
html.light .export-failure-state {
  background: #fffbeb;
  border-color: #fcd34d;
  border-left-color: #d97706;
  color: #92400e;
}
html.light .data-load-state h2,
html.light .export-failure-state strong {
  color: #7f1d1d;
}
html.light .data-load-state__stale { color: #92400e; }
html.light .data-load-state__detail { color: #b91c1c; }
.data-load-state:focus-visible,
.export-failure-state:focus-visible {
  outline: 2px solid #fbbf24;
  outline-offset: 2px;
}
.tooltip-trigger { display: inline-flex; }
.tooltip-trigger:focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; }
@media (max-width: 620px) {
  .data-load-state,
  .export-failure-state {
    align-items: stretch;
    flex-direction: column;
  }
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
