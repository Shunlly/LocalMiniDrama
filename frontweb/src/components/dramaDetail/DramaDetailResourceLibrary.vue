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
            :aria-label="`资源库${t.label}`"
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
            :aria-label="`制作资源${t.label}`"
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
            <el-button size="small" aria-label="从素材库导入角色" @click="openImport('char')">从素材库导入</el-button>
          </div>
          <DramaDetailResourceLibraryList :loading="charLoading" :items="charList">
            <template #error>
              <div v-if="charError" class="library-error" role="alert">
                <span>
                  {{ charError }}
                  <template v-if="charList.length">当前仍显示上次成功加载的角色。</template>
                </span>
                <el-button size="small" type="primary" plain :loading="charLoading" :aria-label="charLoading ? '正在加载角色库，请稍候' : '重试加载角色库'" @click="loadCharList">重试</el-button>
              </div>
            </template>
            <template #item="{ item }">
              <DramaDetailResourceCover
                v-if="assetImageUrl(item)"
                type="button"
                class="library-item-cover"
                variant="library"
                :image-url="assetImageUrl(item)"
                :preview-label="`预览${item.name || '角色'}图片`"
                :image-alt="item.name || '角色图片'"
                :empty-label="`${item.name || '角色'}暂无图片`"
                :open-preview="openPreview"
              />
              <DramaDetailResourceCover
                v-else
                class="library-item-cover library-item-cover--empty"
                variant="library"
                image-url=""
                :preview-label="`预览${item.name || '角色'}图片`"
                :image-alt="item.name || '角色图片'"
                :empty-label="`${item.name || '角色'}暂无图片`"
                :open-preview="openPreview"
              />
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || '').slice(0, 60) }}</div>
                <div class="library-item-actions">
                  <el-button size="small" :aria-label="`编辑角色${item.name || '未命名角色'}`" @click="openEditChar(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain :aria-label="`删除角色${item.name || '未命名角色'}`" @click="deleteChar(item)">删除</el-button>
                </div>
              </div>
            </template>
            <template #empty>
              <DramaDetailResourceEmptyState
                v-if="!charLoading && !charError && charList.length === 0"
                :title="charKw.trim() ? '没有匹配的角色' : '暂无本剧角色库记录'"
                :copy="charKw.trim() ? '试试其他关键词，或清除搜索后重新查看。' : '可以从公共素材库导入角色，或先在制作页提取后再入库。'"
              >
                <el-button v-if="charKw.trim()" size="small" aria-label="清除角色搜索" @click="charKw = ''; loadCharList()">清除角色搜索</el-button>
                <el-button v-else size="small" type="primary" plain aria-label="从素材库导入角色" @click="openImport('char')">从素材库导入角色</el-button>
              </DramaDetailResourceEmptyState>
            </template>
          </DramaDetailResourceLibraryList>
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
            <el-button size="small" aria-label="从素材库导入场景" @click="openImport('scene')">从素材库导入</el-button>
          </div>
          <DramaDetailResourceLibraryList :loading="sceneLoading" :items="sceneList">
            <template #error>
              <div v-if="sceneError" class="library-error" role="alert">
                <span>
                  {{ sceneError }}
                  <template v-if="sceneList.length">当前仍显示上次成功加载的场景。</template>
                </span>
                <el-button size="small" type="primary" plain :loading="sceneLoading" :aria-label="sceneLoading ? '正在加载场景库，请稍候' : '重试加载场景库'" @click="loadSceneList">重试</el-button>
              </div>
            </template>
            <template #item="{ item }">
              <DramaDetailResourceCover
                v-if="assetImageUrl(item)"
                type="button"
                class="library-item-cover"
                variant="library"
                :image-url="assetImageUrl(item)"
                :preview-label="`预览${item.location || item.time || '场景'}图片`"
                :image-alt="item.location || item.time || '场景图片'"
                :empty-label="`${item.location || item.time || '场景'}暂无图片`"
                :open-preview="openPreview"
              />
              <DramaDetailResourceCover
                v-else
                class="library-item-cover library-item-cover--empty"
                variant="library"
                image-url=""
                :preview-label="`预览${item.location || item.time || '场景'}图片`"
                :image-alt="item.location || item.time || '场景图片'"
                :empty-label="`${item.location || item.time || '场景'}暂无图片`"
                :open-preview="openPreview"
              />
              <div class="library-item-info">
                <div class="library-item-name">{{ item.location || item.time || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}</div>
                <div class="library-item-actions">
                  <el-button size="small" :aria-label="`编辑场景${item.location || '未命名场景'}`" @click="openEditScene(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain :aria-label="`删除场景${item.location || '未命名场景'}`" @click="deleteScene(item)">删除</el-button>
                </div>
              </div>
            </template>
            <template #empty>
              <DramaDetailResourceEmptyState
                v-if="!sceneLoading && !sceneError && sceneList.length === 0"
                :title="sceneKw.trim() ? '没有匹配的场景' : '暂无本剧场景库记录'"
                :copy="sceneKw.trim() ? '试试其他关键词，或清除搜索后重新查看。' : '可以从公共素材库导入场景，或先在制作页提取后再入库。'"
              >
                <el-button v-if="sceneKw.trim()" size="small" aria-label="清除场景搜索" @click="sceneKw = ''; loadSceneList()">清除场景搜索</el-button>
                <el-button v-else size="small" type="primary" plain aria-label="从素材库导入场景" @click="openImport('scene')">从素材库导入场景</el-button>
              </DramaDetailResourceEmptyState>
            </template>
          </DramaDetailResourceLibraryList>
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
            <el-button size="small" aria-label="从素材库导入道具" @click="openImport('prop')">从素材库导入</el-button>
          </div>
          <DramaDetailResourceLibraryList :loading="propLoading" :items="propList">
            <template #error>
              <div v-if="propError" class="library-error" role="alert">
                <span>
                  {{ propError }}
                  <template v-if="propList.length">当前仍显示上次成功加载的道具。</template>
                </span>
                <el-button size="small" type="primary" plain :loading="propLoading" :aria-label="propLoading ? '正在加载道具库，请稍候' : '重试加载道具库'" @click="loadPropList">重试</el-button>
              </div>
            </template>
            <template #item="{ item }">
              <DramaDetailResourceCover
                v-if="assetImageUrl(item)"
                type="button"
                class="library-item-cover"
                variant="library"
                :image-url="assetImageUrl(item)"
                :preview-label="`预览${item.name || '道具'}图片`"
                :image-alt="item.name || '道具图片'"
                :empty-label="`${item.name || '道具'}暂无图片`"
                :open-preview="openPreview"
              />
              <DramaDetailResourceCover
                v-else
                class="library-item-cover library-item-cover--empty"
                variant="library"
                image-url=""
                :preview-label="`预览${item.name || '道具'}图片`"
                :image-alt="item.name || '道具图片'"
                :empty-label="`${item.name || '道具'}暂无图片`"
                :open-preview="openPreview"
              />
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}</div>
                <div class="library-item-actions">
                  <el-button size="small" :aria-label="`编辑道具${item.name || '未命名道具'}`" @click="openEditProp(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain :aria-label="`删除道具${item.name || '未命名道具'}`" @click="deleteProp(item)">删除</el-button>
                </div>
              </div>
            </template>
            <template #empty>
              <DramaDetailResourceEmptyState
                v-if="!propLoading && !propError && propList.length === 0"
                :title="propKw.trim() ? '没有匹配的道具' : '暂无本剧道具库记录'"
                :copy="propKw.trim() ? '试试其他关键词，或清除搜索后重新查看。' : '可以从公共素材库导入道具，或先在制作页提取后再入库。'"
              >
                <el-button v-if="propKw.trim()" size="small" aria-label="清除道具搜索" @click="propKw = ''; loadPropList()">清除道具搜索</el-button>
                <el-button v-else size="small" type="primary" plain aria-label="从素材库导入道具" @click="openImport('prop')">从素材库导入道具</el-button>
              </DramaDetailResourceEmptyState>
            </template>
          </DramaDetailResourceLibraryList>
          <div class="library-pagination">
            <el-pagination v-model:current-page="propPage" v-model:page-size="propPageSize" :total="propTotal" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" aria-label="本剧道具分页" @current-change="loadPropList" @size-change="loadPropList" />
          </div>
          </div>
        </template>
        <!-- 本剧制作角色 -->
        <template v-if="activeResTab === 'drama-char'">
          <DramaDetailResourceProductionList
            panel-id="drama-res-panel-drama-char"
            labelled-by="drama-res-tab-drama-char"
            :items="drama?.characters ?? []"
          >
            <template #item="{ item }">
              <DramaDetailResourceCover
                v-if="assetImageUrl(item)"
                type="button"
                class="drama-res-cover"
                variant="drama"
                :image-url="assetImageUrl(item)"
                :preview-label="`预览${item.name || '制作角色'}图片`"
                :image-alt="item.name || '制作角色图片'"
                :empty-label="`${item.name || '制作角色'}暂无图片`"
                :open-preview="openPreview"
              />
              <DramaDetailResourceCover
                v-else
                class="drama-res-cover drama-res-cover--empty"
                variant="drama"
                image-url=""
                :preview-label="`预览${item.name || '制作角色'}图片`"
                :image-alt="item.name || '制作角色图片'"
                :empty-label="`${item.name || '制作角色'}暂无图片`"
                :open-preview="openPreview"
              />
              <div class="drama-res-info">
                <div class="drama-res-name">{{ item.name || '未命名' }}</div>
                <div v-if="characterRoleLabel(item.role)" class="drama-res-meta">
                  <el-tag size="small" type="info">{{ characterRoleLabel(item.role) }}</el-tag>
                </div>
                <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                <div class="drama-res-actions">
                  <el-button size="small" :aria-label="`编辑制作角色${item.name || '未命名角色'}`" @click="openEditDramaChar(item)">编辑</el-button>
                </div>
              </div>
            </template>
            <template #empty>
              <DramaDetailResourceEmptyState
                title="本剧暂无制作角色"
                :copy="currentEpisodeId ? '可进入制作页，从当前剧集提取角色。' : '请先新增一集，再进入制作页提取角色。'"
              >
                <el-button size="small" type="primary" :loading="!currentEpisodeId && addingEpisode" :aria-label="currentEpisodeId ? '进入制作页提取角色' : '新增一集后再提取角色'" @click="goCreateOrAddEpisode">{{ currentEpisodeId ? '进入制作页提取角色' : '先去新增一集' }}</el-button>
              </DramaDetailResourceEmptyState>
            </template>
          </DramaDetailResourceProductionList>
        </template>

        <!-- 本剧制作场景 -->
        <template v-if="activeResTab === 'drama-scene'">
          <DramaDetailResourceProductionList
            panel-id="drama-res-panel-drama-scene"
            labelled-by="drama-res-tab-drama-scene"
            :items="drama?.scenes ?? []"
          >
            <template #item="{ item }">
              <DramaDetailResourceCover
                v-if="assetImageUrl(item)"
                type="button"
                class="drama-res-cover"
                variant="drama"
                :image-url="assetImageUrl(item)"
                :preview-label="`预览${item.location || '制作场景'}图片`"
                :image-alt="item.location || '制作场景图片'"
                :empty-label="`${item.location || '制作场景'}暂无图片`"
                :open-preview="openPreview"
              />
              <DramaDetailResourceCover
                v-else
                class="drama-res-cover drama-res-cover--empty"
                variant="drama"
                image-url=""
                :preview-label="`预览${item.location || '制作场景'}图片`"
                :image-alt="item.location || '制作场景图片'"
                :empty-label="`${item.location || '制作场景'}暂无图片`"
                :open-preview="openPreview"
              />
              <div class="drama-res-info">
                <div class="drama-res-name">{{ item.location || '未命名' }}</div>
                <div v-if="item.time" class="drama-res-meta">
                  <el-tag size="small" type="info">{{ item.time }}</el-tag>
                </div>
                <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                <div class="drama-res-actions">
                  <el-button size="small" :aria-label="`编辑制作场景${item.location || '未命名场景'}`" @click="openEditDramaScene(item)">编辑</el-button>
                </div>
              </div>
            </template>
            <template #empty>
              <DramaDetailResourceEmptyState
                title="本剧暂无制作场景"
                :copy="currentEpisodeId ? '可进入制作页，从当前剧集提取场景。' : '请先新增一集，再进入制作页提取场景。'"
              >
                <el-button size="small" type="primary" :loading="!currentEpisodeId && addingEpisode" :aria-label="currentEpisodeId ? '进入制作页提取场景' : '新增一集后再提取场景'" @click="goCreateOrAddEpisode">{{ currentEpisodeId ? '进入制作页提取场景' : '先去新增一集' }}</el-button>
              </DramaDetailResourceEmptyState>
            </template>
          </DramaDetailResourceProductionList>
        </template>

        <!-- 本剧制作道具 -->
        <template v-if="activeResTab === 'drama-prop'">
          <DramaDetailResourceProductionList
            panel-id="drama-res-panel-drama-prop"
            labelled-by="drama-res-tab-drama-prop"
            :items="drama?.props ?? []"
          >
            <template #item="{ item }">
              <DramaDetailResourceCover
                v-if="assetImageUrl(item)"
                type="button"
                class="drama-res-cover"
                variant="drama"
                :image-url="assetImageUrl(item)"
                :preview-label="`预览${item.name || '制作道具'}图片`"
                :image-alt="item.name || '制作道具图片'"
                :empty-label="`${item.name || '制作道具'}暂无图片`"
                :open-preview="openPreview"
              />
              <DramaDetailResourceCover
                v-else
                class="drama-res-cover drama-res-cover--empty"
                variant="drama"
                image-url=""
                :preview-label="`预览${item.name || '制作道具'}图片`"
                :image-alt="item.name || '制作道具图片'"
                :empty-label="`${item.name || '制作道具'}暂无图片`"
                :open-preview="openPreview"
              />
              <div class="drama-res-info">
                <div class="drama-res-name">{{ item.name || '未命名' }}</div>
                <div v-if="propTypeLabel(item.type)" class="drama-res-meta">
                  <el-tag size="small" type="info">{{ propTypeLabel(item.type) }}</el-tag>
                </div>
                <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                <div class="drama-res-actions">
                  <el-button size="small" :aria-label="`编辑制作道具${item.name || '未命名道具'}`" @click="openEditDramaProp(item)">编辑</el-button>
                </div>
              </div>
            </template>
            <template #empty>
              <DramaDetailResourceEmptyState
                title="本剧暂无制作道具"
                :copy="currentEpisodeId ? '可进入制作页，从当前剧集提取道具。' : '请先新增一集，再进入制作页提取道具。'"
              >
                <el-button size="small" type="primary" :loading="!currentEpisodeId && addingEpisode" :aria-label="currentEpisodeId ? '进入制作页提取道具' : '新增一集后再提取道具'" @click="goCreateOrAddEpisode">{{ currentEpisodeId ? '进入制作页提取道具' : '先去新增一集' }}</el-button>
              </DramaDetailResourceEmptyState>
            </template>
          </DramaDetailResourceProductionList>
        </template>
      </section>
</template>

<script setup>
// 本剧资源库只负责展示，搜索、导入、编辑和提取仍由页面处理
import DramaDetailResourceCover from './DramaDetailResourceCover.vue'
import DramaDetailResourceEmptyState from './DramaDetailResourceEmptyState.vue'
import DramaDetailResourceLibraryList from './DramaDetailResourceLibraryList.vue'
import DramaDetailResourceProductionList from './DramaDetailResourceProductionList.vue'

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
#project-resources {
  scroll-margin-top: 120px;
}
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

.library-toolbar { margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
.library-item-info { flex: 1; min-width: 0; }
.library-item-name { font-weight: 500; color: #fafafa; margin-bottom: 4px; }
.library-item-desc { font-size: 0.85rem; color: #a1a1aa; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.library-item-actions { display: flex; gap: 8px; }
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

.drama-res-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.drama-res-name { font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.drama-res-meta { display: flex; gap: 4px; flex-wrap: wrap; }
.drama-res-desc { font-size: 12px; color: var(--text-secondary, #a1a1aa); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.drama-res-actions { margin-top: 6px; }

@media (max-width: 760px) {
  .section.card {
    padding: 16px;
  }
}
</style>
