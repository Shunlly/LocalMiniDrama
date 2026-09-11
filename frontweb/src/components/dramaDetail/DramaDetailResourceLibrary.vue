<template>
      <!-- 本剧资源库（Tab 切换） -->
      <section id="project-resources" class="section card res-section">
        <nav class="res-tabbar" role="tablist" aria-label="项目资源分类">
          <span class="res-tab-group-label">资源库</span>
          <button
            v-for="t in [{v:'lib-char',label:'角色'},{v:'lib-scene',label:'场景'},{v:'lib-prop',label:'道具'}]"
            :key="t.v"
            :id="`drama-res-tab-${t.v}`"
            type="button"
            role="tab"
            class="res-tab res-tab--lib"
            :class="{ active: activeResTab === t.v }"
            :aria-selected="activeResTab === t.v"
            :aria-controls="`drama-res-panel-${t.v}`"
            @click="activeResTab = t.v"
            @keydown="onResourceTabKeydown"
          >{{ t.label }}</button>
          <span class="res-tab-spacer"></span>
          <span class="res-tab-group-label res-tab-group-label--prod">制作资源</span>
          <button
            v-for="t in [{v:'drama-char',label:'角色'},{v:'drama-scene',label:'场景'},{v:'drama-prop',label:'道具'}]"
            :key="t.v"
            :id="`drama-res-tab-${t.v}`"
            type="button"
            role="tab"
            class="res-tab res-tab--drama"
            :class="{ active: activeResTab === t.v }"
            :aria-selected="activeResTab === t.v"
            :aria-controls="`drama-res-panel-${t.v}`"
            @click="activeResTab = t.v"
            @keydown="onResourceTabKeydown"
          >{{ t.label }}</button>
        </nav>

        <!-- 角色库 -->
        <template v-if="activeResTab === 'lib-char'">
          <div id="drama-res-panel-lib-char" class="res-tabpanel" role="tabpanel" aria-labelledby="drama-res-tab-lib-char" tabindex="0">
          <div class="library-toolbar">
            <el-input v-model="charKw" placeholder="搜索角色" aria-label="搜索角色" clearable style="width: 200px" @input="onCharKwInput" />
            <el-button size="small" @click="openImport('char')">从素材库导入</el-button>
          </div>
          <div v-loading="charLoading" class="library-list">
            <div v-if="charError" class="library-error" role="alert">
              <span>
                {{ charError }}
                <template v-if="charList.length">当前仍显示上次成功加载的角色。</template>
              </span>
              <el-button size="small" type="primary" plain :loading="charLoading" @click="loadCharList">重试</el-button>
            </div>
            <div v-for="item in charList" :key="item.id" class="library-item">
              <button
                v-if="assetImageUrl(item)"
                type="button"
                class="library-item-cover"
                :aria-label="`预览${item.name || '角色'}图片`"
                @click="openPreview(assetImageUrl(item))"
              >
                <img :src="assetImageUrl(item)" :alt="item.name || '角色图片'" />
              </button>
              <div
                v-else
                class="library-item-cover library-item-cover--empty"
                role="img"
                :aria-label="`${item.name || '角色'}暂无图片`"
              >
                <span class="library-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || '').slice(0, 60) }}</div>
                <div class="library-item-actions">
                  <el-button size="small" @click="openEditChar(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="deleteChar(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!charLoading && !charError && charList.length === 0" class="library-empty resource-empty-state" role="status">
              <div class="empty-state-title">{{ charKw.trim() ? '没有匹配的角色' : '暂无本剧角色库记录' }}</div>
              <div class="empty-state-copy">{{ charKw.trim() ? '试试其他关键词，或清除搜索后重新查看。' : '可以从公共素材库导入角色，或先在制作页提取后再入库。' }}</div>
              <el-button v-if="charKw.trim()" size="small" @click="charKw = ''; loadCharList()">清除搜索</el-button>
              <el-button v-else size="small" type="primary" plain @click="openImport('char')">从素材库导入角色</el-button>
            </div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="charPage" v-model:page-size="charPageSize" :total="charTotal" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" aria-label="本剧角色分页" @current-change="loadCharList" @size-change="loadCharList" />
          </div>
          </div>
        </template>

        <!-- 场景库 -->
        <template v-if="activeResTab === 'lib-scene'">
          <div id="drama-res-panel-lib-scene" class="res-tabpanel" role="tabpanel" aria-labelledby="drama-res-tab-lib-scene" tabindex="0">
          <div class="library-toolbar">
            <el-input v-model="sceneKw" placeholder="搜索场景" aria-label="搜索场景" clearable style="width: 200px" @input="onSceneKwInput" />
            <el-button size="small" @click="openImport('scene')">从素材库导入</el-button>
          </div>
          <div v-loading="sceneLoading" class="library-list">
            <div v-if="sceneError" class="library-error" role="alert">
              <span>
                {{ sceneError }}
                <template v-if="sceneList.length">当前仍显示上次成功加载的场景。</template>
              </span>
              <el-button size="small" type="primary" plain :loading="sceneLoading" @click="loadSceneList">重试</el-button>
            </div>
            <div v-for="item in sceneList" :key="item.id" class="library-item">
              <button
                v-if="assetImageUrl(item)"
                type="button"
                class="library-item-cover"
                :aria-label="`预览${item.location || item.time || '场景'}图片`"
                @click="openPreview(assetImageUrl(item))"
              >
                <img :src="assetImageUrl(item)" :alt="item.location || item.time || '场景图片'" />
              </button>
              <div
                v-else
                class="library-item-cover library-item-cover--empty"
                role="img"
                :aria-label="`${item.location || item.time || '场景'}暂无图片`"
              >
                <span class="library-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.location || item.time || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}</div>
                <div class="library-item-actions">
                  <el-button size="small" @click="openEditScene(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="deleteScene(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!sceneLoading && !sceneError && sceneList.length === 0" class="library-empty resource-empty-state" role="status">
              <div class="empty-state-title">{{ sceneKw.trim() ? '没有匹配的场景' : '暂无本剧场景库记录' }}</div>
              <div class="empty-state-copy">{{ sceneKw.trim() ? '试试其他关键词，或清除搜索后重新查看。' : '可以从公共素材库导入场景，或先在制作页提取后再入库。' }}</div>
              <el-button v-if="sceneKw.trim()" size="small" @click="sceneKw = ''; loadSceneList()">清除搜索</el-button>
              <el-button v-else size="small" type="primary" plain @click="openImport('scene')">从素材库导入场景</el-button>
            </div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="scenePage" v-model:page-size="scenePageSize" :total="sceneTotal" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" aria-label="本剧场景分页" @current-change="loadSceneList" @size-change="loadSceneList" />
          </div>
          </div>
        </template>

        <!-- 道具库 -->
        <template v-if="activeResTab === 'lib-prop'">
          <div id="drama-res-panel-lib-prop" class="res-tabpanel" role="tabpanel" aria-labelledby="drama-res-tab-lib-prop" tabindex="0">
          <div class="library-toolbar">
            <el-input v-model="propKw" placeholder="搜索道具" aria-label="搜索道具" clearable style="width: 200px" @input="onPropKwInput" />
            <el-button size="small" @click="openImport('prop')">从素材库导入</el-button>
          </div>
          <div v-loading="propLoading" class="library-list">
            <div v-if="propError" class="library-error" role="alert">
              <span>
                {{ propError }}
                <template v-if="propList.length">当前仍显示上次成功加载的道具。</template>
              </span>
              <el-button size="small" type="primary" plain :loading="propLoading" @click="loadPropList">重试</el-button>
            </div>
            <div v-for="item in propList" :key="item.id" class="library-item">
              <button
                v-if="assetImageUrl(item)"
                type="button"
                class="library-item-cover"
                :aria-label="`预览${item.name || '道具'}图片`"
                @click="openPreview(assetImageUrl(item))"
              >
                <img :src="assetImageUrl(item)" :alt="item.name || '道具图片'" />
              </button>
              <div
                v-else
                class="library-item-cover library-item-cover--empty"
                role="img"
                :aria-label="`${item.name || '道具'}暂无图片`"
              >
                <span class="library-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}</div>
                <div class="library-item-actions">
                  <el-button size="small" @click="openEditProp(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="deleteProp(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!propLoading && !propError && propList.length === 0" class="library-empty resource-empty-state" role="status">
              <div class="empty-state-title">{{ propKw.trim() ? '没有匹配的道具' : '暂无本剧道具库记录' }}</div>
              <div class="empty-state-copy">{{ propKw.trim() ? '试试其他关键词，或清除搜索后重新查看。' : '可以从公共素材库导入道具，或先在制作页提取后再入库。' }}</div>
              <el-button v-if="propKw.trim()" size="small" @click="propKw = ''; loadPropList()">清除搜索</el-button>
              <el-button v-else size="small" type="primary" plain @click="openImport('prop')">从素材库导入道具</el-button>
            </div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="propPage" v-model:page-size="propPageSize" :total="propTotal" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" aria-label="本剧道具分页" @current-change="loadPropList" @size-change="loadPropList" />
          </div>
          </div>
        </template>
        <!-- 本剧制作角色 -->
        <template v-if="activeResTab === 'drama-char'">
          <div id="drama-res-panel-drama-char" class="drama-res-list res-tabpanel" role="tabpanel" aria-labelledby="drama-res-tab-drama-char" tabindex="0">
            <template v-if="drama?.characters?.length">
              <div v-for="item in drama.characters" :key="item.id" class="drama-res-item">
                <button
                  v-if="assetImageUrl(item)"
                  type="button"
                  class="drama-res-cover"
                  :aria-label="`预览${item.name || '制作角色'}图片`"
                  @click="openPreview(assetImageUrl(item))"
                >
                  <img :src="assetImageUrl(item)" :alt="item.name || '制作角色图片'" />
                </button>
                <div
                  v-else
                  class="drama-res-cover drama-res-cover--empty"
                  role="img"
                  :aria-label="`${item.name || '制作角色'}暂无图片`"
                >
                  <span class="library-placeholder">暂无图</span>
                </div>
                <div class="drama-res-info">
                  <div class="drama-res-name">{{ item.name || '未命名' }}</div>
                  <div class="drama-res-meta" v-if="characterRoleLabel(item.role)">
                    <el-tag size="small" type="info">{{ characterRoleLabel(item.role) }}</el-tag>
                  </div>
                  <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                  <div class="drama-res-actions">
                    <el-button size="small" @click="openEditDramaChar(item)">编辑</el-button>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="library-empty resource-empty-state" role="status">
              <div class="empty-state-title">本剧暂无制作角色</div>
              <div class="empty-state-copy">{{ currentEpisodeId ? '可进入制作页，从当前剧集提取角色。' : '请先新增一集，再进入制作页提取角色。' }}</div>
              <el-button size="small" type="primary" :loading="!currentEpisodeId && addingEpisode" :aria-label="currentEpisodeId ? '进入制作页提取角色' : '新增一集后再提取角色'" @click="goCreateOrAddEpisode">{{ currentEpisodeId ? '进入制作页提取角色' : '先去新增一集' }}</el-button>
            </div>
          </div>
        </template>

        <!-- 本剧制作场景 -->
        <template v-if="activeResTab === 'drama-scene'">
          <div id="drama-res-panel-drama-scene" class="drama-res-list res-tabpanel" role="tabpanel" aria-labelledby="drama-res-tab-drama-scene" tabindex="0">
            <template v-if="drama?.scenes?.length">
              <div v-for="item in drama.scenes" :key="item.id" class="drama-res-item">
                <button
                  v-if="assetImageUrl(item)"
                  type="button"
                  class="drama-res-cover"
                  :aria-label="`预览${item.location || '制作场景'}图片`"
                  @click="openPreview(assetImageUrl(item))"
                >
                  <img :src="assetImageUrl(item)" :alt="item.location || '制作场景图片'" />
                </button>
                <div
                  v-else
                  class="drama-res-cover drama-res-cover--empty"
                  role="img"
                  :aria-label="`${item.location || '制作场景'}暂无图片`"
                >
                  <span class="library-placeholder">暂无图</span>
                </div>
                <div class="drama-res-info">
                  <div class="drama-res-name">{{ item.location || '未命名' }}</div>
                  <div class="drama-res-meta" v-if="item.time">
                    <el-tag size="small" type="info">{{ item.time }}</el-tag>
                  </div>
                  <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                  <div class="drama-res-actions">
                    <el-button size="small" @click="openEditDramaScene(item)">编辑</el-button>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="library-empty resource-empty-state" role="status">
              <div class="empty-state-title">本剧暂无制作场景</div>
              <div class="empty-state-copy">{{ currentEpisodeId ? '可进入制作页，从当前剧集提取场景。' : '请先新增一集，再进入制作页提取场景。' }}</div>
              <el-button size="small" type="primary" :loading="!currentEpisodeId && addingEpisode" :aria-label="currentEpisodeId ? '进入制作页提取场景' : '新增一集后再提取场景'" @click="goCreateOrAddEpisode">{{ currentEpisodeId ? '进入制作页提取场景' : '先去新增一集' }}</el-button>
            </div>
          </div>
        </template>

        <!-- 本剧制作道具 -->
        <template v-if="activeResTab === 'drama-prop'">
          <div id="drama-res-panel-drama-prop" class="drama-res-list res-tabpanel" role="tabpanel" aria-labelledby="drama-res-tab-drama-prop" tabindex="0">
            <template v-if="drama?.props?.length">
              <div v-for="item in drama.props" :key="item.id" class="drama-res-item">
                <button
                  v-if="assetImageUrl(item)"
                  type="button"
                  class="drama-res-cover"
                  :aria-label="`预览${item.name || '制作道具'}图片`"
                  @click="openPreview(assetImageUrl(item))"
                >
                  <img :src="assetImageUrl(item)" :alt="item.name || '制作道具图片'" />
                </button>
                <div
                  v-else
                  class="drama-res-cover drama-res-cover--empty"
                  role="img"
                  :aria-label="`${item.name || '制作道具'}暂无图片`"
                >
                  <span class="library-placeholder">暂无图</span>
                </div>
                <div class="drama-res-info">
                  <div class="drama-res-name">{{ item.name || '未命名' }}</div>
                  <div class="drama-res-meta" v-if="propTypeLabel(item.type)">
                    <el-tag size="small" type="info">{{ propTypeLabel(item.type) }}</el-tag>
                  </div>
                  <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                  <div class="drama-res-actions">
                    <el-button size="small" @click="openEditDramaProp(item)">编辑</el-button>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="library-empty resource-empty-state" role="status">
              <div class="empty-state-title">本剧暂无制作道具</div>
              <div class="empty-state-copy">{{ currentEpisodeId ? '可进入制作页，从当前剧集提取道具。' : '请先新增一集，再进入制作页提取道具。' }}</div>
              <el-button size="small" type="primary" :loading="!currentEpisodeId && addingEpisode" :aria-label="currentEpisodeId ? '进入制作页提取道具' : '新增一集后再提取道具'" @click="goCreateOrAddEpisode">{{ currentEpisodeId ? '进入制作页提取道具' : '先去新增一集' }}</el-button>
            </div>
          </div>
        </template>
      </section>
</template>

<script setup>
// 本剧资源库只负责展示，搜索、导入、编辑和提取仍由页面处理

defineProps({
  drama: { type: Object, default: null },
  currentEpisodeId: { default: null },
  addingEpisode: { type: Boolean, default: false },
  charList: { type: Array, default: () => [] },
  charLoading: { type: Boolean, default: false },
  charError: { type: String, default: '' },
  charTotal: { type: Number, default: 0 },
  sceneList: { type: Array, default: () => [] },
  sceneLoading: { type: Boolean, default: false },
  sceneError: { type: String, default: '' },
  sceneTotal: { type: Number, default: 0 },
  propList: { type: Array, default: () => [] },
  propLoading: { type: Boolean, default: false },
  propError: { type: String, default: '' },
  propTotal: { type: Number, default: 0 },
  assetImageUrl: { type: Function, required: true },
  characterRoleLabel: { type: Function, required: true },
  propTypeLabel: { type: Function, required: true },
  onResourceTabKeydown: { type: Function, required: true },
  onCharKwInput: { type: Function, required: true },
  onSceneKwInput: { type: Function, required: true },
  onPropKwInput: { type: Function, required: true },
  loadCharList: { type: Function, required: true },
  loadSceneList: { type: Function, required: true },
  loadPropList: { type: Function, required: true },
  openImport: { type: Function, required: true },
  openPreview: { type: Function, required: true },
  openEditChar: { type: Function, required: true },
  openEditScene: { type: Function, required: true },
  openEditProp: { type: Function, required: true },
  deleteChar: { type: Function, required: true },
  deleteScene: { type: Function, required: true },
  deleteProp: { type: Function, required: true },
  openEditDramaChar: { type: Function, required: true },
  openEditDramaScene: { type: Function, required: true },
  openEditDramaProp: { type: Function, required: true },
  goCreateOrAddEpisode: { type: Function, required: true },
})

const activeResTab = defineModel('activeResTab', { type: String, default: 'lib-char' })
const charKw = defineModel('charKw', { type: String, default: '' })
const charPage = defineModel('charPage', { type: Number, default: 1 })
const charPageSize = defineModel('charPageSize', { type: Number, default: 10 })
const sceneKw = defineModel('sceneKw', { type: String, default: '' })
const scenePage = defineModel('scenePage', { type: Number, default: 1 })
const scenePageSize = defineModel('scenePageSize', { type: Number, default: 10 })
const propKw = defineModel('propKw', { type: String, default: '' })
const propPage = defineModel('propPage', { type: Number, default: 1 })
const propPageSize = defineModel('propPageSize', { type: Number, default: 10 })
</script>

<style scoped>
/* 分区卡片外观与页内其他卡片保持一致 */
.section.card {
  background: rgba(24, 24, 27, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 16px;
  padding: 20px 24px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
  transition: box-shadow 0.3s, border-color 0.3s;
}
.section.card:hover {
  border-color: rgba(139, 92, 246, 0.25);
  box-shadow: 0 6px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(139, 92, 246, 0.08);
}
html.light .section.card {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.06);
}
html.light .section.card:hover {
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 6px 28px rgba(139, 92, 246, 0.1);
}
.section-title { font-size: 1rem; font-weight: 600; color: #fafafa; margin-bottom: 16px; }
html.light .section-title { color: #18181b; }
.section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.section-header .section-title { margin-bottom: 0; }

.empty-state-title { color: var(--text-primary); font-size: 15px; font-weight: 600; }
.empty-state-copy { max-width: 620px; color: var(--text-subtle); font-size: 12px; line-height: 1.6; }

/* 资源库 */
.library-toolbar { margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
.library-list { min-height: 120px; display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto; }
.library-item { display: flex; gap: 12px; padding: 10px; background: #1c1c1e; border: 1px solid #27272a; border-radius: 8px; }
.library-item-cover { width: 72px; height: 72px; flex-shrink: 0; padding: 0; border: 0; border-radius: 6px; overflow: hidden; background: #27272a; color: inherit; font: inherit; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.library-item-cover img { width: 100%; height: 100%; object-fit: cover; }
.library-item-cover--empty { cursor: default; }
.library-placeholder { font-size: 0.8rem; color: #71717a; }
.library-item-info { flex: 1; min-width: 0; }
.library-item-name { font-weight: 500; color: #fafafa; margin-bottom: 4px; }
.library-item-desc { font-size: 0.85rem; color: #a1a1aa; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.library-item-actions { display: flex; gap: 8px; }
.library-empty { text-align: center; color: #71717a; padding: 40px 20px; }
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
.resource-empty-state { display: grid; justify-items: center; gap: 12px; width: 100%; }
.tooltip-trigger { display: inline-flex; }
.tooltip-trigger:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.library-pagination { margin-top: 12px; display: flex; justify-content: center; }

/* ——— 编辑器风格 Tab 栏 ——— */
.res-section { padding-bottom: 0 !important; }
.res-tabbar {
  display: flex;
  align-items: center;
  gap: 0;
  border-bottom: 1px solid var(--border-color, #27272a);
  padding: 0 4px;
  overflow-x: auto;
  scrollbar-width: none;
  margin: -4px -20px 0;
  padding-left: 20px;
}
.res-tabbar::-webkit-scrollbar { display: none; }
.res-tab-group-label {
  font-size: 11px;
  color: var(--text-faint, #52525b);
  padding: 0 8px 0 4px;
  white-space: nowrap;
  user-select: none;
  letter-spacing: 0.03em;
  align-self: center;
}
.res-tab-group-label--prod { color: #a78bfa; }
.res-tab-spacer {
  flex: 1;
  min-width: 40px;
}
.res-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 9px 16px 8px;
  font-size: 13px;
  color: var(--text-secondary, #a1a1aa);
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
}
.res-tab:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.res-tab::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: transparent;
  transition: background 0.15s;
}
.res-tab:hover { color: var(--text-primary); background: var(--bg-inner, rgba(255,255,255,0.04)); }
/* 资源库激活 */
.res-tab--lib.active { color: #60a5fa; font-size: 14px; font-weight: 600; }
.res-tab--lib.active::after { background: #60a5fa; }
/* 制作资源激活 */
.res-tab--drama.active { color: #a78bfa; font-size: 14px; font-weight: 600; }
.res-tab--drama.active::after { background: #a78bfa; }

html.light .res-tab:hover { background: rgba(0,0,0,0.04); }
html.light .res-tab--lib.active { color: #2563eb; }
html.light .res-tab--lib.active::after { background: #2563eb; }
html.light .res-tab--drama.active { color: #7c3aed; }
html.light .res-tab--drama.active::after { background: #7c3aed; }

/* 本剧制作资源列表 */
.drama-res-list { display: flex; flex-wrap: wrap; gap: 12px; padding: 4px 0 8px; }
.drama-res-item { display: flex; gap: 12px; width: calc(50% - 6px); background: var(--bg-inner, #1c1c1e); border: 1px solid var(--border-color, #27272a); border-radius: 8px; padding: 10px; box-sizing: border-box; }
.drama-res-cover { width: 72px; height: 72px; padding: 0; border: 0; border-radius: 6px; overflow: hidden; flex-shrink: 0; cursor: zoom-in; background: var(--bg-page, #0f0f12); color: inherit; font: inherit; display: flex; align-items: center; justify-content: center; }
.drama-res-cover img { width: 100%; height: 100%; object-fit: cover; }
.drama-res-cover--empty { cursor: default; }
.drama-res-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.drama-res-name { font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.drama-res-meta { display: flex; gap: 4px; flex-wrap: wrap; }
.drama-res-desc { font-size: 12px; color: var(--text-secondary, #a1a1aa); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.drama-res-actions { margin-top: 6px; }

/* 图片预览 */
.library-item-cover:focus-visible,
.drama-res-cover:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.library-item-cover:disabled,
.library-item-cover--empty,
.drama-res-cover:disabled,
.drama-res-cover--empty { cursor: default; }

#project-resources {
  scroll-margin-top: 120px;
}

@media (max-width: 760px) {
  .section.card {
    padding: 16px;
  }
  .drama-res-item {
    width: 100%;
  }
}

</style>
