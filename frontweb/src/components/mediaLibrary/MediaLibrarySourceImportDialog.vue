<template>
  <AccessibleDialog
    v-model="showPicker"
    title="选择目标项目"
    width="520px"
    destroy-on-close
    @open="loadProjects"
    @closed="resetPicker"
  >
    <div class="source-import-picker">
      <p class="source-import-copy">网页 URL 导入需要先选定目标项目。选定后会进入该项目的故事素材流程。</p>
      <span v-if="pickerBusyReason" id="source-import-picker-reason" class="visually-hidden">{{ pickerBusyReason }}</span>
      <el-input
        v-model="keyword"
        class="source-import-search"
        clearable
        placeholder="搜索项目标题"
        aria-label="搜索项目"
        :disabled="navigationLocked"
        :title="navigationLocked ? pickerBusyReason : undefined"
        :aria-describedby="navigationLocked ? 'source-import-picker-reason' : undefined"
        @input="scheduleSearch"
      />
      <section
        v-if="loadError"
        class="source-import-state source-import-state--error"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        <h2>项目列表加载失败</h2>
        <p>{{ loadError }}</p>
        <el-button type="primary" plain :loading="loading" :disabled="loading || navigationLocked" :title="pickerBusyReason || undefined" :aria-describedby="pickerBusyReason ? 'source-import-picker-reason' : undefined" :aria-label="pickerBusyReason || '重试加载项目列表'" @click="loadProjects">
          重试
        </el-button>
      </section>
      <p
        v-else-if="loading && !hasSuccessfulLoad"
        class="source-import-state"
        role="status"
        aria-live="polite"
      >正在加载项目列表</p>
      <div
        v-else-if="hasSuccessfulLoad && projects.length === 0"
        class="source-import-state"
        role="status"
        aria-live="polite"
      >
        <h2>{{ keyword.trim() ? '没有匹配的项目' : '还没有可导入的项目' }}</h2>
        <p>{{ keyword.trim() ? '请更换关键词后再试。' : '请先新建项目，再回到素材中心选择目标项目。' }}</p>
        <el-button
          v-if="keyword.trim()"
          aria-label="清除搜索"
          @click="keyword = ''; scheduleSearch()"
        >清除搜索</el-button>
        <el-button v-else type="primary" :disabled="navigationLocked" :title="navigationLocked ? pickerBusyReason : undefined" :aria-describedby="navigationLocked ? 'source-import-picker-reason' : undefined" :aria-label="navigationLocked ? `新建项目后导入网页 URL不可用：${pickerBusyReason}` : '新建项目后导入网页 URL'" @click="createProjectFromPicker">
          新建项目
        </el-button>
      </div>
      <ul
        v-else-if="projects.length > 0"
        class="source-import-list"
        aria-label="可选项目"
        :aria-busy="loading"
      >
        <li v-for="item in projects" :key="item.id" class="source-import-item">
          <el-button
            class="source-import-project"
            :disabled="loading || navigationLocked"
            :title="pickerBusyReason || undefined"
            :aria-describedby="pickerBusyReason ? 'source-import-picker-reason' : undefined"
            :aria-label="pickerBusyReason ? `${describeProjectAction(item)}不可用：${pickerBusyReason}` : describeProjectAction(item)"
            @click="selectProject(item)"
          >
            <span class="source-import-title">{{ item.title || '未命名项目' }}</span>
            <span v-if="item.episodeCount != null" class="source-import-meta">{{ item.episodeCount }} 集</span>
          </el-button>
        </li>
      </ul>
      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        class="source-import-pagination"
        aria-label="项目列表分页"
        @current-change="loadProjectPage"
      />
    </div>
    <template #footer>
      <el-button aria-label="取消选择项目" @click="showPicker = false">取消</el-button>
      <el-button :disabled="navigationLocked" :title="navigationLocked ? pickerBusyReason : undefined" :aria-describedby="navigationLocked ? 'source-import-picker-reason' : undefined" :aria-label="navigationLocked ? `新建项目后导入网页 URL不可用：${pickerBusyReason}` : '新建项目后导入网页 URL'" @click="createProjectFromPicker">新建项目</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
// 仅展示目标项目选择；加载、搜索和跳转仍由素材中心页处理。
import { computed } from 'vue'
import { describeMediaLibrarySourceImportProjectAction } from '@/utils/mediaLibrarySourceImport.js'
import { MEDIA_LIBRARY_DISABLE_REASON } from '@/utils/mediaLibraryUserError.js'

const showPicker = defineModel('showPicker', { type: Boolean, default: false })
const keyword = defineModel('keyword', { type: String, default: '' })
const page = defineModel('page', { type: Number, default: 1 })

const props = defineProps({
  loading: { type: Boolean, default: false },
  loadError: { type: String, default: '' },
  projects: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  pageSize: { type: Number, default: 24 },
  hasSuccessfulLoad: { type: Boolean, default: false },
  navigationLocked: { type: Boolean, default: false },
  navigationLockReason: { type: String, default: '' },
  loadProjects: { type: Function, required: true },
  scheduleSearch: { type: Function, required: true },
  loadProjectPage: { type: Function, required: true },
  selectProject: { type: Function, required: true },
  createProjectFromPicker: { type: Function, required: true },
  resetPicker: { type: Function, required: true },
})

const describeProjectAction = describeMediaLibrarySourceImportProjectAction
const pickerBusyReason = computed(() => {
  if (props.navigationLocked) return props.navigationLockReason || MEDIA_LIBRARY_DISABLE_REASON.uploading
  if (props.loading) return '正在加载项目列表，请稍候'
  return ''
})
</script>

<style scoped>
.source-import-picker {
  display: grid;
  gap: 12px;
}

.source-import-copy,
.source-import-state p {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.source-import-state {
  display: grid;
  justify-items: start;
  gap: 8px;
  padding: 12px 0;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
.source-import-state h2,
.source-import-state p {
  max-width: 100%;
  overflow-wrap: anywhere;
}
.source-import-state :deep(.el-button) {
  white-space: normal;
  height: auto;
  max-width: 100%;
}

.source-import-state h2 {
  margin: 0;
  color: var(--text-bright);
  font-size: 15px;
}

.source-import-state--error {
  color: var(--el-color-danger);
}

.source-import-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.source-import-project {
  width: 100%;
  height: auto;
  min-height: 44px;
  justify-content: space-between;
  padding: 10px 12px;
}

.source-import-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.source-import-meta {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 12px;
}

.source-import-pagination {
  justify-self: center;
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
