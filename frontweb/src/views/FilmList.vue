<template>
  <div class="film-list">
    <header class="header">
      <div class="header-inner">
        <h1 class="logo">
          <span class="logo-main">本地短剧助手</span>
          <span class="logo-sub">LocalMiniDrama</span>
        </h1>
        <!-- 素材入口：通用媒体为一级入口，语义素材保留在分类菜单中 -->
        <div class="header-library">
          <el-button class="btn-library btn-material-center" title="打开素材中心" @click="goMaterialCenter">
            <el-icon><Files /></el-icon>素材中心
          </el-button>
          <el-dropdown :disabled="listWriteLocked" trigger="click" placement="bottom-start" @command="openSemanticLibrary">
            <el-button class="btn-library btn-semantic-library" :disabled="listWriteLocked">
              <el-icon><Collection /></el-icon>分类素材
              <el-icon class="dropdown-caret"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="character"><el-icon><User /></el-icon>角色素材库</el-dropdown-item>
                <el-dropdown-item command="scene"><el-icon><PictureFilled /></el-icon>场景素材库</el-dropdown-item>
                <el-dropdown-item command="prop"><el-icon><Box /></el-icon>道具素材库</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <!-- 右侧操作区 -->
        <div class="header-actions">
          <el-button class="btn-library" title="打开自由创作" @click="router.push({ name: 'free-create' })">
            <el-icon><MagicStick /></el-icon>自由创作
          </el-button>
          <el-tooltip content="项目回收站" placement="bottom">
            <el-button class="btn-trash utility-icon-button" title="项目回收站" aria-label="打开项目回收站" @click="openTrash">
              <el-icon><Delete /></el-icon>
              <span class="visually-hidden">打开项目回收站</span>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="isDark ? '切换到浅色模式' : '切换到暗色模式'" placement="bottom">
            <el-button class="btn-theme utility-icon-button" :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" :aria-label="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="toggleTheme">
              <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
              <span class="visually-hidden">{{ isDark ? '切换到浅色模式' : '切换到暗色模式' }}</span>
            </el-button>
          </el-tooltip>
          <el-button class="btn-settings" title="打开 AI 配置" @click="showAiConfigDialog = true">
            <el-icon><Setting /></el-icon>AI配置
          </el-button>
          <el-button ref="importTriggerButton" class="btn-import" :loading="importing" :disabled="listWriteLocked" @click="triggerImport">
            <el-icon><Upload /></el-icon>导入项目包
          </el-button>
          <input ref="importFileInput" type="file" accept=".zip" style="display:none" @change="onImportFile" />
          <el-button type="primary" class="btn-new" :disabled="listWriteLocked" aria-label="新建项目" @click="goNewProject">
            <el-icon><Plus /></el-icon>新建项目
          </el-button>
        </div>
      </div>
    </header>

    <main class="main">
      <section v-if="sourceImportIntent" class="source-import-intent" role="status" aria-live="polite">
        <span>选择已有项目后导入网页 URL，或新建项目后继续。</span>
        <el-button type="primary" size="small" :disabled="listWriteLocked" aria-label="新建项目" @click="openSourceImportProject">
          <el-icon><Plus /></el-icon>新建项目
        </el-button>
      </section>
      <div v-loading="loading" class="projects-wrap" :aria-busy="loading">
        <section
          v-if="listError"
          class="data-load-state"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <div class="data-load-state__content">
            <h2>{{ listIsStale ? '项目列表刷新失败' : '项目数据加载失败' }}</h2>
            <p>暂时无法确认服务器中的最新项目。您的项目数据没有被删除。</p>
            <p v-if="listIsStale" class="data-load-state__stale">下方显示上次成功加载的数据，当前内容已过期；成功重试前不能新增、导入、编辑或移除项目。</p>
            <p v-else class="data-load-state__detail">项目空态不会在连接恢复前显示，也不会执行任何项目写操作。</p>
            <p class="data-load-state__detail">错误详情：{{ listError }}</p>
          </div>
          <el-button type="primary" plain :loading="loading" @click="loadList">
            <el-icon><RefreshLeft /></el-icon>重试加载
          </el-button>
        </section>

        <section
          v-if="exportFailure"
          class="export-failure-state"
          role="alert"
          aria-live="assertive"
        >
          <div>
            <strong>项目“{{ exportFailure.drama.title || '未命名项目' }}”导出失败</strong>
            <p>{{ exportFailure.message }}。项目内容未受影响，可以重试。</p>
          </div>
          <el-button
            type="primary"
            plain
            :loading="exportingId === exportFailure.drama.id"
            :disabled="exportingId !== null && exportingId !== exportFailure.drama.id"
            @click="onExport(exportFailure.drama)"
          >
            <el-icon><RefreshLeft /></el-icon>重试导出
          </el-button>
        </section>

        <section
          v-if="importFailure"
          class="export-failure-state import-failure-state"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <div>
            <strong>项目包导入失败</strong>
            <p class="import-failure-filename">文件：{{ importFailure.fileName }}</p>
            <p>{{ importFailure.message }}</p>
          </div>
          <div class="import-failure-actions">
            <el-button
              type="primary"
              plain
              :loading="importing"
              :disabled="listWriteLocked"
              @click="triggerImport"
            >
              <el-icon><RefreshLeft /></el-icon>重新选择项目包
            </el-button>
            <el-button plain :disabled="importing" @click="dismissImportFailure">
              关闭
            </el-button>
          </div>
        </section>

        <section
          v-if="hasSuccessfulListLoad && !listError && (dramas.length > 0 || hasProjectFilters)"
          class="workspace-overview"
          aria-labelledby="project-list-title"
        >
            <div class="workspace-copy">
              <h2 id="project-list-title" class="workspace-title">项目列表</h2>
              <p class="workspace-count">
              {{ projectListCountLabel }}
              </p>
            </div>
          <div class="workspace-controls" role="search" aria-label="项目列表筛选">
            <el-input
              v-model="projectSearch"
              class="workspace-search"
              clearable
              placeholder="搜索项目标题、描述、风格或类型"
              aria-label="搜索项目"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-select
              v-model="projectStatusFilter"
              class="workspace-status"
              aria-label="按项目状态筛选"
            >
              <el-option label="全部状态" value="all" />
              <el-option label="草稿" value="draft" />
              <el-option label="生成中" value="generating" />
              <el-option label="已发布" value="published" />
            </el-select>
            <el-select
              v-model="projectSort"
              class="workspace-sort"
              aria-label="项目排序"
            >
              <el-option label="更新时间优先" value="updated-desc" />
              <el-option label="创建时间优先" value="created-desc" />
              <el-option label="标题升序" value="title-asc" />
            </el-select>
          </div>
        </section>

        <div class="project-grid">
          <!-- 空项目时提供完整起步路径；已有项目时使用顶部主操作，避免重复入口。 -->
          <section v-if="!loading && hasSuccessfulListLoad && !listError && dramas.length === 0 && !hasProjectFilters" class="action-card action-card--empty">
            <div class="action-card-inner">
              <h2 class="action-card-title">还没有短剧项目</h2>
              <p class="action-card-desc">新建空白项目，或继续已有项目包。</p>
              <div class="action-card-buttons">
                <el-button type="primary" size="large" class="action-btn action-btn-new" :disabled="listWriteLocked" aria-label="新建项目" @click="goNewProject">
                  <el-icon><Plus /></el-icon>新建项目
                </el-button>
                <el-button size="large" class="action-btn action-btn-import" :loading="importing" :disabled="listWriteLocked" @click="triggerImport">
                  <el-icon><Upload /></el-icon>导入项目包
                </el-button>
              </div>
              <div class="action-card-secondary">
                <el-button class="action-btn-material" @click="goMaterialCenter">
                  <el-icon><Files /></el-icon>前往素材中心
                </el-button>
                <el-button class="action-btn-trash" @click="openTrash">
                  <el-icon><Delete /></el-icon>查看回收站
                </el-button>
              </div>
              <div v-if="exampleList.length > 0" class="action-card-example">
                <div class="example-hint">
                  <el-icon class="example-hint-icon"><QuestionFilled /></el-icon>
                  <span class="example-hint-text">新手？试试导入示例项目快速体验</span>
                </div>
                <div class="example-list">
                  <el-button
                    v-for="ex in exampleList"
                    :key="ex.filename"
                    size="small"
                    class="example-btn"
                    :loading="importingExample === ex.filename"
                    :disabled="listWriteLocked"
                    @click="onImportExample(ex)"
                  >
                    <el-icon><FolderOpened /></el-icon>{{ ex.name }}
                  </el-button>
                </div>
              </div>
            </div>
          </section>
          <section
            v-if="!loading && hasSuccessfulListLoad && !listError && hasProjectFilters && filteredDramas.length === 0"
            class="action-card action-card--empty action-card--search-empty"
            role="status"
          >
            <div class="action-card-inner">
              <h2 class="action-card-title">没有匹配的项目</h2>
              <p class="action-card-desc">换一个关键词或状态，或清除筛选后查看全部项目。</p>
              <el-button class="action-btn" @click="clearProjectFilters">
                清除筛选
              </el-button>
            </div>
          </section>
          <article
            v-for="d in filteredDramas"
            :key="d.id"
            class="project-card"
          >
            <RouterLink
              class="project-card-link"
              :to="projectCardDestination(d, sourceImportIntent, projectListReturnTo)"
              :aria-label="`打开项目「${d.title || '未命名项目'}」`"
            >
              <div class="project-card-body">
                <div class="project-card-layout">
                  <div class="project-card-cover" :class="{ 'project-card-cover--empty': !projectCoverUrl(d) }">
                    <img
                      v-if="projectCoverUrl(d)"
                      :src="projectCoverUrl(d)"
                      :alt="projectCoverAlt(d)"
                      loading="lazy"
                      @error="markProjectCoverError(d)"
                    />
                    <div v-else class="project-card-cover-placeholder" aria-hidden="true">
                      <el-icon><PictureFilled /></el-icon>
                      <span>{{ totalStoryboards(d) > 0 ? '待生成画面' : '尚无画面' }}</span>
                    </div>
                  </div>
                  <div class="project-card-content">
                    <div class="project-card-topline">
                      <span class="badge badge-status" :class="'badge-status--' + (d.status || 'draft')">{{ formatStatus(d.status) }}</span>
                      <span class="project-updated">更新于 {{ formatDate(d.updated_at || d.created_at) }}</span>
                    </div>
                    <div class="project-card-header">
                      <h3 class="project-title" :title="d.title || '未命名项目'">{{ d.title || '未命名项目' }}</h3>
                    </div>
                    <p class="project-desc">{{ d.description || '暂无描述' }}</p>
                    <div class="project-card-stats" aria-label="项目概览">
                      <span class="project-stat">
                        <strong>{{ d.episodes?.length || 0 }}</strong>
                        <span>集</span>
                      </span>
                      <span class="project-stat">
                        <strong>{{ totalStoryboards(d) }}</strong>
                        <span>分镜</span>
                      </span>
                      <span v-if="d.metadata?.aspect_ratio" class="project-stat project-stat--compact">{{ d.metadata.aspect_ratio }}</span>
                    </div>
                    <div class="project-badges">
                      <span v-if="d.style" class="badge badge-style">{{ formatStyle(d.style) }}</span>
                      <span v-if="d.genre" class="badge badge-genre">{{ formatGenre(d.genre) }}</span>
                    </div>
                    <div class="project-card-footer">
                      <p class="project-meta">创建于 {{ formatDate(d.created_at) || '未知时间' }}</p>
                      <span class="project-card-continue">{{ sourceImportIntent ? '导入网页 URL' : '继续制作' }} <el-icon aria-hidden="true"><ArrowRight /></el-icon></span>
                    </div>
                  </div>
                </div>
              </div>
            </RouterLink>
            <RouterLink
              class="project-card-assets"
              :to="{ name: 'drama-detail', params: { id: d.id }, query: { returnTo: projectListReturnTo }, hash: '#source-intake-workflow' }"
              :aria-label="`打开项目「${d.title || '未命名项目'}」的故事素材流程`"
              @click.stop
            >
              <el-icon><Files /></el-icon>故事素材
            </RouterLink>
            <el-dropdown
              class="project-card-menu"
              trigger="click"
              placement="bottom-end"
              popper-class="project-actions-dropdown"
              @click.stop
              @command="handleProjectAction($event, d)"
            >
              <el-button
                class="project-menu-button"
                text
                circle
                :loading="exportingId === d.id"
                title="项目操作"
                :aria-label="`打开项目「${d.title || '未命名项目'}」操作菜单`"
              >
                <el-icon><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="export" :disabled="exportingId === d.id">
                    <el-icon><Download /></el-icon>导出项目
                  </el-dropdown-item>
                  <el-dropdown-item command="edit" :disabled="listWriteLocked"><el-icon><Edit /></el-icon>编辑项目</el-dropdown-item>
                  <el-dropdown-item command="trash" :disabled="listWriteLocked" divided>
                    <el-icon><Delete /></el-icon>移入回收站
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </article>
        </div>
        <div
          v-if="!loading && hasSuccessfulListLoad && !listError && total > projectPageSize"
          class="project-pagination"
          aria-label="项目列表分页"
        >
          <el-pagination
            v-model:current-page="projectPage"
            v-model:page-size="projectPageSize"
            :total="total"
            :page-sizes="[12, 24, 48]"
            layout="total, sizes, prev, pager, next"
            @current-change="loadProjectPage"
            @size-change="handleProjectPageSizeChange"
          />
        </div>
      </div>
    </main>

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
          <el-button type="primary" plain size="small" :loading="trashLoading" @click="loadTrash">
            <el-icon><RefreshLeft /></el-icon>重试
          </el-button>
        </div>
        <div
          v-if="!trashLoading && !trashError && trashItems.length === 0"
          class="trash-empty"
          role="status"
        >
          <el-icon aria-hidden="true"><Delete /></el-icon>
          <p>回收站中没有项目</p>
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
            <el-button
              class="trash-restore-button"
              type="primary"
              plain
              :loading="restoringId === item.id"
              :disabled="restoringId !== null && restoringId !== item.id"
              :aria-label="`恢复项目「${item.title || '未命名项目'}」`"
              @click="restoreFromTrash(item)"
            >
              <el-icon><RefreshLeft /></el-icon>恢复
            </el-button>
          </li>
        </ul>
        <p class="trash-live-status" role="status" aria-live="polite">
          {{ trashAnnouncement || (trashLoading ? '正在加载回收站' : `回收站中共有 ${trashTotal} 个项目`) }}
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
        <el-button @click="showTrashDialog = false">关闭</el-button>
      </template>
    </AccessibleDialog>

    <!-- 新建项目：先填标题和描述 -->
    <AccessibleDialog
      v-model="showNewDialog"
      title="新建项目"
      width="480px"
      :close-on-click-modal="false"
      @closed="resetNewForm"
    >
      <el-form :model="newForm" label-width="80px" label-position="top">
        <el-form-item label="标题" required>
          <el-input v-model="newForm.title" autofocus aria-label="项目标题" placeholder="输入项目标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newForm.description" type="textarea" :rows="3" placeholder="输入项目描述（选填）" />
        </el-form-item>
        <el-form-item label="画面比例">
          <el-select v-model="newForm.aspect_ratio" aria-label="画面比例" style="width: 100%">
            <el-option label="16:9 横屏（默认）" value="16:9" />
            <el-option label="9:16 竖屏（短视频）" value="9:16" />
            <el-option label="3:4 竖版" value="3:4" />
            <el-option label="1:1 方形" value="1:1" />
            <el-option label="4:3 传统横屏" value="4:3" />
            <el-option label="21:9 宽银幕" value="21:9" />
          </el-select>
          <p style="margin: 4px 0 0; font-size: 12px; color: #71717a;">影响分镜图和视频的生成比例，短视频选 9:16</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showNewDialog = false">取消</el-button>
        <el-button type="primary" :loading="newSaving" :disabled="listWriteLocked || !newForm.title?.trim()" @click="submitNew">确定</el-button>
      </template>
    </AccessibleDialog>

    <!-- AI 配置弹窗 -->
    <AccessibleDialog
      v-model="showAiConfigDialog"
      title="AI 配置"
      width="90%"
      destroy-on-close
      :before-close="confirmAiConfigWorkspaceClose"
    >
      <AIConfigContent ref="aiConfigContentRef" v-if="showAiConfigDialog" />
    </AccessibleDialog>

    <!-- 公共角色库 -->
    <AccessibleDialog v-model="showCharLibrary" title="素材库 · 角色" width="720px" destroy-on-close class="library-dialog" @open="loadCharLibraryList">
      <div class="library-toolbar">
        <el-input v-model="charLibraryKeyword" placeholder="搜索名称或描述" aria-label="搜索角色素材" clearable style="width: 200px" @input="debouncedLoadCharLibrary()" />
      </div>
      <div v-loading="charLibraryLoading" class="library-list">
        <div v-for="item in charLibraryList" :key="item.id" class="library-item">
          <button
            v-if="assetImageUrl(item)"
            type="button"
            class="library-item-cover"
            :aria-label="`预览角色素材「${item.name || '未命名'}」图片`"
            @click="openImagePreview(assetImageUrl(item), `角色素材「${item.name || '未命名'}」预览图`)"
          >
            <img :src="assetImageUrl(item)" :alt="`角色素材「${item.name || '未命名'}」预览图`" />
          </button>
          <div v-else class="library-item-cover library-item-cover--empty">
            <span class="library-item-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">{{ item.name || '未命名' }}</div>
            <div class="library-item-desc">{{ (item.description || '').slice(0, 60) }}{{ (item.description || '').length > 60 ? '…' : '' }}</div>
            <div class="library-item-actions">
              <el-button size="small" :disabled="listWriteLocked" @click="openEditCharLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain :disabled="listWriteLocked" @click="onDeleteCharLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="charLibraryError" class="library-error" role="alert">
          <p>{{ charLibraryError }}</p>
          <el-button size="small" type="primary" plain :loading="charLibraryLoading" @click="loadCharLibraryList">重试</el-button>
        </div>
        <div v-if="!charLibraryLoading && !charLibraryError && charLibraryList.length === 0" class="library-empty">{{ charLibraryKeyword.trim() ? '没有匹配的角色，试试其他关键词。' : '素材库暂无角色，可在项目中将角色「加入素材库」后在此查看' }}</div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="charLibraryPage" v-model:page-size="charLibraryPageSize" :total="charLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadCharLibraryList" @size-change="loadCharLibraryList" />
      </div>
      <template #footer><el-button @click="showCharLibrary = false">关闭</el-button></template>
    </AccessibleDialog>
    <!-- 编辑公共角色 -->
    <AccessibleDialog v-model="showEditCharLibrary" title="编辑素材角色" width="480px" @close="editCharLibraryForm = null">
      <el-form v-if="editCharLibraryForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button
              v-if="assetImageUrl(editCharLibraryForm)"
              type="button"
              class="lib-img-thumb"
              :aria-label="`预览角色素材「${editCharLibraryForm.name || '未命名'}」图片`"
              @click="openImagePreview(assetImageUrl(editCharLibraryForm), `角色素材「${editCharLibraryForm.name || '未命名'}」预览图`)"
            >
              <img :src="assetImageUrl(editCharLibraryForm)" :alt="`角色素材「${editCharLibraryForm.name || '未命名'}」预览图`" />
            </button>
            <div v-else class="lib-img-thumb lib-img-thumb--empty" role="img" aria-label="角色素材暂无图片">
              <div class="lib-img-empty"><el-icon aria-hidden="true"><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editCharLibraryForm.imgUploading" :disabled="listWriteLocked" @click="charLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editCharLibraryForm.imgGenerating" :disabled="listWriteLocked" @click="doGenerateLibImg(editCharLibraryForm, (editCharLibraryForm.name + (editCharLibraryForm.description ? ', ' + editCharLibraryForm.description : '')), characterLibraryAPI, loadCharLibraryList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="charLibFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editCharLibraryForm, characterLibraryAPI, loadCharLibraryList)" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editCharLibraryForm.name" placeholder="角色名称" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editCharLibraryForm.category" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editCharLibraryForm.description" type="textarea" :rows="3" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editCharLibraryForm.tags" placeholder="可选，逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditCharLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editCharLibrarySaving" :disabled="listWriteLocked" @click="submitEditCharLibrary">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 公共场景库 -->
    <AccessibleDialog v-model="showSceneLibrary" title="素材库 · 场景" width="720px" destroy-on-close class="library-dialog" @open="loadSceneLibraryList">
      <div class="library-toolbar">
        <el-input v-model="sceneLibraryKeyword" placeholder="搜索地点或描述" aria-label="搜索场景素材" clearable style="width: 200px" @input="debouncedLoadSceneLibrary()" />
      </div>
      <div v-loading="sceneLibraryLoading" class="library-list">
        <div v-for="item in sceneLibraryList" :key="item.id" class="library-item">
          <button
            v-if="assetImageUrl(item)"
            type="button"
            class="library-item-cover"
            :aria-label="`预览场景素材「${item.location || item.time || '未命名'}」图片`"
            @click="openImagePreview(assetImageUrl(item), `场景素材「${item.location || item.time || '未命名'}」预览图`)"
          >
            <img :src="assetImageUrl(item)" :alt="`场景素材「${item.location || item.time || '未命名'}」预览图`" />
          </button>
          <div v-else class="library-item-cover library-item-cover--empty">
            <span class="library-item-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">{{ item.location || item.time || '未命名' }}</div>
            <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
            <div class="library-item-actions">
              <el-button size="small" :disabled="listWriteLocked" @click="openEditSceneLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain :disabled="listWriteLocked" @click="onDeleteSceneLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="sceneLibraryError" class="library-error" role="alert">
          <p>{{ sceneLibraryError }}</p>
          <el-button size="small" type="primary" plain :loading="sceneLibraryLoading" @click="loadSceneLibraryList">重试</el-button>
        </div>
        <div v-if="!sceneLibraryLoading && !sceneLibraryError && sceneLibraryList.length === 0" class="library-empty">{{ sceneLibraryKeyword.trim() ? '没有匹配的场景，试试其他关键词。' : '素材库暂无场景，可在项目中将场景「加入素材库」后在此查看' }}</div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="sceneLibraryPage" v-model:page-size="sceneLibraryPageSize" :total="sceneLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadSceneLibraryList" @size-change="loadSceneLibraryList" />
      </div>
      <template #footer><el-button @click="showSceneLibrary = false">关闭</el-button></template>
    </AccessibleDialog>
    <!-- 编辑公共场景 -->
    <AccessibleDialog v-model="showEditSceneLibrary" title="编辑素材场景" width="480px" @close="editSceneLibraryForm = null">
      <el-form v-if="editSceneLibraryForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button
              v-if="assetImageUrl(editSceneLibraryForm)"
              type="button"
              class="lib-img-thumb"
              :aria-label="`预览场景素材「${editSceneLibraryForm.location || editSceneLibraryForm.time || '未命名'}」图片`"
              @click="openImagePreview(assetImageUrl(editSceneLibraryForm), `场景素材「${editSceneLibraryForm.location || editSceneLibraryForm.time || '未命名'}」预览图`)"
            >
              <img :src="assetImageUrl(editSceneLibraryForm)" :alt="`场景素材「${editSceneLibraryForm.location || editSceneLibraryForm.time || '未命名'}」预览图`" />
            </button>
            <div v-else class="lib-img-thumb lib-img-thumb--empty" role="img" aria-label="场景素材暂无图片">
              <div class="lib-img-empty"><el-icon aria-hidden="true"><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editSceneLibraryForm.imgUploading" :disabled="listWriteLocked" @click="sceneLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editSceneLibraryForm.imgGenerating" :disabled="listWriteLocked" @click="doGenerateLibImg(editSceneLibraryForm, ([editSceneLibraryForm.location, editSceneLibraryForm.time, editSceneLibraryForm.description].filter(Boolean).join(', ')), sceneLibraryAPI, loadSceneLibraryList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="sceneLibFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editSceneLibraryForm, sceneLibraryAPI, loadSceneLibraryList)" />
        </el-form-item>
        <el-form-item label="地点"><el-input v-model="editSceneLibraryForm.location" placeholder="场景地点" /></el-form-item>
        <el-form-item label="时间"><el-input v-model="editSceneLibraryForm.time" placeholder="如：浅色/夜晚" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editSceneLibraryForm.category" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editSceneLibraryForm.description" type="textarea" :rows="3" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editSceneLibraryForm.tags" placeholder="可选，逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditSceneLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editSceneLibrarySaving" :disabled="listWriteLocked" @click="submitEditSceneLibrary">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 公共道具库 -->
    <AccessibleDialog v-model="showPropLibrary" title="素材库 · 道具" width="720px" destroy-on-close class="library-dialog" @open="loadPropLibraryList">
      <div class="library-toolbar">
        <el-input v-model="propLibraryKeyword" placeholder="搜索名称或描述" aria-label="搜索道具素材" clearable style="width: 200px" @input="debouncedLoadPropLibrary()" />
      </div>
      <div v-loading="propLibraryLoading" class="library-list">
        <div v-for="item in propLibraryList" :key="item.id" class="library-item">
          <button
            v-if="assetImageUrl(item)"
            type="button"
            class="library-item-cover"
            :aria-label="`预览道具素材「${item.name || '未命名'}」图片`"
            @click="openImagePreview(assetImageUrl(item), `道具素材「${item.name || '未命名'}」预览图`)"
          >
            <img :src="assetImageUrl(item)" :alt="`道具素材「${item.name || '未命名'}」预览图`" />
          </button>
          <div v-else class="library-item-cover library-item-cover--empty">
            <span class="library-item-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">{{ item.name || '未命名' }}</div>
            <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
            <div class="library-item-actions">
              <el-button size="small" :disabled="listWriteLocked" @click="openEditPropLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain :disabled="listWriteLocked" @click="onDeletePropLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="propLibraryError" class="library-error" role="alert">
          <p>{{ propLibraryError }}</p>
          <el-button size="small" type="primary" plain :loading="propLibraryLoading" @click="loadPropLibraryList">重试</el-button>
        </div>
        <div v-if="!propLibraryLoading && !propLibraryError && propLibraryList.length === 0" class="library-empty">{{ propLibraryKeyword.trim() ? '没有匹配的道具，试试其他关键词。' : '素材库暂无道具，可在项目中将道具「加入素材库」后在此查看' }}</div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="propLibraryPage" v-model:page-size="propLibraryPageSize" :total="propLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadPropLibraryList" @size-change="loadPropLibraryList" />
      </div>
      <template #footer><el-button @click="showPropLibrary = false">关闭</el-button></template>
    </AccessibleDialog>
    <!-- 编辑公共道具 -->
    <AccessibleDialog v-model="showEditPropLibrary" title="编辑素材道具" width="480px" @close="editPropLibraryForm = null">
      <el-form v-if="editPropLibraryForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button
              v-if="assetImageUrl(editPropLibraryForm)"
              type="button"
              class="lib-img-thumb"
              :aria-label="`预览道具素材「${editPropLibraryForm.name || '未命名'}」图片`"
              @click="openImagePreview(assetImageUrl(editPropLibraryForm), `道具素材「${editPropLibraryForm.name || '未命名'}」预览图`)"
            >
              <img :src="assetImageUrl(editPropLibraryForm)" :alt="`道具素材「${editPropLibraryForm.name || '未命名'}」预览图`" />
            </button>
            <div v-else class="lib-img-thumb lib-img-thumb--empty" role="img" aria-label="道具素材暂无图片">
              <div class="lib-img-empty"><el-icon aria-hidden="true"><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editPropLibraryForm.imgUploading" :disabled="listWriteLocked" @click="propLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editPropLibraryForm.imgGenerating" :disabled="listWriteLocked" @click="doGenerateLibImg(editPropLibraryForm, (editPropLibraryForm.name + (editPropLibraryForm.description ? ', ' + editPropLibraryForm.description : '')), propLibraryAPI, loadPropLibraryList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="propLibFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editPropLibraryForm, propLibraryAPI, loadPropLibraryList)" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editPropLibraryForm.name" placeholder="道具名称" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editPropLibraryForm.category" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editPropLibraryForm.description" type="textarea" :rows="3" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editPropLibraryForm.tags" placeholder="可选，逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditPropLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editPropLibrarySaving" :disabled="listWriteLocked" @click="submitEditPropLibrary">保存</el-button>
      </template>
    </AccessibleDialog>

    <ImagePreviewDialog
      v-model="showImagePreview"
      :src="previewImage.src"
      :alt="previewImage.alt"
    />

    <!-- 编辑项目：修改标题和故事 -->
    <AccessibleDialog
      v-model="showEditDialog"
      title="编辑项目"
      width="480px"
      :close-on-click-modal="false"
      @closed="resetEditForm"
    >
      <el-form :model="editForm" label-width="80px" label-position="top">
        <el-form-item label="标题" required>
          <el-input v-model="editForm.title" autofocus aria-label="项目标题" placeholder="输入项目标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="故事">
          <el-input v-model="editForm.description" type="textarea" :rows="3" placeholder="输入故事梗概（选填）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" :disabled="listWriteLocked || !editForm.title?.trim()" @click="submitEdit">保存</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Edit, Delete, Setting, Plus, User, PictureFilled, Box, Sunny, Moon, Download, Upload, QuestionFilled, FolderOpened, MagicStick, Files, Collection, ArrowDown, MoreFilled, RefreshLeft, Search, ArrowRight } from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import { newProjectDestination, projectCardDestination } from '@/utils/sourceImportNavigation.js'
import { dramaAPI } from '@/api/drama'
import { characterLibraryAPI } from '@/api/characterLibrary'
import { sceneLibraryAPI } from '@/api/sceneLibrary'
import { propLibraryAPI } from '@/api/propLibrary'
import AIConfigContent from '@/components/AIConfigContent.vue'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import { uploadAPI } from '@/api/upload'
import { aiAPI } from '@/api/ai'
import { imagesAPI } from '@/api/images'
import { taskAPI } from '@/api/task'
import { filterProjectList, getProjectCover } from '@/utils/projectList'
import { mergeProjectListFilters, normalizeProjectListFilters, normalizeProjectListReturnTo } from '@/utils/projectListRoute'
import { createOperationId, logOperation } from '@/utils/operationLog'
import { describeServiceLoadError, isRequestCanceled, withRequestRetry } from '@/utils/requestError'
import { sanitizeExportFilename, validateExportBlob, resolveExportFailureMessage } from '@/utils/projectExport'

const router = useRouter()
const route = useRoute()
const { isDark, toggle: toggleTheme } = useTheme()

function openSemanticLibrary(type) {
  if (listWriteLocked.value) return
  if (type === 'character') showCharLibrary.value = true
  if (type === 'scene') showSceneLibrary.value = true
  if (type === 'prop') showPropLibrary.value = true
}

// 库编辑图片 – 文件输入 refs
const charLibFileRef  = ref(null)
const sceneLibFileRef = ref(null)
const propLibFileRef  = ref(null)

// 共享：上传图片
async function doUploadLibImg(event, form, api, reloadFn) {
  if (listWriteLocked.value) {
    if (event.target) event.target.value = ''
    return
  }
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file)
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await api.update(form.id, { image_url: url, local_path: null })
    reloadFn()
    ElMessage.success('图片已更新')
  } catch (e) { ElMessage.error(e.message || '上传失败') }
  finally { form.imgUploading = false }
}

// 共享：AI 生成图片
async function doGenerateLibImg(form, prompt, api, reloadFn) {
  if (listWriteLocked.value) return
  if (!prompt?.trim()) { ElMessage.warning('请先填写名称或描述'); return }
  form.imgGenerating = true
  try {
    const res = await imagesAPI.create({ prompt: prompt.trim(), drama_id: null })
    const imgData = res?.data ?? res
    const taskId = imgData?.task_id
    if (!taskId) throw new Error('未返回任务ID')
    let task = null
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const tr = await taskAPI.get(taskId)
      task = tr?.data ?? tr
      if (task.status === 'completed') break
      if (task.status === 'failed') throw new Error(task.error || '生成失败')
    }
    if (!task || task.status !== 'completed') throw new Error('生成超时')
    const result = task.result
    const imageUrl = result?.image_url
    const localPath = result?.local_path ?? null
    if (!imageUrl && !localPath) throw new Error('未获取到图片地址')
    form.image_url = imageUrl || ''
    form.local_path = localPath
    await api.update(form.id, { image_url: imageUrl || null, local_path: localPath })
    reloadFn()
    ElMessage.success('AI 图片已生成')
  } catch (e) { ElMessage.error(e.message || '生成失败') }
  finally { form.imgGenerating = false }
}

const loading = ref(false)
const dramas = ref([])
const total = ref(0)
const projectPage = ref(1)
const projectPageSize = ref(24)
const listError = ref('')
const hasSuccessfulListLoad = ref(false)
const listIsStale = computed(() => Boolean(listError.value) && hasSuccessfulListLoad.value)
const listWriteLocked = computed(() => loading.value || !hasSuccessfulListLoad.value || Boolean(listError.value))
let listRequestSequence = 0
let projectReloadTimer = null
let projectListMounted = false
const initialProjectListFilters = normalizeProjectListFilters(route.query)
const projectSearch = ref(initialProjectListFilters.q)
const projectSort = ref(initialProjectListFilters.sort)
const projectStatusFilter = ref(initialProjectListFilters.status)
const projectCoverErrors = ref(new Set())
const projectListReturnTo = computed(() => normalizeProjectListReturnTo(route.fullPath) || '/')
const sourceImportIntent = computed(() => route.query.intent === 'source-import')
const normalizedProjectSearch = computed(() => projectSearch.value.trim().toLowerCase())
const hasProjectFilters = computed(() => Boolean(normalizedProjectSearch.value) || projectStatusFilter.value !== 'all')
const filteredDramas = computed(() => {
  return filterProjectList(dramas.value, {
    keyword: normalizedProjectSearch.value,
    status: projectStatusFilter.value,
    sort: 'server',
    getSearchText: projectSearchText,
  })
})
const projectListCountLabel = computed(() => {
  const projectTotal = Number(total.value) || 0
  if (projectTotal === 0) return hasProjectFilters.value ? '0 个项目' : '暂无项目'
  if (projectTotal <= projectPageSize.value) return `${filteredDramas.value.length} / ${projectTotal} 个项目`
  const start = (projectPage.value - 1) * projectPageSize.value + 1
  const end = Math.min(projectTotal, start + projectPageSize.value - 1)
  return `${start}-${end} / ${projectTotal} 个项目`
})

let applyingProjectListRoute = false

function scheduleProjectListReload() {
  projectPage.value = 1
  listRequestSequence += 1
  if (projectReloadTimer) clearTimeout(projectReloadTimer)
  projectReloadTimer = setTimeout(() => {
    projectReloadTimer = null
    loadList({ page: 1 })
  }, 240)
}

function resolvedProjectListPath(query) {
  return router.resolve({ path: route.path, query, hash: route.hash }).fullPath
}

watch(
  () => route.query,
  (query) => {
    const filters = normalizeProjectListFilters(query)
    applyingProjectListRoute = true
    projectSearch.value = filters.q
    projectStatusFilter.value = filters.status
    projectSort.value = filters.sort

    const nextQuery = mergeProjectListFilters(query, filters)
    if (resolvedProjectListPath(nextQuery) !== route.fullPath) {
      router.replace({ path: route.path, query: nextQuery, hash: route.hash }).catch(() => {})
    } else if (projectListMounted) {
      scheduleProjectListReload()
    }
    nextTick(() => {
      applyingProjectListRoute = false
    })
  },
  { deep: true, immediate: true },
)

watch(
  [projectSearch, projectStatusFilter, projectSort],
  () => {
    if (applyingProjectListRoute) return
    const nextQuery = mergeProjectListFilters(route.query, {
      q: projectSearch.value,
      status: projectStatusFilter.value,
      sort: projectSort.value,
    })
    if (resolvedProjectListPath(nextQuery) === route.fullPath) return
    router.replace({ path: route.path, query: nextQuery, hash: route.hash }).catch(() => {})
  },
  { flush: 'post' },
)

const showAiConfigDialog = ref(false)
const aiConfigContentRef = ref(null)
const vendorLockEnabled = ref(false)

async function confirmAiConfigWorkspaceClose(done) {
  const canClose = (await aiConfigContentRef.value?.requestClose?.()) !== false
  if (canClose) done()
}

async function requestFilmListNavigation() {
  if (!showAiConfigDialog.value) return true
  return (await aiConfigContentRef.value?.requestClose?.()) !== false
}

function handleBeforeUnload(event) {
  const hasUnsavedAiConfig = showAiConfigDialog.value
    && aiConfigContentRef.value?.hasUnsavedChanges?.()
  if (!hasUnsavedAiConfig) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(requestFilmListNavigation)

// 图片预览
const showImagePreview = ref(false)
const previewImage = ref({ src: '', alt: '图片预览' })
function assetImageUrl(item) {
  if (!item) return ''
  if (typeof item === 'string') return item.startsWith('http') ? item : item
  const localPath = item.local_path && String(item.local_path).trim()
  if (localPath) return '/static/' + localPath.replace(/^\//, '')
  return item.image_url || ''
}
function openImagePreview(url, alt = '图片预览') {
  const src = String(url || '').trim()
  if (!src) return
  previewImage.value = { src, alt }
  showImagePreview.value = true
}

// 公共角色库
const showCharLibrary = ref(false)
const charLibraryList = ref([])
const charLibraryLoading = ref(false)
const charLibraryPage = ref(1)
const charLibraryPageSize = ref(20)
const charLibraryTotal = ref(0)
const charLibraryKeyword = ref('')
const charLibraryError = ref('')
const showEditCharLibrary = ref(false)
const editCharLibraryForm = ref(null)
const editCharLibrarySaving = ref(false)
let charLibraryKeywordTimer = null

async function loadCharLibraryList() {
  charLibraryLoading.value = true
  try {
    const res = await characterLibraryAPI.list({ page: charLibraryPage.value, page_size: charLibraryPageSize.value, keyword: charLibraryKeyword.value || undefined, global: 1 })
    charLibraryList.value = res?.items ?? []
    const p = res?.pagination ?? {}
    charLibraryTotal.value = p.total ?? 0
    if (p.page != null) charLibraryPage.value = p.page
    if (p.page_size != null) charLibraryPageSize.value = p.page_size
    charLibraryError.value = ''
  } catch (error) {
    charLibraryError.value = describeServiceLoadError(error, { serviceLabel: '角色素材服务' })
  } finally { charLibraryLoading.value = false }
}
function debouncedLoadCharLibrary() {
  if (charLibraryKeywordTimer) clearTimeout(charLibraryKeywordTimer)
  charLibraryKeywordTimer = setTimeout(() => { charLibraryPage.value = 1; loadCharLibraryList() }, 300)
}
function openEditCharLibrary(item) {
  if (listWriteLocked.value) return
  editCharLibraryForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  showEditCharLibrary.value = true
}
async function submitEditCharLibrary() {
  if (listWriteLocked.value) return
  if (!editCharLibraryForm.value?.id) return
  editCharLibrarySaving.value = true
  try {
    await characterLibraryAPI.update(editCharLibraryForm.value.id, { name: editCharLibraryForm.value.name, category: editCharLibraryForm.value.category || null, description: editCharLibraryForm.value.description || null, tags: editCharLibraryForm.value.tags || null, image_url: editCharLibraryForm.value.image_url || null, local_path: editCharLibraryForm.value.local_path ?? null })
    ElMessage.success('已保存')
    showEditCharLibrary.value = false
    loadCharLibraryList()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { editCharLibrarySaving.value = false }
}
async function onDeleteCharLibrary(item) {
  if (listWriteLocked.value) return
  try { await ElMessageBox.confirm(`确定删除公共角色「${(item.name || '未命名').slice(0, 20)}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await characterLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadCharLibraryList() } catch (e) { ElMessage.error(e.message || '删除失败') }
}

// 公共场景库
const showSceneLibrary = ref(false)
const sceneLibraryList = ref([])
const sceneLibraryLoading = ref(false)
const sceneLibraryPage = ref(1)
const sceneLibraryPageSize = ref(20)
const sceneLibraryTotal = ref(0)
const sceneLibraryKeyword = ref('')
const sceneLibraryError = ref('')
const showEditSceneLibrary = ref(false)
const editSceneLibraryForm = ref(null)
const editSceneLibrarySaving = ref(false)
let sceneLibraryKeywordTimer = null

async function loadSceneLibraryList() {
  sceneLibraryLoading.value = true
  try {
    const res = await sceneLibraryAPI.list({ page: sceneLibraryPage.value, page_size: sceneLibraryPageSize.value, keyword: sceneLibraryKeyword.value || undefined, global: 1 })
    sceneLibraryList.value = res?.items ?? []
    const p = res?.pagination ?? {}
    sceneLibraryTotal.value = p.total ?? 0
    if (p.page != null) sceneLibraryPage.value = p.page
    if (p.page_size != null) sceneLibraryPageSize.value = p.page_size
    sceneLibraryError.value = ''
  } catch (error) {
    sceneLibraryError.value = describeServiceLoadError(error, { serviceLabel: '场景素材服务' })
  } finally { sceneLibraryLoading.value = false }
}
function debouncedLoadSceneLibrary() {
  if (sceneLibraryKeywordTimer) clearTimeout(sceneLibraryKeywordTimer)
  sceneLibraryKeywordTimer = setTimeout(() => { sceneLibraryPage.value = 1; loadSceneLibraryList() }, 300)
}
function openEditSceneLibrary(item) {
  if (listWriteLocked.value) return
  editSceneLibraryForm.value = { id: item.id, location: item.location ?? '', time: item.time ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  showEditSceneLibrary.value = true
}
async function submitEditSceneLibrary() {
  if (listWriteLocked.value) return
  if (!editSceneLibraryForm.value?.id) return
  editSceneLibrarySaving.value = true
  try {
    await sceneLibraryAPI.update(editSceneLibraryForm.value.id, { location: editSceneLibraryForm.value.location, time: editSceneLibraryForm.value.time || null, category: editSceneLibraryForm.value.category || null, description: editSceneLibraryForm.value.description || null, tags: editSceneLibraryForm.value.tags || null, image_url: editSceneLibraryForm.value.image_url || null, local_path: editSceneLibraryForm.value.local_path ?? null })
    ElMessage.success('已保存')
    showEditSceneLibrary.value = false
    loadSceneLibraryList()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { editSceneLibrarySaving.value = false }
}
async function onDeleteSceneLibrary(item) {
  if (listWriteLocked.value) return
  const name = (item.location || item.time || '未命名').slice(0, 20)
  try { await ElMessageBox.confirm(`确定删除公共场景「${name}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await sceneLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadSceneLibraryList() } catch (e) { ElMessage.error(e.message || '删除失败') }
}

// 公共道具库
const showPropLibrary = ref(false)
const propLibraryList = ref([])
const propLibraryLoading = ref(false)
const propLibraryPage = ref(1)
const propLibraryPageSize = ref(20)
const propLibraryTotal = ref(0)
const propLibraryKeyword = ref('')
const propLibraryError = ref('')
const showEditPropLibrary = ref(false)
const editPropLibraryForm = ref(null)
const editPropLibrarySaving = ref(false)
let propLibraryKeywordTimer = null

async function loadPropLibraryList() {
  propLibraryLoading.value = true
  try {
    const res = await propLibraryAPI.list({ page: propLibraryPage.value, page_size: propLibraryPageSize.value, keyword: propLibraryKeyword.value || undefined, global: 1 })
    propLibraryList.value = res?.items ?? []
    const p = res?.pagination ?? {}
    propLibraryTotal.value = p.total ?? 0
    if (p.page != null) propLibraryPage.value = p.page
    if (p.page_size != null) propLibraryPageSize.value = p.page_size
    propLibraryError.value = ''
  } catch (error) {
    propLibraryError.value = describeServiceLoadError(error, { serviceLabel: '道具素材服务' })
  } finally { propLibraryLoading.value = false }
}
function debouncedLoadPropLibrary() {
  if (propLibraryKeywordTimer) clearTimeout(propLibraryKeywordTimer)
  propLibraryKeywordTimer = setTimeout(() => { propLibraryPage.value = 1; loadPropLibraryList() }, 300)
}
function openEditPropLibrary(item) {
  if (listWriteLocked.value) return
  editPropLibraryForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  showEditPropLibrary.value = true
}
async function submitEditPropLibrary() {
  if (listWriteLocked.value) return
  if (!editPropLibraryForm.value?.id) return
  editPropLibrarySaving.value = true
  try {
    await propLibraryAPI.update(editPropLibraryForm.value.id, { name: editPropLibraryForm.value.name, category: editPropLibraryForm.value.category || null, description: editPropLibraryForm.value.description || null, tags: editPropLibraryForm.value.tags || null, image_url: editPropLibraryForm.value.image_url || null, local_path: editPropLibraryForm.value.local_path ?? null })
    ElMessage.success('已保存')
    showEditPropLibrary.value = false
    loadPropLibraryList()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { editPropLibrarySaving.value = false }
}
async function onDeletePropLibrary(item) {
  if (listWriteLocked.value) return
  try { await ElMessageBox.confirm(`确定删除公共道具「${(item.name || '未命名').slice(0, 20)}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await propLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadPropLibraryList() } catch (e) { ElMessage.error(e.message || '删除失败') }
}

const showNewDialog = ref(false)
const newForm = ref({ title: '', description: '', aspect_ratio: '16:9' })
const newSaving = ref(false)
const exportingId = ref(null)
const exportFailure = ref(null)
const importing = ref(false)
const importFailure = ref(null)
const importFileInput = ref(null)
const importTriggerButton = ref(null)

const showTrashDialog = ref(false)
const trashItems = ref([])
const trashLoading = ref(false)
const trashError = ref('')
const trashAnnouncement = ref('')
const trashPage = ref(1)
const trashPageSize = ref(10)
const trashTotal = ref(0)
const restoringId = ref(null)

const exampleList = ref([])
const importingExample = ref(null)

function loadExamples() {
  dramaAPI.listExamples()
    .then(res => { exampleList.value = Array.isArray(res) ? res : (res?.data ?? []) })
    .catch(() => { exampleList.value = [] })
}

async function onImportExample(ex) {
  if (listWriteLocked.value) return
  importingExample.value = ex.filename
  try {
    const data = await dramaAPI.importExample(ex.filename)
    ElMessage.success(`示例导入成功：${data?.title || ex.name}`)
    loadList()
  } catch (e) {
    const msg = e.response?.data?.message || e.message || '导入失败'
    ElMessage.error(msg)
  } finally {
    importingExample.value = null
  }
}

const showEditDialog = ref(false)
const editForm = ref({ id: null, title: '', description: '' })
const editSaving = ref(false)

function describeProjectLoadError(error) {
  return describeServiceLoadError(error, { serviceLabel: '项目服务' })
}

let listAbortController = null

async function loadList(options = {}) {
  const requestedPage = Math.max(1, Number(options.page ?? projectPage.value) || 1)
  const requestedPageSize = Math.max(1, Number(options.pageSize ?? projectPageSize.value) || 24)
  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const requestId = ++listRequestSequence
  const operationId = createOperationId('project_list_load')
  loading.value = true
  let loaded = false
  logOperation({
    operation: 'project_list_load',
    operationId,
    phase: 'start',
    page: requestedPage,
    pageSize: requestedPageSize,
  })
  const startedAt = Date.now()
  try {
    const res = await withRequestRetry(
      () => dramaAPI.list({
        page: requestedPage,
        page_size: requestedPageSize,
        keyword: normalizedProjectSearch.value || undefined,
        status: projectStatusFilter.value !== 'all' ? projectStatusFilter.value : undefined,
        sort: projectSort.value,
      }, { signal: controller.signal }),
      { maxAttempts: 2, delayMs: 400, signal: controller.signal },
    )
    if (requestId !== listRequestSequence) {
      logOperation({
        operation: 'project_list_load',
        operationId,
        phase: 'cancel',
        status: 'stale',
        durationMs: Date.now() - startedAt,
      })
      return false
    }
    const pagination = res?.pagination ?? {}
    const nextTotal = Number(pagination.total ?? 0) || 0
    const nextPageSize = Number(pagination.page_size ?? requestedPageSize) || requestedPageSize
    const lastPage = Math.max(1, Math.ceil(nextTotal / nextPageSize))
    if (nextTotal > 0 && requestedPage > lastPage) {
      projectPage.value = lastPage
      return await loadList({ page: lastPage, pageSize: nextPageSize })
    }
    dramas.value = res?.items ?? []
    total.value = nextTotal
    projectPage.value = Math.min(Math.max(1, Number(pagination.page ?? requestedPage) || requestedPage), lastPage)
    projectPageSize.value = nextPageSize
    projectCoverErrors.value = new Set()
    hasSuccessfulListLoad.value = true
    listError.value = ''
    loaded = true
  } catch (error) {
    if (isRequestCanceled(error) || requestId !== listRequestSequence) {
      return false
    }
    if (requestId === listRequestSequence) {
      listError.value = describeProjectLoadError(error)
      logOperation({
        operation: 'project_list_load',
        operationId,
        phase: 'error',
        durationMs: Date.now() - startedAt,
        error: listError.value,
      })
    }
  } finally {
    if (requestId === listRequestSequence) loading.value = false
  }
  if (loaded) {
    logOperation({
      operation: 'project_list_load',
      operationId,
      phase: 'success',
      durationMs: Date.now() - startedAt,
      page: projectPage.value,
      total: total.value,
    })
    maybeOpenNewDialogFromRoute()
  }
  return loaded
}

function loadProjectPage(page) {
  return loadList({ page })
}

function handleProjectPageSizeChange(pageSize) {
  projectPage.value = 1
  return loadList({ page: 1, pageSize })
}

function projectSearchText(drama) {
  return [
    drama?.title,
    drama?.description,
    formatStatus(drama?.status),
    formatStyle(drama?.style),
    formatGenre(drama?.genre),
    drama?.metadata?.aspect_ratio,
  ].filter(Boolean).join(' ').toLowerCase()
}

function projectCoverUrl(drama) {
  const id = String(drama?.id ?? '')
  if (projectCoverErrors.value.has(id)) return ''
  return getProjectCover(drama)?.url || ''
}

function projectCoverAlt(drama) {
  const title = drama?.title || '未命名项目'
  return `项目「${title}」画面预览`
}

function markProjectCoverError(drama) {
  const id = String(drama?.id ?? '')
  if (!id) return
  const next = new Set(projectCoverErrors.value)
  next.add(id)
  projectCoverErrors.value = next
}

function clearProjectFilters() {
  projectSearch.value = ''
  projectStatusFilter.value = 'all'
}

function formatDate(val) {
  if (!val) return ''
  const d = new Date(val)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatStatus(status) {
  const map = { draft: '草稿', published: '已发布', archived: '已归档', generating: '生成中' }
  return map[status] || status || '草稿'
}

function formatStyle(style) {
  const map = {
    // 写实 / 影视
    realistic: '写实',
    cinematic: '电影感',
    documentary: '纪录片',
    noir: '黑色电影',
    'retro film': '复古胶片',
    horror: '恐怖',
    // 动漫 / 卡通
    'anime style': '日本动漫',
    anime: '日本动漫',
    'comic style': '欧美漫画',
    cartoon: '卡通',
    // 中国风格
    'ink wash': '国画水墨',
    'chinese style': '中国风',
    historical: '古装',
    wuxia: '武侠',
    // 绘画艺术
    watercolor: '水彩',
    'oil painting': '油画',
    sketch: '素描',
    'woodblock print': '版画',
    impressionist: '印象派',
    // 幻想 / 科幻
    fantasy: '奇幻',
    'dark fantasy': '暗黑奇幻',
    'sci-fi': '科幻',
    sci_fi: '科幻',
    cyberpunk: '赛博朋克',
    steampunk: '蒸汽朋克',
    'post-apocalyptic': '末世废土',
    // 数字 / 现代
    '3d render': '3D渲染',
    'pixel art': '像素风',
    'low poly': '低多边形',
    minimalist: '极简',
    dreamy: '唯美梦幻',
  }
  return map[style] || style
}

function formatGenre(genre) {
  const map = { drama: '剧情', comedy: '喜剧', adventure: '冒险', romance: '爱情', thriller: '悬疑', action: '动作', horror: '恐怖' }
  return map[genre] || genre
}

function totalStoryboards(d) {
  return (d.episodes || []).reduce((sum, ep) => sum + (ep.storyboards?.length || 0), 0)
}

function goNewProject() {
  if (listWriteLocked.value) return
  showNewDialog.value = true
}

function openTrash() {
  trashError.value = ''
  trashAnnouncement.value = ''
  showTrashDialog.value = true
}

async function loadTrash() {
  trashLoading.value = true
  trashError.value = ''
  try {
    const res = await dramaAPI.listTrash({
      page: trashPage.value,
      page_size: trashPageSize.value,
    })
    trashItems.value = res?.items ?? []
    trashTotal.value = res?.pagination?.total ?? 0
    if (res?.pagination?.page != null) trashPage.value = res.pagination.page
  } catch (error) {
    trashError.value = error.message || '回收站加载失败，请重试'
  } finally {
    trashLoading.value = false
  }
}

async function restoreFromTrash(item) {
  if (restoringId.value !== null) return
  restoringId.value = item.id
  trashError.value = ''
  trashAnnouncement.value = ''
  try {
    await dramaAPI.restore(item.id)
    if (trashItems.value.length === 1 && trashPage.value > 1) trashPage.value -= 1
    await loadTrash()
    loadList()
    const title = item.title || '未命名项目'
    trashAnnouncement.value = `项目「${title}」已恢复，内容与关联素材保持不变。`
    ElMessage.success('项目已恢复')
  } catch (error) {
    trashError.value = error.message || '恢复失败，请重试'
  } finally {
    restoringId.value = null
  }
}

function goMaterialCenter() {
  router.push('/media-library')
}

function maybeOpenNewDialogFromRoute() {
  if (listWriteLocked.value) return
  if (route.query.new !== '1') return
  showNewDialog.value = true
  const nextQuery = { ...route.query }
  delete nextQuery.new
  router.replace({ path: route.path, query: nextQuery })
}

function resetNewForm() {
  newForm.value = { title: '', description: '', aspect_ratio: '16:9' }
}

async function submitNew() {
  if (listWriteLocked.value) return
  const title = newForm.value.title?.trim()
  if (!title) return
  newSaving.value = true
  try {
    const drama = await dramaAPI.create({ title, description: newForm.value.description?.trim() || undefined, metadata: { aspect_ratio: newForm.value.aspect_ratio || '16:9' } })
    showNewDialog.value = false
    ElMessage.success('项目已创建')
    loadList()
    router.push(newProjectDestination(drama, sourceImportIntent.value, projectListReturnTo.value))
  } catch (e) {
    ElMessage.error(e.message || '创建失败')
  } finally {
    newSaving.value = false
  }
}

function openEditDialog(d) {
  if (listWriteLocked.value) return
  editForm.value = { id: d.id, title: d.title || '', description: d.description || '' }
  showEditDialog.value = true
}

function resetEditForm() {
  editForm.value = { id: null, title: '', description: '' }
}

async function submitEdit() {
  if (listWriteLocked.value) return
  const title = editForm.value.title?.trim()
  if (!title || editForm.value.id == null) return
  editSaving.value = true
  try {
    await dramaAPI.update(editForm.value.id, { title, description: editForm.value.description?.trim() || undefined })
    showEditDialog.value = false
    ElMessage.success('已保存')
    loadList()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    editSaving.value = false
  }
}

function handleProjectAction(action, drama) {
  if (action === 'export') return onExport(drama)
  if (action === 'edit') return openEditDialog(drama)
  if (action === 'trash') return moveToTrash(drama)
}

async function onExport(d) {
  if (exportingId.value !== null) return
  exportingId.value = d.id
  let downloadUrl = ''
  let anchor = null
  try {
    const blob = await validateExportBlob(await dramaAPI.exportDrama(d.id))
    downloadUrl = URL.createObjectURL(blob)
    anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = sanitizeExportFilename(d.title)
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    exportFailure.value = null
    ElMessage.success('项目包已验证，下载已开始')
  } catch (error) {
    const message = await resolveExportFailureMessage(error)
    exportFailure.value = {
      drama: { id: d.id, title: d.title || '未命名项目' },
      message,
    }
    ElMessage.error(message)
  } finally {
    if (anchor?.isConnected) anchor.remove()
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    exportingId.value = null
  }
}

function openSourceImportProject() {
  if (listWriteLocked.value) return
  showNewDialog.value = true
}

function clearImportFailure() {
  importFailure.value = null
}

async function dismissImportFailure() {
  clearImportFailure()
  await nextTick()
  const trigger = importTriggerButton.value?.$el || importTriggerButton.value
  trigger?.focus?.()
}

function normalizeImportFailureFilename(name) {
  let fileName = String(name || '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120)
  if (!fileName) fileName = '未命名项目包'
  return fileName
}

function sanitizeImportFailureReason(message) {
  const collapsed = String(message || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return '项目包导入失败，请重新选择项目包后重试'

  const redacted = collapsed
    .replace(/file:\/\/\/\S+/gi, '本地文件')
    .replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, '本地文件')
    .replace(/\/(?:[^/\s]+\/)+[^/\s]*/g, '服务器文件')
    .trim()

  if (/(traceback|stack|sqlite|sqlstate|sql\b|errno|exception|node_modules|backend-node|frontweb| at [A-Za-z_$][\w$]*\s*\()/i.test(redacted)) {
    return '项目包解析失败，请确认文件完整且与当前版本兼容'
  }

  return redacted.slice(0, 160) || '项目包导入失败，请重新选择项目包后重试'
}

function resolveImportFailureMessage(error) {
  const responseBody = error?.response?.data
  if (typeof responseBody === 'string' && responseBody.trim()) {
    return sanitizeImportFailureReason(responseBody)
  }
  if (responseBody && typeof responseBody === 'object') {
    const responseMessage = responseBody?.error?.message
      || responseBody?.message
      || (typeof responseBody?.error === 'string' ? responseBody.error : '')
    if (responseMessage) return sanitizeImportFailureReason(responseMessage)
  }
  return sanitizeImportFailureReason(error?.message)
}

function setImportFailure(fileName, error) {
  importFailure.value = {
    fileName: normalizeImportFailureFilename(fileName),
    message: resolveImportFailureMessage(error),
  }
}

function triggerImport() {
  if (listWriteLocked.value) return
  importFileInput.value?.click()
}

async function onImportFile(e) {
  if (listWriteLocked.value) {
    if (e.target) e.target.value = ''
    return
  }
  const file = e.target.files?.[0]
  if (!file) return
  e.target.value = ''
  clearImportFailure()
  if (!/\.zip$/i.test(file.name || '')) {
    setImportFailure(file.name, new Error('请选择 .zip 格式的项目包'))
    return
  }
  importing.value = true
  try {
    const data = await dramaAPI.importDrama(file)
    importFailure.value = null
    ElMessage.success(`导入成功：${data?.title || '项目'}`) 
    loadList()
  } catch (error) {
    setImportFailure(file.name, error)
  } finally {
    importing.value = false
  }
}

async function moveToTrash(d) {
  if (listWriteLocked.value) return
  try {
    await ElMessageBox.confirm(
      `项目「${(d.title || '未命名').slice(0, 20)}${(d.title && d.title.length > 20) ? '…' : ''}」将移入回收站。项目内容和关联素材会完整保留，可随时恢复。`,
      '移入回收站',
      { type: 'warning', confirmButtonText: '移入回收站', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await dramaAPI.moveToTrash(d.id)
    ElMessage.success('项目已移入回收站')
    loadList()
    if (showTrashDialog.value) loadTrash()
  } catch (e) {
    ElMessage.error(e.message || '移入回收站失败')
  }
}

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  projectListMounted = true
  loadList()
  loadExamples()
  try {
    const lock = await aiAPI.getVendorLock()
    vendorLockEnabled.value = !!lock?.enabled
  } catch (_) {}
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  projectListMounted = false
  if (projectReloadTimer) clearTimeout(projectReloadTimer)
  listAbortController?.abort()
})
</script>

<style scoped>
.film-list {
  min-height: 100vh;
  background: #08080d;
  color: #e4e4e7;
}
.source-import-intent {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  margin: 16px 0 0;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
}
.header {
  background: rgba(12, 12, 18, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(99, 102, 241, 0.18);
  padding: 12px 24px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 1px 0 rgba(99, 102, 241, 0.08), 0 4px 24px rgba(0, 0, 0, 0.3);
}
.header-inner {
  max-width: min(1400px, 96vw);
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.logo {
  margin: 0;
  cursor: default;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
}
.logo-main {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0;
  color: #c7d2fe;
}
.logo-sub {
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0;
  color: #6d6d7a;
  -webkit-text-fill-color: #6d6d7a;
  filter: none;
}
.page-title {
  color: #a1a1aa;
  font-size: 0.95rem;
}
.header-library {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 20px;
}
.btn-material-center {
  font-weight: 600;
  --el-button-bg-color: rgba(99, 102, 241, 0.2);
  --el-button-border-color: rgba(129, 140, 248, 0.55);
  --el-button-text-color: #c7d2fe;
}
.btn-semantic-library .dropdown-caret {
  margin-left: 2px;
  font-size: 12px;
}
.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.utility-icon-button {
  width: 34px;
  min-width: 34px;
  padding: 0;
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

.btn-trash {
  --el-button-bg-color: rgba(148, 163, 184, 0.08);
  --el-button-border-color: rgba(148, 163, 184, 0.28);
  --el-button-text-color: #cbd5e1;
  --el-button-hover-bg-color: rgba(148, 163, 184, 0.16);
  --el-button-hover-border-color: rgba(148, 163, 184, 0.46);
  --el-button-hover-text-color: #f1f5f9;
}
html.light .btn-trash {
  --el-button-bg-color: #ffffff;
  --el-button-border-color: #cbd1d9;
  --el-button-text-color: #4b5563;
  --el-button-hover-bg-color: #f3f4f6;
  --el-button-hover-border-color: #8b95a3;
  --el-button-hover-text-color: #1f2937;
}

/* 资源库按钮 —— 靛紫调 */
.btn-library {
  --el-button-bg-color: rgba(99, 102, 241, 0.12);
  --el-button-border-color: rgba(99, 102, 241, 0.35);
  --el-button-text-color: #a5b4fc;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.22);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.55);
  --el-button-hover-text-color: #c7d2fe;
  --el-button-active-bg-color: rgba(99, 102, 241, 0.3);
  --el-button-active-border-color: rgba(99, 102, 241, 0.7);
}
html.light .btn-library {
  --el-button-bg-color: rgba(79, 70, 229, 0.08);
  --el-button-border-color: rgba(79, 70, 229, 0.3);
  --el-button-text-color: #3730a3;
  --el-button-hover-bg-color: rgba(79, 70, 229, 0.14);
  --el-button-hover-border-color: rgba(79, 70, 229, 0.5);
  --el-button-hover-text-color: #312e81;
  --el-button-active-bg-color: rgba(79, 70, 229, 0.2);
  --el-button-active-border-color: rgba(79, 70, 229, 0.65);
}

/* 主题切换按钮 */
.btn-theme {
  --el-button-bg-color: rgba(148, 163, 184, 0.1);
  --el-button-border-color: rgba(148, 163, 184, 0.3);
  --el-button-text-color: #94a3b8;
  --el-button-hover-bg-color: rgba(148, 163, 184, 0.2);
  --el-button-hover-border-color: rgba(148, 163, 184, 0.5);
  --el-button-hover-text-color: #cbd5e1;
  transition: all 0.2s;
}
html.light .btn-theme {
  --el-button-bg-color: rgba(99, 102, 241, 0.08);
  --el-button-border-color: rgba(99, 102, 241, 0.3);
  --el-button-text-color: #6366f1;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.15);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.5);
  --el-button-hover-text-color: #4f46e5;
}

/* AI配置按钮 —— 琥珀调 */
.btn-settings {
  --el-button-bg-color: rgba(234, 179, 8, 0.1);
  --el-button-border-color: rgba(234, 179, 8, 0.32);
  --el-button-text-color: #fcd34d;
  --el-button-hover-bg-color: rgba(234, 179, 8, 0.2);
  --el-button-hover-border-color: rgba(234, 179, 8, 0.5);
  --el-button-hover-text-color: #fde68a;
  --el-button-active-bg-color: rgba(234, 179, 8, 0.28);
  --el-button-active-border-color: rgba(234, 179, 8, 0.65);
}
html.light .btn-settings {
  --el-button-bg-color: rgba(180, 83, 9, 0.07);
  --el-button-border-color: rgba(180, 83, 9, 0.28);
  --el-button-text-color: #92400e;
  --el-button-hover-bg-color: rgba(180, 83, 9, 0.12);
  --el-button-hover-border-color: rgba(180, 83, 9, 0.45);
  --el-button-hover-text-color: #78350f;
  --el-button-active-bg-color: rgba(180, 83, 9, 0.18);
  --el-button-active-border-color: rgba(180, 83, 9, 0.6);
}

/* 导入按钮 —— 亮色模式下提升可读性 */
html.light .btn-import {
  --el-button-text-color: #374151;
  --el-button-border-color: #d1d5db;
  --el-button-hover-text-color: #1f2937;
  --el-button-hover-border-color: #9ca3af;
}

.main {
  max-width: min(1400px, 96vw);
  margin: 0 auto;
  padding: 24px 16px 48px;
}
.projects-wrap {
  min-height: 200px;
}
.project-pagination {
  display: flex;
  justify-content: center;
  min-height: 56px;
  margin-top: 18px;
  padding: 10px 0 2px;
}
.workspace-overview {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
  padding: 4px 0 2px;
}
.workspace-copy {
  min-width: 0;
}
.workspace-title {
  margin: 0;
  color: #f4f4f5;
  font-size: 1.2rem;
  font-weight: 650;
  line-height: 1.25;
}
.workspace-count {
  margin: 5px 0 0;
  color: #8b8b97;
  font-size: 0.82rem;
  line-height: 1.4;
}
.workspace-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: min(520px, 100%);
}
.workspace-search {
  width: 320px;
}
.workspace-status {
  width: 124px;
}
.workspace-sort {
  width: 150px;
}
html.dark .workspace-search :deep(.el-input__wrapper),
html.dark .workspace-sort :deep(.el-select__wrapper) {
  background: #18181b;
  box-shadow: 0 0 0 1px #3f3f46;
}
html.dark .workspace-search :deep(.el-input__inner),
html.dark .workspace-sort :deep(.el-select__selected-item),
html.dark .workspace-sort :deep(.el-select__placeholder) {
  color: #e4e4e7;
}
html.dark .workspace-search :deep(.el-input__inner::placeholder) {
  color: #71717a;
}
.data-load-state,
.export-failure-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.empty {
  text-align: center;
  padding: 48px 24px;
}
.empty-title {
  font-size: 1.1rem;
  color: #e4e4e7;
  margin: 0 0 8px;
}
.empty-desc {
  color: #71717a;
  font-size: 0.9rem;
  margin: 0 0 20px;
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 18px;
}
.project-card {
  position: relative;
  background: rgba(24, 24, 30, 0.75);
  border: 1px solid rgba(63, 63, 70, 0.6);
  border-radius: 8px;
  padding: 0;
  transition: border-color 0.25s, background 0.25s, transform 0.25s, box-shadow 0.25s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  overflow: hidden;
}
.project-card-link {
  display: block;
  height: 100%;
  padding: 14px 16px;
  border-radius: inherit;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}
.project-card-link:focus-visible {
  outline: 2px solid #a5b4fc;
  outline-offset: -4px;
  box-shadow: inset 0 0 0 1px rgba(165, 180, 252, 0.35), 0 0 0 4px rgba(99, 102, 241, 0.22);
}
.project-card:focus-within {
  border-color: rgba(129, 140, 248, 0.75);
}
.project-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 8px;
  background: transparent;
  pointer-events: none;
}
.project-card:hover {
  border-color: rgba(99, 102, 241, 0.55);
  background: rgba(28, 28, 36, 0.9);
  transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(99, 102, 241, 0.12), 0 0 0 1px rgba(99, 102, 241, 0.08), 0 2px 8px rgba(0, 0, 0, 0.4);
}

/* 操作卡片 */
.action-card {
  cursor: default;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}
.action-card:hover {
  transform: none;
  box-shadow: none;
}
.action-card::before {
  display: none;
}
.action-card-inner {
  width: min(680px, 100%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
}
.action-card--empty {
  grid-column: 1 / -1;
  min-height: 260px;
  padding: 44px 12px;
}
.action-card--search-empty {
  min-height: 210px;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(148, 163, 184, 0.34);
  background: rgba(24, 24, 30, 0.42);
}
.action-card--search-empty .action-card-inner {
  align-items: center;
  text-align: center;
}
.action-card-title {
  font-size: 1.35rem;
  font-weight: 650;
  color: #f4f4f5;
  margin: 0;
}
.action-card-desc {
  margin: -4px 0 4px;
  color: #a1a1aa;
  font-size: 0.875rem;
}
.action-card-buttons {
  display: flex;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
  justify-content: flex-start;
}
.action-btn {
  min-width: 150px;
}
.action-btn-new {
  --el-button-bg-color: var(--el-color-primary);
}
.action-btn-import {
  --el-button-bg-color: rgba(99, 102, 241, 0.12);
  --el-button-border-color: rgba(99, 102, 241, 0.35);
  --el-button-text-color: #a5b4fc;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.22);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.55);
  --el-button-hover-text-color: #c7d2fe;
}
.action-card-secondary {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.action-btn-material {
  --el-button-bg-color: rgba(255, 255, 255, 0.02);
  --el-button-border-color: rgba(99, 102, 241, 0.28);
  --el-button-text-color: #c7d2fe;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.14);
  --el-button-hover-border-color: rgba(129, 140, 248, 0.5);
  --el-button-hover-text-color: #e0e7ff;
}
.action-btn-trash {
  --el-button-bg-color: transparent;
  --el-button-border-color: rgba(148, 163, 184, 0.28);
  --el-button-text-color: #a1a1aa;
  --el-button-hover-bg-color: rgba(148, 163, 184, 0.1);
  --el-button-hover-border-color: rgba(148, 163, 184, 0.5);
  --el-button-hover-text-color: #e4e4e7;
}
.action-card-note {
  margin: 0;
  color: #8b8b97;
  font-size: 0.82rem;
  text-align: center;
}
.action-card-example {
  width: 100%;
  padding-top: 8px;
  border-top: 1px solid rgba(99, 102, 241, 0.15);
}
.example-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  margin-bottom: 8px;
}
.example-hint-icon {
  color: #a5b4fc;
  font-size: 15px;
}
.example-hint-text {
  font-size: 0.8rem;
  color: #71717a;
}
.example-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.example-btn {
  --el-button-bg-color: rgba(34, 197, 94, 0.1);
  --el-button-border-color: rgba(34, 197, 94, 0.3);
  --el-button-text-color: #4ade80;
  --el-button-hover-bg-color: rgba(34, 197, 94, 0.2);
  --el-button-hover-border-color: rgba(34, 197, 94, 0.5);
  --el-button-hover-text-color: #22c55e;
}
.project-card-body {
  min-width: 0;
}
.project-card-layout {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 16px;
  min-height: 182px;
}
.project-card-cover {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 182px;
  overflow: hidden;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  background: #202028;
  color: #71717a;
}
.project-card-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.project-card-cover-placeholder {
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 12px 8px;
  color: #8b8b97;
  font-size: 0.7rem;
  line-height: 1.35;
  text-align: center;
}
.project-card-cover-placeholder .el-icon {
  color: #a5b4fc;
  font-size: 22px;
}
.project-card-cover--empty {
  border-style: dashed;
  background: rgba(99, 102, 241, 0.06);
}
.project-card-content {
  display: flex;
  min-width: 0;
  min-height: 100%;
  flex-direction: column;
}
.project-card-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding-right: 36px;
}
.project-updated {
  overflow: hidden;
  color: #8b8b97;
  font-size: 0.74rem;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-card-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  margin-bottom: 8px;
  padding-right: 36px;
}
.project-title {
  min-width: 0;
  font-size: 1.05rem;
  line-height: 1.4;
  margin: 2px 0 0;
  color: #fafafa;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.project-desc {
  font-size: 0.875rem;
  color: #a1a1aa;
  margin: 0 0 14px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.project-card-stats {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-bottom: 12px;
}
.project-stat {
  display: inline-flex;
  min-width: 64px;
  min-height: 42px;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
  color: #a1a1aa;
  font-size: 0.72rem;
  line-height: 1.1;
}
.project-stat strong {
  color: #f4f4f5;
  font-size: 1rem;
  font-weight: 680;
  line-height: 1;
}
.project-stat--compact {
  min-width: 58px;
  align-items: center;
  color: #fbbf24;
  font-family: monospace;
  font-size: 0.86rem;
}
.project-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 10px;
}
.badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 99px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}
.badge-status--draft {
  background: rgba(113, 113, 122, 0.15);
  color: #a1a1aa;
  border: 1px solid rgba(113, 113, 122, 0.3);
}
.badge-status--published {
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.badge-status--generating {
  background: rgba(234, 179, 8, 0.12);
  color: #fcd34d;
  border: 1px solid rgba(234, 179, 8, 0.3);
}
.badge-status--archived {
  background: rgba(99, 102, 241, 0.1);
  color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.25);
}
.badge-episodes {
  background: rgba(14, 165, 233, 0.12);
  color: #38bdf8;
  border: 1px solid rgba(14, 165, 233, 0.28);
}
.badge-storyboards {
  background: rgba(20, 184, 166, 0.12);
  color: #2dd4bf;
  border: 1px solid rgba(20, 184, 166, 0.28);
}
.badge-ratio {
  background: rgba(251, 146, 60, 0.1);
  color: #fb923c;
  border: 1px solid rgba(251, 146, 60, 0.25);
  font-family: monospace;
}
.badge-style {
  background: rgba(168, 85, 247, 0.1);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.25);
}
.badge-genre {
  background: rgba(249, 115, 22, 0.1);
  color: #fb923c;
  border: 1px solid rgba(249, 115, 22, 0.25);
}
.project-meta {
  font-size: 0.75rem;
  color: #71717a;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
}
.project-card-continue {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  color: #a5b4fc;
  font-size: 0.76rem;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
}
.project-card-assets {
  position: absolute;
  left: 28px;
  bottom: 24px;
  z-index: 3;
  display: inline-flex;
  width: 88px;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid rgba(199, 210, 254, 0.45);
  border-radius: 6px;
  background: rgba(9, 9, 14, 0.82);
  color: #e0e7ff;
  font-size: 0.76rem;
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  backdrop-filter: blur(8px);
}
.project-card-assets:hover,
.project-card-assets:focus-visible {
  border-color: #a5b4fc;
  background: rgba(49, 46, 129, 0.92);
  color: #ffffff;
}
.project-card-assets:focus-visible {
  outline: 2px solid #c7d2fe;
  outline-offset: 2px;
}
.project-card-link:hover .project-card-continue,
.project-card-link:focus-visible .project-card-continue {
  color: #c7d2fe;
}
.project-menu-button {
  --el-button-size: 30px;
  color: #a1a1aa;
  margin-top: -2px;
  align-self: start;
}
.project-card-menu {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
}
.project-menu-button:hover,
.project-menu-button:focus-visible {
  color: #e4e4e7;
  background: rgba(99, 102, 241, 0.16);
}
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
.library-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border-left: 3px solid #f87171;
  background: rgba(239, 68, 68, 0.08);
  color: #fca5a5;
}
.library-error p,
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

/* 公共库弹窗 */
:global(.library-dialog .el-dialog__body) { padding-top: 8px; }

/* 编辑弹框内图片区 */
.lib-img-editor { display: flex; align-items: center; gap: 14px; }
.lib-img-thumb { width: 88px; height: 88px; padding: 0; border-radius: 8px; overflow: hidden; background: var(--bg-inner, #1c1c1e); border: 1px solid var(--border-color, #27272a); color: inherit; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
button.lib-img-thumb { cursor: zoom-in; }
.lib-img-thumb--empty { cursor: default; }
.lib-img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.lib-img-empty { color: var(--text-faint, #52525b); font-size: 26px; }
.lib-img-btns { display: flex; flex-direction: column; gap: 8px; }
.library-toolbar { margin-bottom: 12px; }
.library-list {
  min-height: 200px;
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.library-item {
  display: flex;
  gap: 12px;
  padding: 10px;
  background: #1c1c1e;
  border: 1px solid #27272a;
  border-radius: 8px;
}
.library-item-cover {
  width: 72px;
  height: 72px;
  padding: 0;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #27272a;
  display: flex;
  align-items: center;
  justify-content: center;
  color: inherit;
}
button.library-item-cover { cursor: zoom-in; }
.library-item-cover--empty { cursor: default; }
.library-item-cover:focus-visible,
.lib-img-thumb:focus-visible {
  outline: 2px solid #a5b4fc;
  outline-offset: 2px;
}
.library-item-cover img { width: 100%; height: 100%; object-fit: cover; }
.library-item-placeholder { font-size: 0.8rem; color: #71717a; }
.library-item-info { flex: 1; min-width: 0; }
.library-item-name { font-weight: 500; margin-bottom: 4px; color: #fafafa; }
.library-item-desc { font-size: 0.85rem; color: #a1a1aa; margin-bottom: 8px; }
.library-item-actions { display: flex; gap: 8px; }
.library-empty { text-align: center; color: #71717a; padding: 40px 20px; }
.library-pagination { margin-top: 12px; display: flex; justify-content: center; }

/* ===== 亮色模式适配 ===== */
html.light .film-list {
  background: #f7f8fa;
  color: #20242c;
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
html.light .header {
  background: rgba(255, 255, 255, 0.92);
  border-bottom-color: #e4e7ec;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04), 0 4px 16px rgba(15, 23, 42, 0.04);
}
html.light .logo-main {
  color: #4f46e5;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
html.light .project-card {
  background: #ffffff;
  border-color: #e1e5eb;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
  backdrop-filter: none;
}
html.light .project-card::before {
  background: transparent;
}
html.light .project-card:hover {
  border-color: #aeb6c2;
  background: #ffffff;
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
}
html.light .project-card-cover {
  border-color: #e1e5eb;
  background: #f3f4f6;
  color: #6b7280;
}
html.light .project-card-cover--empty {
  background: #f8f7ff;
  border-color: #cfd3e1;
}
html.light .project-card-cover-placeholder .el-icon {
  color: #6366f1;
}
html.light .project-card-continue {
  color: #4f46e5;
}
html.light .project-card-assets {
  border-color: rgba(79, 70, 229, 0.4);
  background: rgba(255, 255, 255, 0.9);
  color: #4338ca;
}
html.light .project-card-assets:hover,
html.light .project-card-assets:focus-visible {
  border-color: #4f46e5;
  background: #eef2ff;
  color: #312e81;
}
html.light .project-card-link:hover .project-card-continue,
html.light .project-card-link:focus-visible .project-card-continue {
  color: #3730a3;
}
html.light .action-card {
  background: transparent;
}
html.light .action-card:hover {
  background: transparent;
}
html.light .action-card-title { color: #20242c; }
html.light .workspace-title { color: #20242c; }
html.light .workspace-count,
html.light .project-updated { color: #6b7280; }
html.light .project-title { color: #20242c; }
html.light .project-desc { color: #4b5563; }
html.light .project-meta { color: #6b7280; }
html.light .action-card--search-empty {
  background: #ffffff;
  border-color: #d6dbe3;
}
html.light .action-card-desc { color: #6b7280; }
html.light .project-stat {
  background: #f8fafc;
  border-color: #e1e5eb;
  color: #6b7280;
}
html.light .project-stat strong { color: #20242c; }
html.light .project-stat--compact { color: #92400e; }
html.light .action-btn-import {
  --el-button-bg-color: #ffffff;
  --el-button-border-color: #b8c0cc;
  --el-button-text-color: #374151;
  --el-button-hover-bg-color: #f3f4f6;
  --el-button-hover-border-color: #7c8796;
  --el-button-hover-text-color: #111827;
}
html.light .action-btn-material {
  --el-button-bg-color: rgba(79, 70, 229, 0.04);
  --el-button-border-color: rgba(79, 70, 229, 0.22);
  --el-button-text-color: #4338ca;
  --el-button-hover-bg-color: rgba(79, 70, 229, 0.1);
  --el-button-hover-border-color: rgba(79, 70, 229, 0.38);
  --el-button-hover-text-color: #3730a3;
}
html.light .action-btn-trash {
  --el-button-bg-color: transparent;
  --el-button-border-color: #cbd1d9;
  --el-button-text-color: #4b5563;
  --el-button-hover-bg-color: #f3f4f6;
  --el-button-hover-border-color: #8b95a3;
  --el-button-hover-text-color: #1f2937;
}
html.light .action-card-note { color: #6b7280; }
html.light .project-menu-button { color: #6b7280; }
html.light .project-menu-button:hover,
html.light .project-menu-button:focus-visible {
  color: #3730a3;
  background: rgba(79, 70, 229, 0.1);
}
html.light .example-hint-text { color: #6b7280; }
html.light .library-item {
  background: #faf9ff;
  border-color: #e5e7eb;
}
html.light .library-item-name { color: #1e1b4b; }
html.light .library-item-desc { color: #4b5563; }
html.light .library-empty { color: #6b7280; }
html.light .library-error { color: #b91c1c; background: #fef2f2; }
html.light .lib-img-thumb {
  background: #f3f4f6;
  border-color: #e5e7eb;
}
html.light .lib-img-empty { color: #9ca3af; }
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
html.light .badge-status--draft {
  background: rgba(107, 114, 128, 0.1);
  color: #4b5563;
  border-color: rgba(107, 114, 128, 0.25);
}

@media (max-width: 860px) {
  .workspace-overview {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }
  .workspace-controls {
    justify-content: stretch;
    min-width: 0;
  }
  .workspace-search {
    flex: 1 1 auto;
    width: auto;
  }
  .workspace-status,
  .workspace-sort {
    flex: 0 1 150px;
  }
}

@media (max-width: 620px) {
  .workspace-controls {
    align-items: stretch;
    flex-direction: column;
  }
  .workspace-search,
  .workspace-status,
  .workspace-sort {
    width: 100%;
  }
  .project-card-topline {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
  .project-card-layout {
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 12px;
    min-height: 168px;
  }
  .project-card-cover {
    min-height: 168px;
  }
}

</style>
