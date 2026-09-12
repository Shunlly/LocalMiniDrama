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
      <el-input
        v-model="keyword"
        class="source-import-search"
        clearable
        placeholder="搜索项目标题"
        aria-label="搜索项目"
        :disabled="navigationLocked"
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
        <el-button type="primary" plain :loading="loading" :disabled="loading || navigationLocked" aria-label="重试加载项目列表" @click="loadProjects">
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
          aria-label="清除项目搜索"
          @click="keyword = ''; scheduleSearch()"
        >清除搜索</el-button>
        <el-button v-else type="primary" :disabled="navigationLocked" aria-label="新建项目后导入网页 URL" @click="createProjectFromPicker">
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
            :aria-label="describeProjectAction(item)"
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
      <el-button :disabled="navigationLocked" aria-label="新建项目后导入网页 URL" @click="createProjectFromPicker">新建项目</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
// 仅展示目标项目选择；加载、搜索和跳转仍由素材中心页处理。
import { describeMediaLibrarySourceImportProjectAction } from '@/utils/mediaLibrarySourceImport.js'

const showPicker = defineModel('showPicker', { type: Boolean, default: false })
const keyword = defineModel('keyword', { type: String, default: '' })
const page = defineModel('page', { type: Number, default: 1 })

defineProps({
  loading: { type: Boolean, default: false },
  loadError: { type: String, default: '' },
  projects: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  pageSize: { type: Number, default: 24 },
  hasSuccessfulLoad: { type: Boolean, default: false },
  navigationLocked: { type: Boolean, default: false },
  loadProjects: { type: Function, required: true },
  scheduleSearch: { type: Function, required: true },
  loadProjectPage: { type: Function, required: true },
  selectProject: { type: Function, required: true },
  createProjectFromPicker: { type: Function, required: true },
  resetPicker: { type: Function, required: true },
})

const describeProjectAction = describeMediaLibrarySourceImportProjectAction
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
</style>
