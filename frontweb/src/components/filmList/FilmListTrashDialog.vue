<template>
  <AccessibleDialog
    v-model="showTrashDialog"
    title="项目回收站"
    width="680px"
    :style="{ maxWidth: 'calc(100vw - 32px)' }"
    destroy-on-close
    @open="loadTrash"
  >
    <div class="trash-policy" role="note">
      <el-icon class="trash-policy-icon" aria-hidden="true"><FolderOpened /></el-icon>
      <div>
        <strong>移除后仍可恢复</strong>
        <p>项目内容、剧集、分镜和关联素材会完整保留。恢复项目后可继续编辑和生成。</p>
      </div>
    </div>
    <div v-loading="trashLoading" class="trash-dialog-content">
      <div v-if="trashError" class="trash-error" role="alert">
        <p>{{ trashError }}</p>
        <el-button type="primary" plain size="small" :loading="trashLoading" :aria-label="trashLoading ? '正在加载回收站' : '重试加载回收站'" @click="loadTrash">
          <el-icon><RefreshLeft /></el-icon>重试
        </el-button>
      </div>
      <div
        v-if="!trashLoading && !trashError && trashItems.length === 0"
        class="trash-empty"
        role="status"
        aria-live="polite"
      >
        <el-icon aria-hidden="true"><Delete /></el-icon>
        <p>回收站中没有项目</p>
        <p class="trash-empty-next">关闭后可回到项目列表新建或导入项目。</p>
        <el-button aria-label="关闭回收站" @click="showTrashDialog = false">关闭回收站</el-button>
      </div>
      <ul v-if="trashItems.length > 0" class="trash-list" aria-label="已移除项目">
        <li v-for="item in trashItems" :key="item.id" class="trash-list-item">
          <div class="trash-item-main">
            <h3 class="trash-item-title">{{ item.title || '未命名项目' }}</h3>
            <p class="trash-item-meta">
              移入时间：<time :datetime="item.removed_at || ''">{{ formatDate(item.removed_at) }}</time>
            </p>
            <p class="trash-item-retention">内容与关联素材已保留</p>
          </div>
          <el-tooltip :content="describeTrashRestoreBusyReason(restoringId, item.id)" :disabled="!describeTrashRestoreBusyReason(restoringId, item.id)" placement="top">
            <span
              class="tooltip-trigger"
              :tabindex="describeTrashRestoreBusyReason(restoringId, item.id) ? 0 : undefined"
              :aria-label="describeTrashRestoreBusyReason(restoringId, item.id) ? `恢复项目「${item.title || '未命名项目'}」不可用：${describeTrashRestoreBusyReason(restoringId, item.id)}` : undefined"
              :aria-describedby="describeTrashRestoreBusyReason(restoringId, item.id) ? `trash-restore-reason-${item.id}` : undefined"
            >
              <span
                v-if="describeTrashRestoreBusyReason(restoringId, item.id)"
                :id="`trash-restore-reason-${item.id}`"
                class="visually-hidden"
              >{{ describeTrashRestoreBusyReason(restoringId, item.id) }}</span>
          <el-button
            class="trash-restore-button"
            type="primary"
            plain
            :loading="restoringId === item.id"
            :disabled="restoringId !== null && restoringId !== item.id"
            :title="describeTrashRestoreBusyReason(restoringId, item.id) || undefined"
            :aria-describedby="describeTrashRestoreBusyReason(restoringId, item.id) ? `trash-restore-reason-${item.id}` : undefined"
            :aria-label="`恢复项目「${item.title || '未命名项目'}」`"
            @click="restoreFromTrash(item)"
          >
            <el-icon><RefreshLeft /></el-icon>恢复
          </el-button>
            </span>
          </el-tooltip>
        </li>
      </ul>
      <p class="trash-live-status" role="status" aria-live="polite">
        {{ describeTrashLiveStatus({ announcement: trashAnnouncement, loading: trashLoading, total: trashTotal }) }}
      </p>
    </div>
    <el-pagination
      v-if="trashTotal > trashPageSize"
      v-model:current-page="trashPage"
      :page-size="trashPageSize"
      :total="trashTotal"
      layout="total, prev, pager, next"
      class="trash-pagination"
      aria-label="回收站分页"
      @current-change="loadTrash"
    />
    <template #footer>
      <el-button aria-label="关闭回收站" @click="showTrashDialog = false">关闭</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
// 仅展示项目回收站弹窗；加载和恢复仍由项目列表页处理。
import { Delete, FolderOpened, RefreshLeft } from '@element-plus/icons-vue'

const showTrashDialog = defineModel('showTrashDialog', { type: Boolean, default: false })
const trashPage = defineModel('trashPage', { type: Number, default: 1 })

defineProps({
  trashLoading: { type: Boolean, default: false },
  trashError: { type: String, default: '' },
  trashItems: { type: Array, default: () => [] },
  trashTotal: { type: Number, default: 0 },
  trashPageSize: { type: Number, default: 10 },
  trashAnnouncement: { type: String, default: '' },
  restoringId: { default: null },
  formatDate: { type: Function, required: true },
  describeTrashLiveStatus: { type: Function, required: true },
  describeTrashRestoreBusyReason: { type: Function, required: true },
  loadTrash: { type: Function, required: true },
  restoreFromTrash: { type: Function, required: true },
})
</script>

<style scoped>
.trash-policy {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 18px;
  padding: 12px 14px;
  border-left: 3px solid #2dd4bf;
  background: rgba(20, 184, 166, 0.08);
}
.trash-policy-icon {
  margin-top: 2px;
  flex: 0 0 auto;
  color: #5eead4;
  font-size: 20px;
}
.trash-policy strong {
  display: block;
  color: #f4f4f5;
  font-size: 0.92rem;
  line-height: 1.4;
}
.trash-policy p {
  margin: 4px 0 0;
  color: #a1a1aa;
  font-size: 0.84rem;
  line-height: 1.55;
}
.trash-dialog-content {
  min-height: 180px;
}
.trash-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid #303038;
}
.trash-list-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  min-height: 108px;
  padding: 16px 2px;
  border-bottom: 1px solid #303038;
}
.trash-item-main {
  min-width: 0;
}
.trash-item-title {
  margin: 0 0 6px;
  overflow: hidden;
  color: #f4f4f5;
  font-size: 0.98rem;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trash-item-meta,
.trash-item-retention {
  margin: 0;
  color: #a1a1aa;
  font-size: 0.8rem;
  line-height: 1.55;
}
.trash-item-retention {
  color: #5eead4;
}
.trash-restore-button {
  min-width: 92px;
}
.trash-empty {
  min-height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #71717a;
}
.trash-empty .el-icon {
  font-size: 28px;
}
.trash-empty p,
.trash-error,
.trash-live-status {
  margin: 0;
}
.trash-empty-next {
  max-width: 280px;
  line-height: 1.5;
}
.tooltip-trigger { display: inline-flex; }
.tooltip-trigger:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
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
.trash-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-left: 3px solid #f87171;
  background: rgba(239, 68, 68, 0.08);
  color: #fca5a5;
}
.trash-error p {
  margin: 0;
}
.trash-live-status {
  min-height: 20px;
  margin-top: 12px;
  color: #a1a1aa;
  font-size: 0.8rem;
}
.trash-pagination {
  margin-top: 14px;
  justify-content: center;
}

html.light .trash-policy {
  background: #ecfdf5;
  border-left-color: #0f766e;
}
html.light .trash-policy-icon,
html.light .trash-item-retention { color: #0f766e; }
html.light .trash-policy strong,
html.light .trash-item-title { color: #20242c; }
html.light .trash-policy p,
html.light .trash-item-meta,
html.light .trash-live-status { color: #5b6470; }
html.light .trash-list,
html.light .trash-list-item { border-color: #e1e5eb; }
html.light .trash-empty { color: #6b7280; }
html.light .trash-error {
  background: #fef2f2;
  color: #b91c1c;
}
</style>
