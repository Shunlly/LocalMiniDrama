import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const mediaLibrarySource = read('../src/views/MediaLibrary.vue')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const filmListSource = read('../src/views/FilmList.vue')
const freeCreateSource = read('../src/views/FreeCreate.vue')
const generationTaskStoreSource = read('../src/stores/generationTaskStore.js')
const storyGenerationSource = read('../src/composables/useStoryGeneration.js')
const episodeBatchImportSource = read('../src/components/EpisodeBatchImportDialog.vue')
const sceneModelMapSource = read('../src/components/SceneModelMap.vue')
const promptEditorSource = read('../src/components/PromptEditor.vue')
const sd2Source = read('../src/components/Sd2AssetManagement.vue')

const ALLOWED_SOURCES = {
  'MediaLibrary.vue': mediaLibrarySource,
  'DramaDetail.vue': dramaDetailSource,
  'FilmList.vue': filmListSource,
  'FreeCreate.vue': freeCreateSource,
  'generationTaskStore.js': generationTaskStoreSource,
  'useStoryGeneration.js': storyGenerationSource,
  'EpisodeBatchImportDialog.vue': episodeBatchImportSource,
  'SceneModelMap.vue': sceneModelMapSource,
  'PromptEditor.vue': promptEditorSource,
  'Sd2AssetManagement.vue': sd2Source,
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
  assert.match(sd2Source, /<el-form-item label="资产组 Id" required>/)
  assert.match(sd2Source, /<el-option label="图片" value="Image" \/>/)
  assert.match(sd2Source, /assetTypeLabel\(row\.AssetType\)/)
  assert.match(sd2Source, /Image: '图片', Video: '视频', Audio: '音频'/)
  assert.match(sd2Source, /<el-option label="视频" value="Video" \/>/)
  assert.match(sd2Source, /<el-option label="音频" value="Audio" \/>/)
  assert.match(sd2Source, /placeholder="控制台 IAM 私有密钥"/)
  assert.match(sd2Source, /ElMessage\.warning\('请填写名称'\)/)
  assert.match(sd2Source, /ElMessage\.warning\('请填写资产组 Id 与名称'\)/)
  assert.match(sd2Source, /return '请先填写接口地址（Base URL）'/)
  assert.match(sd2Source, /创建资产组（CreateAssetGroup）/)
  assert.match(sd2Source, /创建资产（CreateAsset）→ 列表 \/ 查询 \/ 更新 \/ 删除/)

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
})

test('自由创作、项目列表、提示词和场景映射的用户可见句子是简体中文', () => {
  assert.match(freeCreateSource, /placeholder="例如：电影感 cinematic、日式动漫 anime…"/)
  assert.doesNotMatch(freeCreateSource, /placeholder="例如: cinematic, anime..."/)
  assert.match(freeCreateSource, /aria-label="返回项目首页"/)
  assert.match(freeCreateSource, /aria-label="视频画面比例"/)
  assert.match(freeCreateSource, /generating \? '生成中\.\.\.' : \(mode === 'image' \? '生成图片' : '生成视频'\)/)

  assert.match(filmListSource, /<el-option label="标题升序" value="title-asc" \/>/)
  assert.doesNotMatch(filmListSource, /标题 A-Z/)
  assert.match(filmListSource, /placeholder="搜索项目标题、描述、风格或类型"/)
  assert.match(filmListSource, /title="新建项目"/)
  assert.match(filmListSource, /ElMessageBox\.confirm\(`确定删除公共角色「/)

  assert.match(promptEditorSource, /系统提示词（System Prompt）/)
  assert.match(promptEditorSource, /confirmButtonText: '恢复默认'/)
  assert.match(promptEditorSource, /cancelButtonText: '取消'/)
  assert.match(promptEditorSource, /ElMessage\.error\('加载提示词失败'\)/)

  assert.match(sceneModelMapSource, /当文本生成请求传入场景键 scene_key 时/)
  assert.match(sceneModelMapSource, /description="暂无场景模型映射配置"/)
  assert.match(sceneModelMapSource, /确定要删除场景「\$\{row\.key\}」的模型映射配置吗？/)
  assert.match(sceneModelMapSource, /ElMessage\.error\('加载场景模型映射失败：'/)
  assert.doesNotMatch(sceneModelMapSource, /当调用 generateText 时传入 scene_key/)
})

test('素材中心、剧详情、剧本生成和任务轮询的反馈文案保持简体中文', () => {
  assert.match(mediaLibrarySource, /aria-label="素材来源"/)
  assert.match(mediaLibrarySource, /placeholder="搜索素材..."/)
  assert.match(mediaLibrarySource, /title="素材预览"/)
  assert.match(mediaLibrarySource, /ElMessageBox\.confirm\(`\$\{describeMediaDeleteImpact\(item\)\}确定删除？`, '删除确认'/)
  assert.match(mediaLibrarySource, /confirmButtonText: '删除'/)
  assert.match(mediaLibrarySource, /cancelButtonText: '取消'/)

  assert.match(dramaDetailSource, /aria-label="新增空白集"/)
  assert.match(dramaDetailSource, /ElMessage\.warning\('请先新增一集，再进入制作'\)/)
  assert.match(dramaDetailSource, /title="编辑制作角色"/)
  assert.match(dramaDetailSource, /draft: '草稿', processing: '生成中', completed: '剧本已就绪', failed: '失败'/)

  assert.match(storyGenerationSource, /ElMessage\.warning\('请先输入故事梗概'\)/)
  assert.match(storyGenerationSource, /ElMessage\.error\('未能启动剧本生成任务'\)/)
  assert.match(storyGenerationSource, /ElMessage\.error\(e\.message \|\| '剧本生成失败'\)/)
  assert.match(storyGenerationSource, /ElMessage\.success\(n > 1 \? `剧本已生成，共 \$\{n\} 集/)

  assert.match(generationTaskStoreSource, /error: '缺少任务编号（task_id）'/)
  assert.match(generationTaskStoreSource, /const USER_CANCEL_TASK_MSG = '用户已取消'/)
  assert.match(generationTaskStoreSource, /const ORPHAN_TASK_MSG = '任务长时间无进展，可能因服务重启而中断，请重新操作'/)
  assert.match(generationTaskStoreSource, /生成任务已超时（超过15分钟），请刷新页面查看是否已完成/)
  assert.doesNotMatch(generationTaskStoreSource, /error: '缺少 task_id'/)

  assert.match(episodeBatchImportSource, /title="批量导入剧集"/)
  assert.match(episodeBatchImportSource, /将提前准备好的小说原文或剧本内容的 TXT 文件导入系统/)
  assert.match(episodeBatchImportSource, /ElMessage\.warning\('请先选择 TXT 文件'\)/)
  assert.doesNotMatch(episodeBatchImportSource, /\.txt文件/)
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
