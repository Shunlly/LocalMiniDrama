import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFilmListSources } from './helpers/filmListSources.js'
import { readMediaLibrarySourceMap, readMediaLibrarySources } from './helpers/mediaLibrarySources.js'
import { readAiConfigFormDialogTreeSource } from './helpers/aiConfigFormDialogSources.js'

import { readDramaDetailResourceDialogSources } from './helpers/dramaDetailResourceDialogSources.js'
import { readSd2AssetSources } from './helpers/sd2AssetSources.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const mediaLibraryFiles = readMediaLibrarySourceMap()
const mediaLibrarySource = mediaLibraryFiles['MediaLibrary.vue']
const mediaLibraryHeaderSource = mediaLibraryFiles['MediaLibraryHeader.vue']
const mediaLibraryFilterSource = mediaLibraryFiles['MediaLibraryFilterBar.vue']
const mediaLibraryLocalGridSource = mediaLibraryFiles['MediaLibraryLocalGrid.vue']
const mediaLibraryNetworkSource = mediaLibraryFiles['MediaLibraryNetworkPanel.vue']
const mediaLibraryCombinedSource = readMediaLibrarySources()
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const dramaDetailHeaderSource = read('../src/components/dramaDetail/DramaDetailHeader.vue')
const dramaDetailLoadStateSource = read('../src/components/dramaDetail/DramaDetailLoadState.vue')
const dramaDetailInfoCardSource = read('../src/components/dramaDetail/DramaDetailInfoCard.vue')
const dramaDetailEpisodeListSource = read('../src/components/dramaDetail/DramaDetailEpisodeList.vue')
const dramaDetailResourceLibrarySource = read('../src/components/dramaDetail/DramaDetailResourceLibrary.vue')
const dramaDetailReadinessSource = read('../src/components/dramaDetail/DramaDetailReadinessSection.vue')
const dramaDetailSourceWorkflowSource = read('../src/components/dramaDetail/DramaDetailSourceWorkflow.vue')
const dramaDetailDialogsSource = readDramaDetailResourceDialogSources(read)
const dramaDetailCombinedSource = [
  dramaDetailSource,
  dramaDetailHeaderSource,
  dramaDetailLoadStateSource,
  dramaDetailInfoCardSource,
  dramaDetailEpisodeListSource,
  dramaDetailResourceLibrarySource,
  dramaDetailReadinessSource,
  dramaDetailSourceWorkflowSource,
  dramaDetailDialogsSource,
].join('\n')
const filmListFiles = readFilmListSources()
const filmListSource = filmListFiles.ui
const filmListHeaderSource = filmListFiles.header
const filmListBannersSource = filmListFiles.banners
const filmListToolbarSource = filmListFiles.toolbar
const filmListLibraryDialogsSource = read('../src/components/filmList/FilmListLibraryDialogs.vue')
const filmListCharLibraryDialogsSource = read('../src/components/filmList/FilmListCharLibraryDialogs.vue')
const filmListSceneLibraryDialogsSource = read('../src/components/filmList/FilmListSceneLibraryDialogs.vue')
const filmListPropLibraryDialogsSource = read('../src/components/filmList/FilmListPropLibraryDialogs.vue')
const filmListLibraryImageSource = read('../src/components/filmList/filmListLibraryImage.js')
const filmListLibraryUiSource = [
  filmListLibraryDialogsSource,
  filmListCharLibraryDialogsSource,
  filmListSceneLibraryDialogsSource,
  filmListPropLibraryDialogsSource,
  filmListLibraryImageSource,
].join('\n')
const freeCreatePageSource = read('../src/views/FreeCreate.vue')
const freeCreateHeaderSource = read('../src/components/freeCreate/FreeCreateHeader.vue')
const freeCreateInputSource = read('../src/components/freeCreate/FreeCreateInputPanel.vue')
const freeCreateResultSource = read('../src/components/freeCreate/FreeCreateResultPanel.vue')
const freeCreateWorkspaceSource = read('../src/composables/useFreeCreateWorkspace.js')
const freeCreateUtilsSource = read('../src/utils/freeCreate.js')
const freeCreateSource = [
  freeCreatePageSource,
  freeCreateHeaderSource,
  freeCreateInputSource,
  freeCreateResultSource,
  freeCreateWorkspaceSource,
  freeCreateUtilsSource,
].join('\n')
const generationTaskStoreSource = [
  read('../src/stores/generationTaskStore.js'),
  read('../src/stores/generationTaskStore.helpers.js'),
  read('../src/stores/generationTaskStore.recovery.js'),
].join('\n')
const storyGenerationSource = read('../src/composables/useStoryGeneration.js')
const episodeBatchImportSource = read('../src/components/EpisodeBatchImportDialog.vue')
const sceneModelMapSource = read('../src/components/SceneModelMap.vue')
const promptEditorSource = read('../src/components/PromptEditor.vue')
const sd2Files = readSd2AssetSources()
const sd2Source = sd2Files.combined
const aiConfigSource = read('../src/components/AIConfigContent.vue')
const aiConfigFormDialogSource = read('../src/components/aiConfig/AiConfigFormDialog.vue')
const aiConfigOneKeyDialogsSource = read('../src/components/aiConfig/AiConfigOneKeyDialogs.vue')
const aiConfigBulkKeyDialogSource = read('../src/components/aiConfig/AiConfigBulkKeyDialog.vue')
const aiConfigConnectionTestDialogSource = read('../src/components/aiConfig/AiConfigConnectionTestDialog.vue')
const aiConfigJimeng2AssetsDialogSource = read('../src/components/aiConfig/AiConfigJimeng2AssetsDialog.vue')
const aiConfigListToolbarSource = read('../src/components/aiConfig/AiConfigListToolbar.vue')
const aiConfigListTableSource = read('../src/components/aiConfig/AiConfigListTable.vue')
const aiConfigDependencyErrorBarSource = read('../src/components/aiConfig/AiConfigDependencyErrorBar.vue')
const aiConfigWorkspaceSwitchSource = read('../src/components/aiConfig/AiConfigWorkspaceSwitch.vue')
const aiConfigCoverageHeaderSource = read('../src/components/aiConfig/AiConfigCoverageHeader.vue')
const aiConfigCoveragePanelSource = read('../src/components/aiConfig/AiConfigCoveragePanel.vue')
const aiConfigConfigsPanelSource = read('../src/components/aiConfig/AiConfigConfigsPanel.vue')
const aiConfigFormTreeSource = readAiConfigFormDialogTreeSource()
const aiConfigOverlaySource = [
  aiConfigSource,
  aiConfigFormTreeSource,
  aiConfigOneKeyDialogsSource,
  aiConfigBulkKeyDialogSource,
  aiConfigConnectionTestDialogSource,
  aiConfigJimeng2AssetsDialogSource,
  aiConfigListToolbarSource,
  aiConfigListTableSource,
  aiConfigDependencyErrorBarSource,
  aiConfigWorkspaceSwitchSource,
  aiConfigCoverageHeaderSource,
  aiConfigCoveragePanelSource,
  aiConfigConfigsPanelSource,
].join('\n')
const aiConfigRowMutationsSource = read('../src/composables/useAiConfigRowMutations.js')
const aiConfigFormSettingsSource = read('../src/utils/aiConfigFormSettings.js')
const notFoundSource = read('../src/views/NotFound.vue')
const backupPageSource = read('../src/views/Backup.vue')
const backupHeaderSource = read('../src/components/backup/BackupHeader.vue')
const backupListSource = read('../src/components/backup/BackupList.vue')
const backupFailureSource = read('../src/components/backup/BackupFailureBanners.vue')
const backupReadinessSource = read('../src/components/backup/BackupReadiness.vue')
const backupRestoreSource = read('../src/components/backup/BackupRestoreDialog.vue')
const backupSelectedSource = read('../src/components/backup/BackupSelectedFile.vue')
const backupCopySource = read('../src/components/backup/backupPageCopy.js')
const projectReadinessSource = read('../src/utils/projectReadiness.js')
const projectReadinessPanelSource = read('../src/components/ProjectReadinessPanel.vue')
const freeCanvasNodeSource = read('../src/components/dramaCanvas/FreeCanvasNode.vue')
const freeCanvasInspectorSource = read('../src/components/dramaCanvas/FreeCanvasInspector.vue')
const aiConfigPageSource = read('../src/views/AiConfig.vue')

const ALLOWED_SOURCES = {
  ...mediaLibraryFiles,
  'DramaDetail.vue': dramaDetailSource,
  'DramaDetailHeader.vue': dramaDetailHeaderSource,
  'DramaDetailLoadState.vue': dramaDetailLoadStateSource,
  'DramaDetailInfoCard.vue': dramaDetailInfoCardSource,
  'DramaDetailEpisodeList.vue': dramaDetailEpisodeListSource,
  'DramaDetailResourceLibrary.vue': dramaDetailResourceLibrarySource,
  'DramaDetailResourceDialogs.vue': dramaDetailDialogsSource,
  'FilmList.vue': filmListFiles.view,
  'FilmListHeader.vue': filmListHeaderSource,
  'FilmListFailureBanners.vue': filmListBannersSource,
  'FilmListWorkspaceToolbar.vue': filmListToolbarSource,
  'FilmListLibraryDialogs.vue': filmListLibraryDialogsSource,
  'FilmListCharLibraryDialogs.vue': filmListCharLibraryDialogsSource,
  'FilmListSceneLibraryDialogs.vue': filmListSceneLibraryDialogsSource,
  'FilmListPropLibraryDialogs.vue': filmListPropLibraryDialogsSource,
  'filmListLibraryImage.js': filmListLibraryImageSource,
  'FreeCreate.vue': freeCreatePageSource,
  'FreeCreateHeader.vue': freeCreateHeaderSource,
  'FreeCreateInputPanel.vue': freeCreateInputSource,
  'FreeCreateResultPanel.vue': freeCreateResultSource,
  'generationTaskStore.js': generationTaskStoreSource,
  'useStoryGeneration.js': storyGenerationSource,
  'EpisodeBatchImportDialog.vue': episodeBatchImportSource,
  'SceneModelMap.vue': sceneModelMapSource,
  'PromptEditor.vue': promptEditorSource,
  'Sd2AssetManagement.vue': sd2Files.parent,
  'Sd2AssetGroupList.vue': sd2Files.groupList,
  'Sd2AssetList.vue': sd2Files.assetList,
  'Sd2AssetFilter.vue': sd2Files.filter,
  'Sd2AssetDialogs.vue': sd2Files.dialogs,
  'Sd2AssetIntro.vue': sd2Files.intro,
  'Sd2AssetConnectionForm.vue': sd2Files.connectionForm,
  'Sd2AssetLastResponse.vue': sd2Files.lastResponse,
  'AiConfigOneKeyDialogs.vue': aiConfigOneKeyDialogsSource,
  'AiConfigBulkKeyDialog.vue': aiConfigBulkKeyDialogSource,
  'AiConfigConnectionTestDialog.vue': aiConfigConnectionTestDialogSource,
  'AiConfigJimeng2AssetsDialog.vue': aiConfigJimeng2AssetsDialogSource,
  'AiConfigListToolbar.vue': aiConfigListToolbarSource,
  'AiConfigListTable.vue': aiConfigListTableSource,
  'AiConfigDependencyErrorBar.vue': aiConfigDependencyErrorBarSource,
  'AiConfigWorkspaceSwitch.vue': aiConfigWorkspaceSwitchSource,
  'AiConfigCoverageHeader.vue': aiConfigCoverageHeaderSource,
  'AiConfigCoveragePanel.vue': aiConfigCoveragePanelSource,
  'AiConfigConfigsPanel.vue': aiConfigConfigsPanelSource,
  'NotFound.vue': notFoundSource,
  'Backup.vue': backupPageSource,
  'BackupHeader.vue': backupHeaderSource,
  'BackupList.vue': backupListSource,
  'BackupFailureBanners.vue': backupFailureSource,
  'BackupReadiness.vue': backupReadinessSource,
  'BackupRestoreDialog.vue': backupRestoreSource,
  'BackupSelectedFile.vue': backupSelectedSource,
  'ProjectReadinessPanel.vue': projectReadinessPanelSource,
  'AiConfig.vue': aiConfigPageSource,
}

const CHINESE_RE = /[\u4e00-\u9fff]/
const PRODUCT_NAME_RE = /^LocalMiniDrama$/

function hasChinese(text) {
  return CHINESE_RE.test(String(text || ''))
}

function collectAttrValues(source, attrNames) {
  const values = []
  const attrPattern = new RegExp(
    String.raw`(?<!:)\b(?:${attrNames.join('|')})\s*=\s*(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1`,
    'g',
  )
  for (const match of source.matchAll(attrPattern)) {
    const value = match[2].trim()
    if (!value || value === ' ') continue
    if (/^[A-Za-z_$][\w.$]*$/.test(value)) continue
    if (/^[A-Za-z_$][\w.$]*\(/.test(value)) continue
    values.push(value)
  }
  return values
}

function collectElMessageLiterals(source) {
  const values = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (!/ElMessage(?:Box)?\.(?:success|error|warning|info|confirm|alert)/.test(lines[i])) continue
    const related = [lines[i]]
    if (/\(\s*$/.test(lines[i])) {
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j += 1) {
        related.push(lines[j])
        if (/confirmButtonText|cancelButtonText/.test(lines[j])) continue
        if (/\)\s*$/.test(lines[j].trim()) || lines[j].includes('})')) break
        if (/^(const |function |async function |if \()/.test(lines[j].trim())) break
      }
    }
    const chunk = related.join('\n')
    for (const match of chunk.matchAll(/`([^`]+)`|'((?:\\'|[^'])+)'|"((?:\\"|[^"])+)"/g)) {
      const value = (match[1] || match[2] || match[3] || '').trim()
      if (!value) continue
      if (/^(error|warning|success|info|primary|danger|small|large|cancel|type)$/i.test(value)) continue
      if (/return |function |if \(|!==|===/.test(value)) continue
      values.push(value)
    }
  }
  return values
}

function collectDialogTitles(source) {
  return collectAttrValues(source, ['title']).concat(
    [...source.matchAll(/ElMessageBox\.confirm\(\s*(?:`[^`]*`|'[^']*'|"[^"]*")\s*,\s*(['"])([^'"]+)\1/g)].map((match) => match[2]),
  )
}

function assertUserFacingChinese(label, values) {
  for (const value of values) {
    if (PRODUCT_NAME_RE.test(value) || /^[\s./:-]*$/.test(value)) continue
    if (/return |function |if \(|!==|===|Number\.isFinite/.test(value) && !hasChinese(value)) continue
    assert.ok(
      hasChinese(value),
      `${label} 必须是简体中文，实际为：${value}`,
    )
  }
}

test('SD2 资产库对话框、表单和反馈文案改为简体中文，接口名保持原文', () => {
  assert.match(sd2Source, /title="创建资产组"/)
  assert.match(sd2Source, /title="更新资产组"/)
  assert.match(sd2Source, /title="创建资产"/)
  assert.match(sd2Source, /title="更新资产"/)
  assert.match(sd2Source, /ElMessageBox\.confirm\(`确定删除资产组「\$\{row\.Name \|\| row\.Id\}」？`, '删除资产组'/)
  assert.match(sd2Source, /ElMessageBox\.confirm\(`确定删除资产「\$\{row\.Name \|\| row\.Id\}」？`, '删除资产'/)
  assert.match(sd2Source, /<el-form-item label="名称" required>/)
  assert.match(sd2Source, /<el-form-item label="资产组编号" required>/)
  assert.match(sd2Source, /<el-option label="图片" value="Image" \/>/)
  assert.match(sd2Source, /assetTypeLabel\(row\.AssetType\)/)
  assert.match(sd2Source, /Image: '图片', Video: '视频', Audio: '音频'/)
  assert.match(sd2Source, /<el-option label="视频" value="Video" \/>/)
  assert.match(sd2Source, /<el-option label="音频" value="Audio" \/>/)
  assert.match(sd2Source, /placeholder="控制台 IAM 私有密钥"/)
  assert.match(sd2Source, /ElMessage\.warning\('请填写名称'\)/)
  assert.match(sd2Source, /ElMessage\.warning\('请填写资产组编号与名称'\)/)
  assert.match(sd2Source, /return '请先填写接口地址'/)
  assert.match(sd2Source, /label="接口地址"/)
  assert.doesNotMatch(sd2Source, /接口地址（Base URL）/)
  assert.doesNotMatch(sd2Source, /label="Base URL"/)
  assert.match(sd2Source, /POST \{接口地址\}/)
  assert.doesNotMatch(sd2Source, /POST \{Base\}/)
  assert.match(sd2Source, /创建资产组/)
  assert.match(sd2Source, /创建资产，以及列表 \/ 查询 \/ 更新 \/ 删除/)

  assert.doesNotMatch(sd2Source, /<AccessibleDialog[^>]*title="CreateAssetGroup"/)
  assert.doesNotMatch(sd2Source, /<AccessibleDialog[^>]*title="UpdateAssetGroup"/)
  assert.doesNotMatch(sd2Source, /<AccessibleDialog[^>]*title="CreateAsset"/)
  assert.doesNotMatch(sd2Source, /<AccessibleDialog[^>]*title="UpdateAsset"/)
  assert.doesNotMatch(sd2Source, /ElMessageBox\.confirm\([^)]*'DeleteAssetGroup'/)
  assert.doesNotMatch(sd2Source, /ElMessageBox\.confirm\([^)]*'DeleteAsset'/)
  assert.doesNotMatch(sd2Source, /请填写 Name/)
  assert.doesNotMatch(sd2Source, /请填写 GroupId 与 Name/)
  assert.doesNotMatch(sd2Source, /placeholder="Secret Access Key"/)
  assert.doesNotMatch(sd2Source, /<el-option label="Image" value="Image"/)

  assert.match(sd2Source, /call\('CreateAssetGroup'/)
  assert.match(sd2Source, /call\('UpdateAssetGroup'/)
  assert.match(sd2Source, /call\('DeleteAssetGroup'/)
  assert.match(sd2Source, /call\('CreateAsset'/)
  assert.match(sd2Source, /call\('UpdateAsset'/)
  assert.match(sd2Source, /call\('DeleteAsset'/)
  assert.match(sd2Source, /令牌推理密钥（Bearer）/)
  assert.match(sd2Source, /否则会报无效授权/)
  assert.doesNotMatch(sd2Files.intro, /Invalid Authorization/)
  assert.doesNotMatch(sd2Files.intro, /not authorized/)
  assert.match(sd2Source, /from ['"]@\/utils\/elementPlusFeedback\.js['"]/)
  assert.doesNotMatch(sd2Source, /from ['"]element-plus['"]/)
  assert.doesNotMatch(sd2Source, /密钥当 Bearer，否则会报 Invalid Authorization/)
})

test('自由创作、项目列表、提示词和场景映射的用户可见句子是简体中文', () => {
  assert.match(freeCreateSource, /placeholder="例如：电影感、日式动漫…"/)
  assert.doesNotMatch(freeCreateSource, /placeholder="例如: cinematic, anime..."/)
  assert.match(freeCreateSource, /import \{ ElMessage \} from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(freeCreateSource, /from 'element-plus'/)
  assert.match(freeCreateSource, /aria-label="返回项目首页"/)
  assert.match(freeCreateSource, /aria-label="视频画面比例"/)
  assert.match(freeCreateSource, /generating \? '生成中…' : \(mode === 'image' \? '生成图片' : '生成视频'\)/)

  assert.match(filmListSource, /<el-option label="标题升序" value="title-asc" \/>/)
  assert.doesNotMatch(filmListSource, /标题 A-Z/)
  assert.match(filmListSource, /placeholder="搜索项目标题、描述、风格或类型"/)
  assert.match(filmListSource, /title="新建项目"/)
  assert.match(filmListSource, /title="打开数据备份"/)
  assert.match(filmListSource, /aria-label="打开数据备份与维护"/)
  assert.match(filmListSource, /<el-icon><Download \/><\/el-icon>数据备份/)
  assert.doesNotMatch(filmListSource, /微信我/)
  assert.match(filmListSource, /将移入回收站/)
  assert.match(filmListSource, /confirmButtonText: '移入回收站'/)
  assert.match(filmListLibraryUiSource, /ElMessageBox\.confirm\(`确定删除公共角色「/)
  assert.match(filmListLibraryUiSource, /正在上传图片，请稍候/)
  assert.match(filmListLibraryUiSource, /正在生成图片，请稍候/)

  assert.match(sceneModelMapSource, /当文本生成请求指定业务场景时/)
  assert.match(sceneModelMapSource, /description="暂无场景模型映射配置"/)
  assert.match(sceneModelMapSource, /确定要删除场景「\$\{getSceneKeyLabel\(row\.key\) \|\| row\.key\}」的模型映射配置吗？/)
  assert.match(sceneModelMapSource, /ElMessage\.error\(toUserFacingError\(err, '加载场景模型映射失败'\)\)/)
  assert.doesNotMatch(sceneModelMapSource, /当调用 generateText 时传入 scene_key/)
  assert.doesNotMatch(sceneModelMapSource, /scene_key/)
  assert.match(sceneModelMapSource, /from ['"]@\/utils\/elementPlusFeedback\.js['"]/)
  assert.doesNotMatch(sceneModelMapSource, /from ['"]element-plus['"]/)
})

test('提示词编辑页用户可见句子是简体中文', () => {
  assert.match(promptEditorSource, /系统提示词/)
  assert.doesNotMatch(promptEditorSource, /System Prompt/)
  assert.match(promptEditorSource, /confirmButtonText: '恢复默认'/)
  assert.match(promptEditorSource, /cancelButtonText: '取消'/)
  assert.match(promptEditorSource, /ElMessage\.error\('加载提示词失败'\)/)
  assert.match(promptEditorSource, /当前没有未保存的修改/)
  assert.match(promptEditorSource, /当前已是系统默认提示词，无需恢复/)
})

test('素材中心、剧详情、剧本生成和任务轮询的反馈文案保持简体中文', () => {
  assert.match(mediaLibrarySource, /aria-label="素材来源"/)
  assert.match(mediaLibraryCombinedSource, /placeholder="搜索素材..."/)
  assert.match(mediaLibraryCombinedSource, /title="素材预览"/)
  assert.match(mediaLibraryCombinedSource, /import \{ ElMessage, ElMessageBox \} from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(mediaLibraryCombinedSource, /from 'element-plus'/)
  assert.match(mediaLibraryCombinedSource, /ElMessageBox\.confirm\(`\$\{describeMediaDeleteImpact\(item\)\}确定删除？`, '删除确认'/)
  assert.match(mediaLibraryCombinedSource, /confirmButtonText: '删除'/)
  assert.match(mediaLibraryCombinedSource, /cancelButtonText: '取消'/)
  assert.match(mediaLibrarySource, /当前项目（编号 \$\{scopedDramaId\.value\}）/)
  assert.match(mediaLibraryCombinedSource, /Commons 页面编号/)

  assert.match(dramaDetailCombinedSource, /aria-label="新增空白集"/)
  assert.match(dramaDetailSource, /ElMessage\.warning\('请先新增一集，再进入制作'\)/)
  assert.match(dramaDetailDialogsSource, /title="编辑制作角色"/)
  assert.match(dramaDetailSource, /draft: '草稿', processing: '生成中', generating: '生成中', completed: '剧本已就绪', failed: '失败', published: '已发布'/)

  assert.match(storyGenerationSource, /ElMessage\.warning\('请先输入故事梗概'\)/)
  assert.match(storyGenerationSource, /ElMessage\.error\('未能启动剧本生成任务'\)/)
  assert.match(storyGenerationSource, /ElMessage\.error\(toUserFacingError\(e, '剧本生成失败'\)\)/)
  assert.match(storyGenerationSource, /ElMessage\.success\(n > 1 \? `剧本已生成，共 \$\{n\} 集/)

  assert.match(generationTaskStoreSource, /error: '缺少任务编号'/)
  assert.match(generationTaskStoreSource, /const USER_CANCEL_TASK_MSG = '用户已取消'/)
  assert.match(generationTaskStoreSource, /const ORPHAN_TASK_MSG = '任务长时间无进展，可能因服务重启而中断，请重新操作'/)
  assert.match(generationTaskStoreSource, /生成任务已超时（超过15分钟），请刷新页面查看是否已完成/)
  assert.doesNotMatch(generationTaskStoreSource, /error: '缺少 task_id'/)
  assert.doesNotMatch(generationTaskStoreSource, /error: '缺少任务编号（task_id）'/)

  assert.match(episodeBatchImportSource, /title="批量导入剧集"/)
  assert.match(episodeBatchImportSource, /将提前准备好的小说原文或剧本内容的 TXT 文件导入系统/)
  assert.match(episodeBatchImportSource, /ElMessage\.warning\('请先选择 TXT 文件'\)/)
  assert.doesNotMatch(episodeBatchImportSource, /\.txt文件/)
})


test('AI 配置页按钮、占位、表单标签和错误提示改为简体中文', () => {
  assert.match(aiConfigOverlaySource, /一键换密钥/)
  assert.doesNotMatch(aiConfigOverlaySource, /一键换Key/)
  assert.match(aiConfigOverlaySource, /修改密钥/)
  assert.doesNotMatch(aiConfigSource, /修改Key/)
  assert.match(aiConfigOverlaySource, /label="接口地址（Base URL）"/)
  assert.match(aiConfigOverlaySource, /label="工作流 JSON"/)
  assert.match(aiConfigJimeng2AssetsDialogSource, /label="素材地址"/)
  assert.match(aiConfigOverlaySource, /请输入 Bearer 令牌/)
  assert.match(aiConfigOverlaySource, /<span class="form-label-tip">API 密钥<\/span>/)
  assert.match(aiConfigOverlaySource, /访问密钥（AccessKey）/)
  assert.match(aiConfigOverlaySource, /私有密钥（SecretKey）/)
  assert.match(aiConfigOverlaySource, /组 ID（GroupId）/)
  assert.match(aiConfigBulkKeyDialogSource, /placeholder="粘贴新的 API 密钥"/)
  assert.match(aiConfigRowMutationsSource, /ElMessage\.success\(describeAiConfigBulkKeySuccess\(res\)\)/)
  assert.match(read('../src/utils/aiConfigLabels.js'), /所有配置的 API 密钥已更新/)
  assert.match(aiConfigJimeng2AssetsDialogSource, /jimeng2AssetStatusLabel\(row\.status\)/)
  assert.match(aiConfigJimeng2AssetsDialogSource, /jimeng2AssetTypeLabel\(row\.asset_type\)/)
  assert.match(aiConfigFormSettingsSource, /throw new Error\('工作流 JSON 格式无效'\)/)
  assert.doesNotMatch(aiConfigOverlaySource, /label="Base URL"/)
  assert.doesNotMatch(aiConfigOverlaySource, /label="Workflow JSON"/)
  assert.doesNotMatch(aiConfigSource, /label="asset_url"/)
  assert.doesNotMatch(aiConfigSource, /placeholder=.Bearer Token/)
})

test('404 页主标题是本地短剧助手，英文品牌只作次要标识', () => {
  assert.match(notFoundSource, /class="logo-main">本地短剧助手/)
  assert.match(notFoundSource, /class="logo-sub">LocalMiniDrama/)
  assert.match(notFoundSource, /<h1 id="not-found-title"[^>]*>\{\{ copy.title \}\}<\/h1>/)
  assert.match(read('../src/utils/notFoundNavigation.js'), /title: '页面不存在'/)
  assert.doesNotMatch(notFoundSource, /<p class="product-name">LocalMiniDrama<\/p>/)
})

test('页头、404、备份页和就绪提示不再直出英文界面词，配置节点保持停止等待', () => {
  const headerSources = [
    filmListHeaderSource,
    dramaDetailHeaderSource,
    freeCreateHeaderSource,
    mediaLibraryHeaderSource,
    backupHeaderSource,
    aiConfigPageSource,
  ]
  for (const source of headerSources) {
    assert.doesNotMatch(source, /微信我/)
    assert.doesNotMatch(source, />(Cancel|Retry|Error|Save|Loading|Timeout)</)
  }
  assert.match(notFoundSource, /返回项目列表/)
  assert.doesNotMatch(notFoundSource, /微信我/)
  assert.match(backupHeaderSource, /数据备份与维护/)
  assert.match(backupHeaderSource, /aria-label="创建全量备份"/)
  assert.match(backupCopySource, /正在创建备份，请稍候/)
  assert.doesNotMatch(backupCopySource, /\b(Cancel|Retry|Error|Save|Loading|Timeout)\b/)
  assert.match(projectReadinessSource, /请补充 API 密钥或有效的厂商认证/)
  assert.doesNotMatch(projectReadinessSource, /API Key/)
  assert.doesNotMatch(sd2Source, /\bAPI Key\b/)
  assert.doesNotMatch(sd2Source, /\bBase URL\b/)
  assert.match(freeCanvasNodeSource, />\s*停止等待\s*</)
  assert.match(freeCanvasNodeSource, /aria-label="停止等待"/)
  assert.match(freeCanvasInspectorSource, /aria-label="停止等待"/)
  assert.match(freeCanvasInspectorSource, />\s*停止等待\s*</)
})

test('允许修改的页面里，用户可见字符串都带有简体中文', () => {
  for (const [name, source] of Object.entries(ALLOWED_SOURCES)) {
    assertUserFacingChinese(`${name} 对话框标题`, collectDialogTitles(source))
    assertUserFacingChinese(`${name} placeholder`, collectAttrValues(source, ['placeholder']))
    assertUserFacingChinese(`${name} aria-label`, collectAttrValues(source, ['aria-label']))
    assertUserFacingChinese(
      `${name} 表单标签`,
      collectAttrValues(source, ['empty-text', 'description']).concat(
        [...source.matchAll(/<(?:el-form-item|el-option|el-table-column|el-tab-pane|el-radio-button)\b[^>]*(?<!:)label="([^"]+)"/g)].map((match) => match[1]),
      ).filter((value) => value.trim() && value !== ' '),
    )
    assertUserFacingChinese(`${name} ElMessage`, collectElMessageLiterals(source).filter((value) => {
      if (/^(error|warning|success|info|primary|danger|small|large|cancel|type)$/i.test(value)) return false
      if (/^(CreateAssetGroup|UpdateAssetGroup|DeleteAssetGroup|CreateAsset|UpdateAsset|DeleteAsset|GetAsset|ListAssetGroups|ListAssets)$/.test(value)) return false
      if (/^[A-Za-z0-9_./:+\-]+$/.test(value) && !/\s/.test(value)) return false
      if (/^\$\{/.test(value) && !CHINESE_RE.test(value)) return false
      return /[A-Za-z\u4e00-\u9fff]/.test(value)
    }))
  }
})

test('画布工作流轮询缺少任务编号时使用简体中文，不暴露 task_id', () => {
  const canvasWorkflowRunnerSource = read('../src/composables/useCanvasWorkflowRunner.js')
  assert.match(canvasWorkflowRunnerSource, /error: '缺少任务编号'/)
  assert.doesNotMatch(canvasWorkflowRunnerSource, /缺少 task_id/)
  assert.doesNotMatch(canvasWorkflowRunnerSource, /缺少任务编号（task_id）/)
  assert.doesNotMatch(canvasWorkflowRunnerSource, /supports_grid_reference/)
  const storyboardVideoSource = read('../src/composables/filmCreate/useFilmCreateStoryboardVideoGeneration.js')
  assert.doesNotMatch(storyboardVideoSource, /supports_grid_reference/)
  assert.match(storyboardVideoSource, /请在 AI 配置的高级设置中开启宫格整图参考/)
  assert.match(canvasWorkflowRunnerSource, /请在 AI 配置的高级设置中开启宫格整图参考/)
})
