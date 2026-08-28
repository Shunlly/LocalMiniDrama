<template>
  <div class="film-create-resource-dialogs">
    <!-- 添加道具弹窗 -->
    <AccessibleDialog v-model="showAddProp" title="添加道具" width="600px" @close="() => { addPropForm = { name: '', type: '', description: '', prompt: '' }; addPropAddRefImage = null }">
      <el-form label-width="90px">
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <button type="button" class="ref-image-box" aria-label="选择道具参考图" @click="addPropAddRefFileInput?.click()" @drop.prevent="onRefImageDrop2('addProp', $event)" @dragover.prevent>
              <img v-if="addPropAddRefImage" :src="addPropAddRefImage.dataUrl" alt="待上传道具参考图" class="ref-preview-img" />
              <span v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></span>
            </button>
            <div v-if="addPropAddRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingPropAddDesc" @click="doExtractFromRef2('addProp')">提取特征描述</el-button>
              <el-button size="small" @click="addPropAddRefImage = null">移除</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="addPropForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="类型">
          <el-input v-model="addPropForm.type" placeholder="如：道具、建筑" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="addPropForm.description" type="textarea" :rows="3" placeholder="描述" />
        </el-form-item>
        <el-form-item label="图生提示词">
          <el-input v-model="addPropForm.prompt" type="textarea" :rows="2" placeholder="用于 AI 生成图片的提示词" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddProp = false">取消</el-button>
        <el-button type="primary" :loading="addPropSaving" :disabled="!addPropForm.name.trim()" @click="submitAddProp">确定</el-button>
      </template>
    </AccessibleDialog>

    <!-- 隐藏的文件输入框（放在弹窗外层，避免 el-form-item 干扰） -->
    <input ref="addCharRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('character', $event)" />
    <input ref="addSceneRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('scene', $event)" />
    <input ref="addPropRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('prop', $event)" />
    <input ref="addPropAddRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange2('addProp', $event)" />

    <!-- 添加/编辑角色弹窗 -->
    <AccessibleDialog v-model="showEditCharacter" :title="editCharacterForm?.id ? '编辑角色' : '添加角色'" width="75%" @close="onCloseCharDialog">
      <el-form v-if="editCharacterForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <button type="button" class="ref-image-box" aria-label="选择角色参考图" @click="addCharRefFileInput?.click()" @drop.prevent="onRefImageDrop('character', $event)" @dragover.prevent>
              <!-- 优先：刚上传的新参考图 -->
              <img v-if="addCharRefImage" :src="addCharRefImage.dataUrl" alt="待上传角色参考图" class="ref-preview-img" />
              <!-- 次之：已保存的参考图 -->
              <img v-else-if="editCharacterForm.ref_image"
                :src="editCharacterForm.ref_image.startsWith('http') ? editCharacterForm.ref_image : '/static/' + editCharacterForm.ref_image"
                alt="已保存角色参考图"
                class="ref-preview-img" />
              <!-- 最后：主图（半透明，提示可上传参考图替代） -->
              <img v-else-if="editCharacterForm.id && (editCharacterForm.image_url || editCharacterForm.local_path)"
                :src="assetImageUrl(editCharacterForm)"
                alt="角色主图"
                class="ref-preview-img" style="opacity:0.5" />
              <span v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></span>
            </button>
            <div v-if="addCharRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingCharAppearance" @click="doExtractFromRef('character')">提取特征描述</el-button>
              <el-button size="small" @click="addCharRefImage = null">移除</el-button>
            </div>
            <div v-else-if="editCharacterForm.ref_image" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingCharAppearance" @click="doExtractCharFromImage">从参考图提取描述</el-button>
              <el-button size="small" @click="clearCharRefImage">移除参考图</el-button>
            </div>
            <div v-else-if="editCharacterForm.id && (editCharacterForm.image_url || editCharacterForm.local_path) && !editCharacterForm.appearance" class="ref-actions">
              <el-button size="small" :loading="extractingCharAppearance" @click="doExtractCharFromImage">从主图提取描述</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="editCharacterForm.name" placeholder="角色名称" />
        </el-form-item>
        <el-form-item label="身份/定位">
          <el-select v-model="editCharacterForm.role" :aria-label="`角色${editCharacterForm.name || '未命名角色'}身份定位`" placeholder="请选择角色类型" style="width:200px">
            <el-option value="main" label="主角" />
            <el-option value="supporting" label="配角" />
            <el-option value="minor" label="次要角色" />
          </el-select>
        </el-form-item>
        <el-form-item label="外貌描述">
          <el-input v-model="editCharacterForm.appearance" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="用于 AI 生成图像的外貌描述，尽量详细" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="editCharacterForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="角色背景简介，供剧本生成参考" />
        </el-form-item>
        <el-form-item v-if="editCharacterForm.id">
          <template #label>
            <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">图生提示词</span>
          </template>
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 润色后的最终提示词，生成四视图图片时直接使用；可手动修改</span>
              <el-button
                size="small"
                :loading="editCharacterPromptGenerating"
                @click="doGenerateCharacterPrompt"
              >重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editCharacterForm.polished_prompt"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              :placeholder="editCharacterPromptGenerating ? 'AI 正在生成提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
              :disabled="editCharacterPromptGenerating"
              style="font-size:12px"
            />
          </div>
        </el-form-item>
        <!-- P0-2: 视觉锚点（identity_anchors） -->
        <el-form-item v-if="editCharacterForm.id" label="视觉锚点">
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 从外貌描述提炼的6层视觉特征，用于保持生成图片角色一致性</span>
              <el-button
                size="small"
                :loading="extractingAnchors"
                :disabled="!editCharacterForm.appearance"
                @click="extractIdentityAnchors"
              >提炼视觉锚点</el-button>
            </div>
            <el-input
              v-if="editCharacterForm.identity_anchors"
              :value="typeof editCharacterForm.identity_anchors === 'string'
                ? editCharacterForm.identity_anchors
                : JSON.stringify(editCharacterForm.identity_anchors, null, 2)"
              type="textarea"
              :rows="4"
              readonly
              style="font-size:11px;font-family:monospace"
              placeholder="点击「提炼视觉锚点」生成"
            />
            <div v-else style="font-size:12px;color:#c0c4cc;padding:4px 0">暂无锚点，点击「提炼视觉锚点」自动提炼</div>
          </div>
        </el-form-item>
        <!-- P1-3: 多阶段造型（stages） -->
        <el-form-item v-if="editCharacterForm.id" label="多阶段造型">
          <div style="width:100%">
            <div style="font-size:12px;color:#909399;margin-bottom:6px">
              不同集次的角色造型变化，格式：JSON 数组 [{"episode_range":[1,3],"appearance":"..."}]
            </div>
            <el-input
              v-model="editCharacterForm.stages"
              type="textarea"
              :rows="4"
              placeholder='例：[{"episode_range":[1,5],"appearance":"白衣少年"},{"episode_range":[6,10],"appearance":"黑衣武者"}]'
              style="font-size:12px;font-family:monospace"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditCharacter = false">取消</el-button>
        <el-button type="primary" :loading="editCharacterSaving" :disabled="!editCharacterForm?.name?.trim()" @click="submitEditCharacter">{{ editCharacterForm?.id ? '保存' : '添加' }}</el-button>
      </template>
    </AccessibleDialog>

    <AccessibleDialog
      v-model="showCharSd2Cert"
      title="SD2 认证详情"
      width="min(720px, 92vw)"
      destroy-on-close
      class="sd2-cert-dialog"
    >
      <template v-if="charSd2CertPayload">
        <el-descriptions :column="1" border size="small" class="sd2-cert-desc">
          <el-descriptions-item label="素材 ID">
            <span class="sd2-cert-value">{{ charSd2CertPayload.hub_asset_id || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="asset_url">
            <code class="sd2-cert-value">{{ charSd2CertPayload.asset_url || '—' }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <span class="sd2-cert-value">{{ charSd2CertPayload.status || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="注册图片 URL">
            <span class="sd2-cert-value">{{ charSd2CertPayload.source_image_url || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item v-if="charSd2CertPayload.sd2_provider" label="认证提供方">
            <span class="sd2-cert-value">{{ charSd2CertPayload.sd2_provider }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </template>
      <template #footer>
        <el-button @click="showCharSd2Cert = false">关闭</el-button>
      </template>
    </AccessibleDialog>

    <!-- 编辑道具弹窗 -->
    <AccessibleDialog v-model="showEditProp" :title="editPropForm?.id ? '编辑道具' : '添加道具'" width="75%" @close="onClosePropDialog">
      <el-form v-if="editPropForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <button type="button" class="ref-image-box" aria-label="选择道具参考图" @click="addPropRefFileInput?.click()" @drop.prevent="onRefImageDrop('prop', $event)" @dragover.prevent>
              <img v-if="addPropRefImage" :src="addPropRefImage.dataUrl" alt="待上传道具参考图" class="ref-preview-img" />
              <img v-else-if="editPropForm.ref_image"
                :src="editPropForm.ref_image.startsWith('http') ? editPropForm.ref_image : '/static/' + editPropForm.ref_image"
                alt="已保存道具参考图"
                class="ref-preview-img" />
              <img v-else-if="editPropForm.id && (editPropForm.image_url || editPropForm.local_path)"
                :src="assetImageUrl(editPropForm)" alt="道具主图" class="ref-preview-img" style="opacity:0.5" />
              <span v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></span>
            </button>
            <div v-if="addPropRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingPropDesc" @click="doExtractFromRef('prop')">提取特征描述</el-button>
              <el-button size="small" @click="addPropRefImage = null">移除</el-button>
            </div>
            <div v-else-if="editPropForm.ref_image" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingPropDesc" @click="doExtractPropFromImage">从参考图提取描述</el-button>
              <el-button size="small" @click="clearPropRefImage">移除参考图</el-button>
            </div>
            <div v-else-if="editPropForm.id && (editPropForm.image_url || editPropForm.local_path) && !editPropForm.description" class="ref-actions">
              <el-button size="small" :loading="extractingPropDesc" @click="doExtractPropFromImage">从主图提取描述</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="editPropForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="类型">
          <el-input v-model="editPropForm.type" placeholder="如：道具、建筑" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editPropForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="道具描述" />
        </el-form-item>
        <el-form-item label="图生提示词">
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 润色后的图片提示词，生成图片时直接使用；可手动修改</span>
              <el-button size="small" :loading="editPropPromptGenerating" @click="doGeneratePropPrompt">重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editPropForm.prompt"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              :placeholder="editPropPromptGenerating ? 'AI 正在生成提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
              :disabled="editPropPromptGenerating"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditProp = false">取消</el-button>
        <el-button type="primary" :loading="editPropSaving" :disabled="!editPropForm?.name?.trim()" @click="submitEditProp">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 添加/编辑场景弹窗 -->
    <AccessibleDialog v-model="showEditScene" :title="editSceneForm?.id ? '编辑场景' : '添加场景'" width="75%" @close="onCloseSceneDialog">
      <el-form v-if="editSceneForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <button type="button" class="ref-image-box" aria-label="选择场景参考图" @click="addSceneRefFileInput?.click()" @drop.prevent="onRefImageDrop('scene', $event)" @dragover.prevent>
              <img v-if="addSceneRefImage" :src="addSceneRefImage.dataUrl" alt="待上传场景参考图" class="ref-preview-img" />
              <img v-else-if="editSceneForm.ref_image"
                :src="editSceneForm.ref_image.startsWith('http') ? editSceneForm.ref_image : '/static/' + editSceneForm.ref_image"
                alt="已保存场景参考图"
                class="ref-preview-img" />
              <img v-else-if="editSceneForm.id && (editSceneForm.image_url || editSceneForm.local_path)"
                :src="assetImageUrl(editSceneForm)" alt="场景主图" class="ref-preview-img" style="opacity:0.5" />
              <span v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></span>
            </button>
            <div v-if="addSceneRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingSceneDesc" @click="doExtractFromRef('scene')">提取特征描述</el-button>
              <el-button size="small" @click="addSceneRefImage = null">移除</el-button>
            </div>
            <div v-else-if="editSceneForm.ref_image" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingSceneDesc" @click="doExtractSceneFromImage">从参考图提取描述</el-button>
              <el-button size="small" @click="clearSceneRefImage">移除参考图</el-button>
            </div>
            <div v-else-if="editSceneForm.id && (editSceneForm.image_url || editSceneForm.local_path) && !editSceneForm.prompt" class="ref-actions">
              <el-button size="small" :loading="extractingSceneDesc" @click="doExtractSceneFromImage">从主图提取描述</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="地点" required>
          <el-input v-model="editSceneForm.location" placeholder="如：森林、教室" />
        </el-form-item>
        <el-form-item label="时间">
          <el-input v-model="editSceneForm.time" placeholder="如：白天、傍晚" />
        </el-form-item>
        <el-form-item label="场景描述">
          <el-input v-model="editSceneForm.prompt" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="场景的简要描述，供 AI 生成四视图时参考" />
        </el-form-item>
        <el-form-item v-if="editSceneForm.id">
          <template #label>
            <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">单图提示词</span>
          </template>
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">单图场景的完整图片提示词（不含四宫格布局），生图时直接使用；可手动修改</span>
              <el-button size="small" :loading="editScenePromptGenerating" @click="doGenerateSceneSinglePrompt">重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editSceneForm.polished_prompt_single"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              placeholder="单图场景提示词，点击场景列表的「AI 生成」按钮（不勾选四宫格）后会自动生成"
              style="font-size:12px"
            />
          </div>
        </el-form-item>
        <el-form-item v-if="editSceneForm.id">
          <template #label>
            <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">四视图提示词</span>
          </template>
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 生成的完整四视图图片提示词，生图时直接使用；可手动修改</span>
              <el-button size="small" :loading="editScenePromptGenerating" @click="doGenerateScenePrompt">重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editSceneForm.polished_prompt"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              :placeholder="editScenePromptGenerating ? 'AI 正在生成四视图提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
              :disabled="editScenePromptGenerating"
              style="font-size:12px"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditScene = false">取消</el-button>
        <el-button type="primary" :loading="editSceneSaving" :disabled="!editSceneForm?.location?.trim()" @click="submitEditScene">{{ editSceneForm?.id ? '保存' : '添加' }}</el-button>
      </template>
    </AccessibleDialog>

    <!-- 角色资源库（本剧库 / 本剧全部角色 / 团队库） -->
    <AccessibleDialog v-model="showCharLibrary" title="角色资源库" width="720px" destroy-on-close class="library-dialog" @open="onCharLibraryDialogOpen">
      <el-tabs v-model="charLibraryTab" class="char-library-tabs" @tab-change="onCharLibraryTabChange">
        <el-tab-pane label="本剧角色库" name="library">
          <div class="library-toolbar">
            <el-input v-model="charLibraryKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadCharLibrary()" />
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
                  <el-button size="small" type="primary" :loading="isCharAddToEpisodeLoading('library', item.id)" :disabled="!currentEpisodeId" @click="onAddCharFromLibrary(item)">加入本集</el-button>
                  <el-button size="small" @click="openEditCharLibrary(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="onDeleteCharLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!charLibraryLoading && charLibraryList.length === 0" class="library-empty">
              <p>暂无本剧角色库记录，可将本剧角色「加入本剧库」后在此查看</p>
              <el-button type="primary" @click="returnToCharacterPanel">去角色面板</el-button>
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
            <el-input v-model="dramaAllCharKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllCharList()" />
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
                  <el-button size="small" type="primary" :loading="isCharAddToEpisodeLoading('drama', item.id)" :disabled="!currentEpisodeId" @click="onAddDramaCharToEpisode(item)">加入本集</el-button>
                </div>
              </div>
            </div>
            <div v-if="!dramaAllCharLoading && dramaAllCharList.length === 0" class="library-empty">
              <p>本剧暂无制作角色</p>
              <el-button type="primary" @click="returnToCharacterPanel">创建角色</el-button>
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
        <el-button @click="showCharLibrary = false">关闭</el-button>
      </template>
    </AccessibleDialog>
    <!-- 编辑公共角色 -->
    <AccessibleDialog v-model="showEditCharLibrary" title="编辑公共角色" width="440px" @close="editCharLibraryForm = null">
      <el-form v-if="editCharLibraryForm" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="editCharLibraryForm.name" placeholder="角色名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="editCharLibraryForm.category" placeholder="可选" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editCharLibraryForm.description" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="editCharLibraryForm.tags" placeholder="可选，逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditCharLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editCharLibrarySaving" @click="submitEditCharLibrary">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 道具资源库 -->
    <AccessibleDialog v-model="showPropLibrary" title="道具资源库" width="720px" destroy-on-close class="library-dialog" @open="onPropLibraryDialogOpen">
      <el-tabs v-model="propLibraryTab" class="char-library-tabs" @tab-change="onPropLibraryTabChange">
        <el-tab-pane label="本剧道具库" name="library">
          <div class="library-toolbar">
            <el-input v-model="propLibraryKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadPropLibrary()" />
          </div>
          <div v-loading="propLibraryLoading" class="library-list">
            <div v-for="item in propLibraryList" :key="'plib-' + item.id" class="library-item">
              <button type="button" class="library-item-cover" :disabled="!assetImageUrl(item)" :aria-label="`预览${item.name || '道具'}图片`" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" :alt="item.name || '道具图片'" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </button>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isPropAddToEpisodeLoading('library', item.id)" :disabled="!currentEpisodeId" @click="onAddPropFromLibrary(item)">加入本集</el-button>
                  <el-button size="small" @click="openEditPropLibrary(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="onDeletePropLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!propLibraryLoading && propLibraryList.length === 0" class="library-empty">暂无本剧道具库记录，可将本剧道具「加入本剧库」后在此查看</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="propLibraryPage" v-model:page-size="propLibraryPageSize" :total="propLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadPropLibraryList" @size-change="loadPropLibraryList" />
          </div>
        </el-tab-pane>
        <el-tab-pane label="本剧所有道具" name="drama">
          <div class="library-toolbar">
            <el-input v-model="dramaAllPropKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllPropList()" />
          </div>
          <div v-loading="dramaAllPropLoading" class="library-list">
            <div v-for="item in dramaAllPropList" :key="'pdr-' + item.id" class="library-item">
              <button type="button" class="library-item-cover" :disabled="!assetImageUrl(item)" :aria-label="`预览${item.name || '道具'}图片`" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" :alt="item.name || '道具图片'" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </button>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isPropAddToEpisodeLoading('drama', item.id)" :disabled="!currentEpisodeId" @click="onAddDramaPropToEpisode(item)">加入本集</el-button>
                </div>
              </div>
            </div>
            <div v-if="!dramaAllPropLoading && dramaAllPropList.length === 0" class="library-empty">本剧暂无制作道具，请先在道具面板创建</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="dramaAllPropPage" v-model:page-size="dramaAllPropPageSize" :total="dramaAllPropTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadDramaAllPropList" @size-change="loadDramaAllPropList" />
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="showPropLibrary = false">关闭</el-button>
      </template>
    </AccessibleDialog>
    <!-- 编辑公共道具 -->
    <AccessibleDialog v-model="showEditPropLibrary" title="编辑公共道具" width="440px" @close="editPropLibraryForm = null">
      <el-form v-if="editPropLibraryForm" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="editPropLibraryForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="editPropLibraryForm.category" placeholder="可选" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editPropLibraryForm.description" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="editPropLibraryForm.tags" placeholder="可选，逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditPropLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editPropLibrarySaving" @click="submitEditPropLibrary">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 场景资源库 -->
    <AccessibleDialog v-model="showSceneLibrary" title="场景资源库" width="720px" destroy-on-close class="library-dialog" @open="onSceneLibraryDialogOpen">
      <el-tabs v-model="sceneLibraryTab" class="char-library-tabs" @tab-change="onSceneLibraryTabChange">
        <el-tab-pane label="本剧场景库" name="library">
          <div class="library-toolbar">
            <el-input v-model="sceneLibraryKeyword" placeholder="搜索地点或描述" clearable style="width: 200px" @input="debouncedLoadSceneLibrary()" />
          </div>
          <div v-loading="sceneLibraryLoading" class="library-list">
            <div v-for="item in sceneLibraryList" :key="'slib-' + item.id" class="library-item">
              <button type="button" class="library-item-cover" :disabled="!assetImageUrl(item)" :aria-label="`预览${item.location || item.time || '场景'}图片`" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" :alt="item.location || item.time || '场景图片'" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </button>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.location || item.time || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isSceneAddToEpisodeLoading('library', item.id)" :disabled="!currentEpisodeId" @click="onAddSceneFromLibrary(item)">加入本集</el-button>
                  <el-button size="small" @click="openEditSceneLibrary(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="onDeleteSceneLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!sceneLibraryLoading && sceneLibraryList.length === 0" class="library-empty">暂无本剧场景库记录，可将本剧场景「加入本剧库」后在此查看</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="sceneLibraryPage" v-model:page-size="sceneLibraryPageSize" :total="sceneLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadSceneLibraryList" @size-change="loadSceneLibraryList" />
          </div>
        </el-tab-pane>
        <el-tab-pane label="本剧所有场景" name="drama">
          <div class="library-toolbar">
            <el-input v-model="dramaAllSceneKeyword" placeholder="搜索地点或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllSceneList()" />
          </div>
          <div v-loading="dramaAllSceneLoading" class="library-list">
            <div v-for="item in dramaAllSceneList" :key="'sdr-' + item.id" class="library-item">
              <button type="button" class="library-item-cover" :disabled="!assetImageUrl(item)" :aria-label="`预览${item.location || item.time || '场景'}图片`" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" :alt="item.location || item.time || '场景图片'" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </button>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.location || '未命名' }}<span v-if="item.time" class="library-item-sub"> · {{ item.time }}</span></div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isSceneAddToEpisodeLoading('drama', item.id)" :disabled="!currentEpisodeId" @click="onAddDramaSceneToEpisode(item)">加入本集</el-button>
                </div>
              </div>
            </div>
            <div v-if="!dramaAllSceneLoading && dramaAllSceneList.length === 0" class="library-empty">本剧暂无制作场景，请先在场景面板创建</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="dramaAllScenePage" v-model:page-size="dramaAllScenePageSize" :total="dramaAllSceneTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadDramaAllSceneList" @size-change="loadDramaAllSceneList" />
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="showSceneLibrary = false">关闭</el-button>
      </template>
    </AccessibleDialog>
    <!-- 编辑公共场景 -->
    <AccessibleDialog v-model="showEditSceneLibrary" title="编辑公共场景" width="440px" @close="editSceneLibraryForm = null">
      <el-form v-if="editSceneLibraryForm" label-width="80px">
        <el-form-item label="地点">
          <el-input v-model="editSceneLibraryForm.location" placeholder="场景地点" />
        </el-form-item>
        <el-form-item label="时间">
          <el-input v-model="editSceneLibraryForm.time" placeholder="如：浅色/夜晚" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="editSceneLibraryForm.category" placeholder="可选" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editSceneLibraryForm.description" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="editSceneLibraryForm.tags" placeholder="可选，逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditSceneLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editSceneLibrarySaving" @click="submitEditSceneLibrary">保存</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  addPropSaving: { type: Boolean, default: false },
  charLibraryList: { type: Array, default: () => [] },
  charLibraryLoading: { type: Boolean, default: false },
  charLibraryTotal: { type: Number, default: 0 },
  charSd2CertPayload: { type: Object, default: null },
  currentEpisodeId: { type: [Number, String, null], default: null },
  dramaAllCharList: { type: Array, default: () => [] },
  dramaAllCharLoading: { type: Boolean, default: false },
  dramaAllCharTotal: { type: Number, default: 0 },
  dramaAllPropList: { type: Array, default: () => [] },
  dramaAllPropLoading: { type: Boolean, default: false },
  dramaAllPropTotal: { type: Number, default: 0 },
  dramaAllSceneList: { type: Array, default: () => [] },
  dramaAllSceneLoading: { type: Boolean, default: false },
  dramaAllSceneTotal: { type: Number, default: 0 },
  editCharLibrarySaving: { type: Boolean, default: false },
  editCharacterForm: { type: Object, default: null },
  editCharacterPromptGenerating: { type: Boolean, default: false },
  editCharacterSaving: { type: Boolean, default: false },
  editPropForm: { type: Object, default: null },
  editPropLibrarySaving: { type: Boolean, default: false },
  editPropPromptGenerating: { type: Boolean, default: false },
  editPropSaving: { type: Boolean, default: false },
  editSceneForm: { type: Object, default: null },
  editSceneLibrarySaving: { type: Boolean, default: false },
  editScenePromptGenerating: { type: Boolean, default: false },
  editSceneSaving: { type: Boolean, default: false },
  extractingAnchors: { type: Boolean, default: false },
  extractingCharAppearance: { type: Boolean, default: false },
  extractingPropAddDesc: { type: Boolean, default: false },
  extractingPropDesc: { type: Boolean, default: false },
  extractingSceneDesc: { type: Boolean, default: false },
  propLibraryList: { type: Array, default: () => [] },
  propLibraryLoading: { type: Boolean, default: false },
  propLibraryTotal: { type: Number, default: 0 },
  sceneLibraryList: { type: Array, default: () => [] },
  sceneLibraryLoading: { type: Boolean, default: false },
  sceneLibraryTotal: { type: Number, default: 0 },
  assetImageUrl: { type: Function, required: true },
  charRoleLabel: { type: Function, required: true },
  clearCharRefImage: { type: Function, required: true },
  clearPropRefImage: { type: Function, required: true },
  clearSceneRefImage: { type: Function, required: true },
  debouncedLoadCharLibrary: { type: Function, required: true },
  debouncedLoadDramaAllCharList: { type: Function, required: true },
  debouncedLoadDramaAllPropList: { type: Function, required: true },
  debouncedLoadDramaAllSceneList: { type: Function, required: true },
  debouncedLoadPropLibrary: { type: Function, required: true },
  debouncedLoadSceneLibrary: { type: Function, required: true },
  doExtractCharFromImage: { type: Function, required: true },
  doExtractFromRef: { type: Function, required: true },
  doExtractFromRef2: { type: Function, required: true },
  doExtractPropFromImage: { type: Function, required: true },
  doExtractSceneFromImage: { type: Function, required: true },
  doGenerateCharacterPrompt: { type: Function, required: true },
  doGeneratePropPrompt: { type: Function, required: true },
  doGenerateScenePrompt: { type: Function, required: true },
  doGenerateSceneSinglePrompt: { type: Function, required: true },
  extractIdentityAnchors: { type: Function, required: true },
  isCharAddToEpisodeLoading: { type: Function, required: true },
  isPropAddToEpisodeLoading: { type: Function, required: true },
  isSceneAddToEpisodeLoading: { type: Function, required: true },
  loadCharLibraryList: { type: Function, required: true },
  loadDramaAllCharList: { type: Function, required: true },
  loadDramaAllPropList: { type: Function, required: true },
  loadDramaAllSceneList: { type: Function, required: true },
  loadPropLibraryList: { type: Function, required: true },
  loadSceneLibraryList: { type: Function, required: true },
  onAddCharFromLibrary: { type: Function, required: true },
  onAddDramaCharToEpisode: { type: Function, required: true },
  onAddDramaPropToEpisode: { type: Function, required: true },
  onAddDramaSceneToEpisode: { type: Function, required: true },
  onAddPropFromLibrary: { type: Function, required: true },
  onAddSceneFromLibrary: { type: Function, required: true },
  onCharLibraryDialogOpen: { type: Function, required: true },
  onCharLibraryTabChange: { type: Function, required: true },
  onCloseCharDialog: { type: Function, required: true },
  onClosePropDialog: { type: Function, required: true },
  onCloseSceneDialog: { type: Function, required: true },
  onDeleteCharLibrary: { type: Function, required: true },
  onDeletePropLibrary: { type: Function, required: true },
  onDeleteSceneLibrary: { type: Function, required: true },
  onPropLibraryDialogOpen: { type: Function, required: true },
  onPropLibraryTabChange: { type: Function, required: true },
  onRefImageDrop: { type: Function, required: true },
  onRefImageDrop2: { type: Function, required: true },
  onRefImageFileChange: { type: Function, required: true },
  onRefImageFileChange2: { type: Function, required: true },
  onSceneLibraryDialogOpen: { type: Function, required: true },
  onSceneLibraryTabChange: { type: Function, required: true },
  openEditCharLibrary: { type: Function, required: true },
  openEditPropLibrary: { type: Function, required: true },
  openEditSceneLibrary: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  returnToCharacterPanel: { type: Function, required: true },
  submitAddProp: { type: Function, required: true },
  submitEditCharLibrary: { type: Function, required: true },
  submitEditCharacter: { type: Function, required: true },
  submitEditProp: { type: Function, required: true },
  submitEditPropLibrary: { type: Function, required: true },
  submitEditScene: { type: Function, required: true },
  submitEditSceneLibrary: { type: Function, required: true },
})

const addPropForm = defineModel('addPropForm', { type: Object, default: () => ({ name: '', type: '', description: '', prompt: '' }) })
const addPropAddRefImage = defineModel('addPropAddRefImage', { type: Object, default: null })
const addCharRefImage = defineModel('addCharRefImage', { type: Object, default: null })
const addPropRefImage = defineModel('addPropRefImage', { type: Object, default: null })
const addSceneRefImage = defineModel('addSceneRefImage', { type: Object, default: null })
const editCharLibraryForm = defineModel('editCharLibraryForm', { type: Object, default: null })
const editPropLibraryForm = defineModel('editPropLibraryForm', { type: Object, default: null })
const editSceneLibraryForm = defineModel('editSceneLibraryForm', { type: Object, default: null })
const showAddProp = defineModel('showAddProp', { type: Boolean, default: false })
const showCharLibrary = defineModel('showCharLibrary', { type: Boolean, default: false })
const showCharSd2Cert = defineModel('showCharSd2Cert', { type: Boolean, default: false })
const showEditCharLibrary = defineModel('showEditCharLibrary', { type: Boolean, default: false })
const showEditCharacter = defineModel('showEditCharacter', { type: Boolean, default: false })
const showEditProp = defineModel('showEditProp', { type: Boolean, default: false })
const showEditPropLibrary = defineModel('showEditPropLibrary', { type: Boolean, default: false })
const showEditScene = defineModel('showEditScene', { type: Boolean, default: false })
const showEditSceneLibrary = defineModel('showEditSceneLibrary', { type: Boolean, default: false })
const showPropLibrary = defineModel('showPropLibrary', { type: Boolean, default: false })
const showSceneLibrary = defineModel('showSceneLibrary', { type: Boolean, default: false })
const charLibraryKeyword = defineModel('charLibraryKeyword', { type: String, default: '' })
const charLibraryPage = defineModel('charLibraryPage', { type: Number, default: 1 })
const charLibraryPageSize = defineModel('charLibraryPageSize', { type: Number, default: 20 })
const charLibraryTab = defineModel('charLibraryTab', { type: String, default: '' })
const dramaAllCharKeyword = defineModel('dramaAllCharKeyword', { type: String, default: '' })
const dramaAllCharPage = defineModel('dramaAllCharPage', { type: Number, default: 1 })
const dramaAllCharPageSize = defineModel('dramaAllCharPageSize', { type: Number, default: 20 })
const dramaAllPropKeyword = defineModel('dramaAllPropKeyword', { type: String, default: '' })
const dramaAllPropPage = defineModel('dramaAllPropPage', { type: Number, default: 1 })
const dramaAllPropPageSize = defineModel('dramaAllPropPageSize', { type: Number, default: 20 })
const dramaAllSceneKeyword = defineModel('dramaAllSceneKeyword', { type: String, default: '' })
const dramaAllScenePage = defineModel('dramaAllScenePage', { type: Number, default: 1 })
const dramaAllScenePageSize = defineModel('dramaAllScenePageSize', { type: Number, default: 20 })
const propLibraryKeyword = defineModel('propLibraryKeyword', { type: String, default: '' })
const propLibraryPage = defineModel('propLibraryPage', { type: Number, default: 1 })
const propLibraryPageSize = defineModel('propLibraryPageSize', { type: Number, default: 20 })
const propLibraryTab = defineModel('propLibraryTab', { type: String, default: '' })
const sceneLibraryKeyword = defineModel('sceneLibraryKeyword', { type: String, default: '' })
const sceneLibraryPage = defineModel('sceneLibraryPage', { type: Number, default: 1 })
const sceneLibraryPageSize = defineModel('sceneLibraryPageSize', { type: Number, default: 20 })
const sceneLibraryTab = defineModel('sceneLibraryTab', { type: String, default: '' })

const {
assetImageUrl,
charRoleLabel,
clearCharRefImage,
clearPropRefImage,
clearSceneRefImage,
debouncedLoadCharLibrary,
debouncedLoadDramaAllCharList,
debouncedLoadDramaAllPropList,
debouncedLoadDramaAllSceneList,
debouncedLoadPropLibrary,
debouncedLoadSceneLibrary,
doExtractCharFromImage,
doExtractFromRef,
doExtractFromRef2,
doExtractPropFromImage,
doExtractSceneFromImage,
doGenerateCharacterPrompt,
doGeneratePropPrompt,
doGenerateScenePrompt,
doGenerateSceneSinglePrompt,
extractIdentityAnchors,
isCharAddToEpisodeLoading,
isPropAddToEpisodeLoading,
isSceneAddToEpisodeLoading,
loadCharLibraryList,
loadDramaAllCharList,
loadDramaAllPropList,
loadDramaAllSceneList,
loadPropLibraryList,
loadSceneLibraryList,
onAddCharFromLibrary,
onAddDramaCharToEpisode,
onAddDramaPropToEpisode,
onAddDramaSceneToEpisode,
onAddPropFromLibrary,
onAddSceneFromLibrary,
onCharLibraryDialogOpen,
onCharLibraryTabChange,
onCloseCharDialog,
onClosePropDialog,
onCloseSceneDialog,
onDeleteCharLibrary,
onDeletePropLibrary,
onDeleteSceneLibrary,
onPropLibraryDialogOpen,
onPropLibraryTabChange,
onRefImageDrop,
onRefImageDrop2,
onRefImageFileChange,
onRefImageFileChange2,
onSceneLibraryDialogOpen,
onSceneLibraryTabChange,
openEditCharLibrary,
openEditPropLibrary,
openEditSceneLibrary,
openImagePreview,
returnToCharacterPanel,
submitAddProp,
submitEditCharLibrary,
submitEditCharacter,
submitEditProp,
submitEditPropLibrary,
submitEditScene,
submitEditSceneLibrary
} = props

const addCharRefFileInput = ref(null)
const addSceneRefFileInput = ref(null)
const addPropRefFileInput = ref(null)
const addPropAddRefFileInput = ref(null)

</script>

<style scoped>
.ref-image-zone {

  display: flex;

  align-items: center;

  gap: 12px;

  flex-wrap: wrap;

}

.ref-image-box {

  width: 120px;

  height: 120px;

  border: 2px dashed #c0c4cc;

  border-radius: 8px;

  display: flex;

  align-items: center;

  justify-content: center;

  cursor: pointer;

  overflow: hidden;

  background: #fafafa;

  flex-shrink: 0;

  transition: border-color 0.2s;

  padding: 0;

  color: inherit;

  font: inherit;

}

.ref-image-box:hover {

  border-color: #409eff;

}

.ref-image-box:focus-visible { outline: 2px solid #409eff; outline-offset: 2px; }

.asset-item-left-right .asset-name {

  font-size: 1.05rem;

  margin-bottom: 8px;

}

.asset-name { font-weight: 600; margin-bottom: 4px; color: #e4e4e7; }

.asset-item-left-right .asset-name {

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 4px;

}

.asset-item-left-right .asset-name span { flex: 1; min-width: 0; }

.empty-tip {

  color: #5a5a66;

  font-size: 0.9rem;

  padding: 16px 0;

}

html.light .asset-name {

  color: #18181b;

}

html.light .empty-tip {

  color: #9ca3af;

}

.library-dialog .el-dialog__body { padding-top: 8px; }

.sd2-cert-dialog .el-dialog__body { padding-top: 10px; }

.sd2-cert-desc :deep(.el-descriptions__cell) {

  white-space: normal;

  word-break: break-word;

  overflow-wrap: anywhere;

}

.sd2-cert-value {

  display: inline-block;

  max-width: 100%;

  white-space: normal;

  word-break: break-word;

  overflow-wrap: anywhere;

  line-height: 1.5;

}

.library-toolbar { margin-bottom: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }

.library-team-hint { font-size: 12px; color: var(--el-text-color-secondary); }

.library-team-hint--warn { color: var(--el-color-warning); }

.char-library-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }

.library-item-sub { font-size: 12px; color: var(--el-text-color-secondary); font-weight: normal; }

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

  align-items: center;

  padding: 10px;

  background: #1e1f28;

  border: 1px solid rgba(255, 255, 255, 0.06);

  border-radius: 8px;

}

.library-item-cover {

  width: 72px;

  height: 72px;

  flex-shrink: 0;

  background: #252630;

  padding: 0;

  border: 0;

  border-radius: 6px;

  overflow: hidden;

  display: flex;

  align-items: center;

  justify-content: center;

  cursor: pointer;

  color: inherit;

  font: inherit;

}

.library-item-cover:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }

.library-item-cover:disabled { cursor: default; }

.library-item-cover img {

  width: 100%;

  height: 100%;

  object-fit: cover;

}

.library-item-placeholder {

  font-size: 0.8rem;

  color: #5a5a66;

}

.library-item-info { flex: 1; min-width: 0; }

.library-item-name { font-weight: 500; margin-bottom: 4px; }

.library-item-desc { font-size: 0.85rem; color: #7a7a88; margin-bottom: 8px; }

.library-item-actions { display: flex; gap: 8px; }

.library-empty {

  text-align: center;

  color: #5a5a66;

  padding: 40px 20px;

}

.library-empty p {

  margin: 0 0 12px;

}

.library-pagination {

  margin-top: 12px;

  display: flex;

  justify-content: center;

}

.library-placeholder {

  padding: 40px 20px;

  text-align: center;

  color: #5a5a66;

}
</style>
