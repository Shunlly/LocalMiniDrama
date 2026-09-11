<template>
  <AccessibleDialog
    v-model="showCharSd2Cert"
    title="认证资产详情"
    width="min(720px, 92vw)"
    destroy-on-close
    class="sd2-cert-dialog"
  >
    <template v-if="charSd2CertPayload">
      <el-descriptions :column="1" border size="small" class="sd2-cert-desc">
        <el-descriptions-item label="素材编号">
          <span class="sd2-cert-value">{{ charSd2CertPayload.hub_asset_id || '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="素材地址">
          <code class="sd2-cert-value">{{ charSd2CertPayload.asset_url || '—' }}</code>
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <span class="sd2-cert-value">{{ charSd2CertPayload.status || '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="来源图">
          <span class="sd2-cert-value">{{ charSd2CertPayload.source_image_url || '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item v-if="charSd2CertPayload.sd2_provider" label="认证提供方">
          <span class="sd2-cert-value">{{ charSd2CertPayload.sd2_provider }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </template>
    <template #footer>
      <el-button aria-label="关闭角色音色认证" @click="showCharSd2Cert = false">关闭</el-button>
    </template>
  </AccessibleDialog>

  <!-- 角色资源库（本剧库 / 本剧全部角色 / 团队库） -->
  <AccessibleDialog v-model="showCharLibrary" title="角色资源库" width="720px" destroy-on-close class="library-dialog" @open="onCharLibraryDialogOpen">
    <el-tabs v-model="charLibraryTab" class="char-library-tabs" aria-label="角色资源库分类" @tab-change="onCharLibraryTabChange">
      <el-tab-pane label="本剧角色库" name="library">
        <div class="library-toolbar">
          <el-input v-model="charLibraryKeyword" aria-label="搜索角色素材" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadCharLibrary()" />
        </div>
        <div v-loading="charLibraryLoading" class="library-list">
          <div v-for="item in charLibraryList" :key="'lib-' + item.id" class="library-item">
            <button type="button" class="library-item-cover" :disabled="!assetImageUrl(item)" :aria-label="`预览${item.name || '角色'}图片`" @click="openImagePreview(assetImageUrl(item))">
              <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" :alt="item.name || '角色图片'" />
              <span v-else class="library-item-placeholder">暂无图</span>
            </button>
            <div class="library-item-info">
              <div class="library-item-name">{{ item.name || '未命名' }}</div>
              <div class="library-item-desc">{{ (item.description || '').slice(0, 60) }}{{ (item.description || '').length > 60 ? '…' : '' }}</div>
              <div class="library-item-actions">
                <ActionGate :reason="addToEpisodeDisabledReason" label="加入本集">
                  <el-button size="small" type="primary" :loading="isCharAddToEpisodeLoading('library', item.id)" :disabled="Boolean(addToEpisodeDisabledReason)" :title="addToEpisodeDisabledReason || undefined" :aria-label="isCharAddToEpisodeLoading('library', item.id) ? '正在将角色加入本集，请稍候' : (addToEpisodeDisabledReason || `将${item.name || '未命名角色'}加入本集`)" @click="onAddCharFromLibrary(item)">加入本集</el-button>
                </ActionGate>
                <el-button size="small" :aria-label="`编辑公共角色${item.name || '未命名角色'}`" @click="openEditCharLibrary(item)">编辑</el-button>
                <el-button size="small" type="danger" plain :aria-label="`删除公共角色${item.name || '未命名角色'}`" @click="onDeleteCharLibrary(item)">删除</el-button>
              </div>
            </div>
          </div>
          <div v-if="!charLibraryLoading && charLibraryList.length === 0" class="library-empty" role="status">
            <p>暂无本剧角色库记录，可将本剧角色「加入本剧库」后在此查看</p>
            <div class="library-empty-actions">
              <el-button type="primary" aria-label="去角色面板" @click="returnToCharacterPanel">去角色面板</el-button>
            </div>
          </div>
        </div>
        <div class="library-pagination">
          <el-pagination
            v-model:current-page="charLibraryPage"
            v-model:page-size="charLibraryPageSize"
            :total="charLibraryTotal"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            @current-change="loadCharLibraryList"
            @size-change="loadCharLibraryList"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="本剧所有角色" name="drama">
        <div class="library-toolbar">
          <el-input v-model="dramaAllCharKeyword" aria-label="搜索本剧角色" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllCharList()" />
        </div>
        <div v-loading="dramaAllCharLoading" class="library-list">
          <div v-for="item in dramaAllCharList" :key="'drama-' + item.id" class="library-item">
            <button type="button" class="library-item-cover" :disabled="!assetImageUrl(item)" :aria-label="`预览${item.name || '角色'}图片`" @click="openImagePreview(assetImageUrl(item))">
              <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" :alt="item.name || '角色图片'" />
              <span v-else class="library-item-placeholder">暂无图</span>
            </button>
            <div class="library-item-info">
              <div class="library-item-name">
                {{ item.name || '未命名' }}
                <el-tag v-if="item.role" size="small" type="info" style="margin-left: 6px">{{ charRoleLabel(item.role) }}</el-tag>
              </div>
              <div class="library-item-desc">{{ (item.description || item.appearance || '').slice(0, 60) }}{{ (item.description || item.appearance || '').length > 60 ? '…' : '' }}</div>
              <div class="library-item-actions">
                <ActionGate :reason="addToEpisodeDisabledReason" label="加入本集">
                  <el-button size="small" type="primary" :loading="isCharAddToEpisodeLoading('drama', item.id)" :disabled="Boolean(addToEpisodeDisabledReason)" :title="addToEpisodeDisabledReason || undefined" :aria-label="isCharAddToEpisodeLoading('drama', item.id) ? '正在将角色加入本集，请稍候' : (addToEpisodeDisabledReason || `将${item.name || '未命名角色'}加入本集`)" @click="onAddDramaCharToEpisode(item)">加入本集</el-button>
                </ActionGate>
              </div>
            </div>
          </div>
          <div v-if="!dramaAllCharLoading && dramaAllCharList.length === 0" class="library-empty" role="status">
            <p>本剧暂无制作角色</p>
            <div class="library-empty-actions">
              <el-button type="primary" aria-label="创建角色" @click="returnToCharacterPanel">创建角色</el-button>
            </div>
          </div>
        </div>
        <div class="library-pagination">
          <el-pagination
            v-model:current-page="dramaAllCharPage"
            v-model:page-size="dramaAllCharPageSize"
            :total="dramaAllCharTotal"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            @current-change="loadDramaAllCharList"
            @size-change="loadDramaAllCharList"
          />
        </div>
      </el-tab-pane>

    </el-tabs>
    <template #footer>
      <el-button aria-label="关闭本剧角色库" @click="showCharLibrary = false">关闭</el-button>
    </template>
  </AccessibleDialog>
  <!-- 编辑公共角色 -->
  <AccessibleDialog v-model="showEditCharLibrary" title="编辑公共角色" width="440px" @close="editCharLibraryForm = null">
    <el-form v-if="editCharLibraryForm" label-width="80px">
      <el-form-item label="名称">
        <el-input v-model="editCharLibraryForm.name" aria-label="公共角色名称" placeholder="角色名称" />
      </el-form-item>
      <el-form-item label="分类">
        <el-input v-model="editCharLibraryForm.category" aria-label="公共角色分类" placeholder="可选" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="editCharLibraryForm.description" type="textarea" :rows="3" aria-label="公共角色描述" placeholder="可选" />
      </el-form-item>
      <el-form-item label="标签">
        <el-input v-model="editCharLibraryForm.tags" aria-label="公共角色标签" placeholder="可选，逗号分隔" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button aria-label="取消编辑公共角色" @click="showEditCharLibrary = false">取消</el-button>
      <el-button type="primary" :loading="editCharLibrarySaving" :title="editCharLibrarySaving ? '正在保存公共角色，请稍候' : undefined" :aria-label="editCharLibrarySaving ? '正在保存公共角色，请稍候' : '保存公共角色'" @click="submitEditCharLibrary">保存</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import ActionGate from './ActionGate.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  charLibraryList: { type: Array, default: () => [] },
  charLibraryLoading: { type: Boolean, default: false },
  charLibraryTotal: { type: Number, default: 0 },
  charSd2CertPayload: { type: Object, default: null },
  dramaAllCharList: { type: Array, default: () => [] },
  dramaAllCharLoading: { type: Boolean, default: false },
  dramaAllCharTotal: { type: Number, default: 0 },
  editCharLibrarySaving: { type: Boolean, default: false },
  assetImageUrl: { type: Function, required: true },
  charRoleLabel: { type: Function, required: true },
  debouncedLoadCharLibrary: { type: Function, required: true },
  debouncedLoadDramaAllCharList: { type: Function, required: true },
  isCharAddToEpisodeLoading: { type: Function, required: true },
  loadCharLibraryList: { type: Function, required: true },
  loadDramaAllCharList: { type: Function, required: true },
  onAddCharFromLibrary: { type: Function, required: true },
  onAddDramaCharToEpisode: { type: Function, required: true },
  onCharLibraryDialogOpen: { type: Function, required: true },
  onCharLibraryTabChange: { type: Function, required: true },
  onDeleteCharLibrary: { type: Function, required: true },
  openEditCharLibrary: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  returnToCharacterPanel: { type: Function, required: true },
  submitEditCharLibrary: { type: Function, required: true },
  addToEpisodeDisabledReason: { type: String, default: '' },
})

const editCharLibraryForm = defineModel('editCharLibraryForm', { type: Object, default: null })
const showCharLibrary = defineModel('showCharLibrary', { type: Boolean, default: false })
const showCharSd2Cert = defineModel('showCharSd2Cert', { type: Boolean, default: false })
const showEditCharLibrary = defineModel('showEditCharLibrary', { type: Boolean, default: false })
const charLibraryKeyword = defineModel('charLibraryKeyword', { type: String, default: '' })
const charLibraryPage = defineModel('charLibraryPage', { type: Number, default: 1 })
const charLibraryPageSize = defineModel('charLibraryPageSize', { type: Number, default: 20 })
const charLibraryTab = defineModel('charLibraryTab', { type: String, default: '' })
const dramaAllCharKeyword = defineModel('dramaAllCharKeyword', { type: String, default: '' })
const dramaAllCharPage = defineModel('dramaAllCharPage', { type: Number, default: 1 })
const dramaAllCharPageSize = defineModel('dramaAllCharPageSize', { type: Number, default: 20 })
</script>

<style scoped src="./filmCreateResourceLibrary.css"></style>
