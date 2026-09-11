import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'
import { readSourceIntakeWorkflowSources } from './helpers/sourceIntakeWorkflowSources.js'

import { readDramaDetailPageLogicSources } from './helpers/dramaDetailPageSources.js'

const readDramaDetail = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const dramaDetailPageSource = readDramaDetail('../src/views/DramaDetail.vue')
const dramaDetailReadinessSource = readDramaDetail('../src/components/dramaDetail/DramaDetailReadinessSection.vue')
const dramaDetailResourceLibrarySource = readDramaDetail('../src/components/dramaDetail/DramaDetailResourceLibrary.vue')
const dramaDetailEpisodeListSource = readDramaDetail('../src/components/dramaDetail/DramaDetailEpisodeList.vue')
const dramaDetailSource = [
  readDramaDetailPageLogicSources(readDramaDetail),
  dramaDetailReadinessSource,
  dramaDetailResourceLibrarySource,
  dramaDetailEpisodeListSource,
].join('\n')
const dramaDetailHeaderSource = readFileSync(new URL('../src/components/dramaDetail/DramaDetailHeader.vue', import.meta.url), 'utf8')
const dramaDetailInfoCardSource = readFileSync(new URL('../src/components/dramaDetail/DramaDetailInfoCard.vue', import.meta.url), 'utf8')
const sourceWorkflowPanelSource = readFileSync(new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url), 'utf8')
const sourceWorkflowSource = readSourceIntakeWorkflowSources()

test('DramaDetail remains a valid SFC with explicit readiness dependency retry and autosave status UI', () => {
  const parsed = parse(dramaDetailPageSource, { filename: 'DramaDetail.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.match(dramaDetailSource, /readinessDependencyState = ref\('idle'\)/)
  assert.match(dramaDetailSource, /readinessDependencyError = ref\(''\)/)
  assert.match(dramaDetailSource, /hasReadinessSnapshot = ref\(false\)/)
  assert.match(dramaDetailSource, /buildReadinessDependencyError\(configsResult, sourcesResult\)/)
  assert.match(dramaDetailSource, /target: 'readiness-dependencies'/)
  assert.match(dramaDetailPageSource, /@retry="retryReadinessDependencies"/)
  assert.match(dramaDetailSource, /v-if="projectReadiness"/)
  assert.match(dramaDetailSource, /const infoSaveState = ref\('saved'\)/)
  assert.match(dramaDetailSource, /const infoSaveScheduled = ref\(false\)/)
  assert.match(dramaDetailSource, /const hasUnsavedInfoChanges = computed/)
  assert.match(dramaDetailSource, /function scheduleInfoSave\(\{ immediate = false \} = \{\}\)/)
  assert.match(dramaDetailSource, /async function flushInfoSave\(\)/)
  assert.match(dramaDetailSource, /async function retryInfoSave\(\)/)
  assert.match(dramaDetailSource, /onBeforeRouteLeave\(\(\) => confirmInfoLeave\(\)\)/)
  assert.match(dramaDetailSource, /window\.addEventListener\('beforeunload', handleInfoBeforeUnload\)/)
  assert.match(dramaDetailInfoCardSource, /class="info-save-status"/)
  assert.match(dramaDetailSource, /class="dependency-status dependency-status--error"/)
})

test('Source intake workflow remains a valid SFC with poll failure status and recovery controls', () => {
  const parsed = parse(sourceWorkflowPanelSource, { filename: 'SourceIntakeWorkflowPanel.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.match(sourceWorkflowPanelSource, /workflowDataError = ref\(''\)/)
  assert.match(sourceWorkflowPanelSource, /pollState = ref\('idle'\)/)
  assert.match(sourceWorkflowPanelSource, /pollError = ref\(''\)/)
  assert.match(sourceWorkflowPanelSource, /class="workflow-status-banner workflow-status-banner--error"/)
  assert.match(sourceWorkflowPanelSource, /class="poll-status-banner"/)
  assert.match(sourceWorkflowSource, /async function resumePolling\(\)/)
  assert.match(sourceWorkflowSource, /pollState\.value = 'error'/)
  assert.match(sourceWorkflowSource, /pollError.value = toUserFacingError\(error, '处理状态刷新失败，自动轮询已暂停。'/)
  assert.match(sourceWorkflowSource, /workflowDataError.value = toUserFacingError\(e, '加载素材流程状态失败，请稍后重试。'/)
  assert.match(sourceWorkflowPanelSource, /@click="resumePolling"/)
})

test('剧集资源库失败与空搜索分开展示，无分集时进入制作会说明原因', () => {
  assert.match(dramaDetailSource, /const charList = ref\(\[\]\), charLoading = ref\(false\), charError = ref\(''\)/)
  assert.match(dramaDetailSource, /charError\.value = dramaDetailUserError\(error, '角色库加载失败，请重试', '角色库'\)/)
  assert.doesNotMatch(dramaDetailSource, /catch \{ charList\.value = \[\] \}/)
  assert.match(dramaDetailSource, /v-if="charError"[\s\S]*@click="loadCharList"[\s\S]*重试/)
  assert.match(dramaDetailSource, /v-if="!charLoading && !charError && charList\.length === 0"/)
  assert.match(dramaDetailSource, /charKw\.trim\(\) \? '没有匹配的角色' : '暂无本剧角色库记录'/)
  assert.match(dramaDetailSource, /ElMessage\.warning\('请先新增一集，再进入制作'\)/)
  assert.match(dramaDetailHeaderSource, /:disabled="!currentEpisodeId"/)
  assert.match(dramaDetailSource, /@go-create="goCreate"/)
  assert.match(dramaDetailHeaderSource, /进入制作不可用：请先新增一集/)
  assert.match(dramaDetailSource, /ElMessage.warning\('请先新增一集，再进入画布'\)/)
  assert.match(dramaDetailSource, /@go-canvas-mode="goCanvasMode"/)
  assert.match(dramaDetailHeaderSource, /画布模式不可用：请先新增一集/)
})

test('DramaDetail 禁用操作和空封面提供可焦点的中文说明', () => {
  assert.match(dramaDetailHeaderSource, /:tabindex="currentEpisodeId \? undefined : 0"/)
  assert.match(
    dramaDetailHeaderSource,
    /:aria-label="currentEpisodeId \? undefined : '进入制作不可用：请先新增一集'"/,
  )
  assert.match(
    dramaDetailHeaderSource,
    /:aria-label="currentEpisodeId \? undefined : '画布模式不可用：请先新增一集'"/,
  )
  assert.match(dramaDetailSource, /:tabindex="episodeEmptyState.primaryDisabledReason \? 0 : undefined"/)
  assert.match(dramaDetailSource, /id="episode-empty-reason"/)
  assert.match(dramaDetailSource, /class="library-item-cover library-item-cover--empty"/)
  assert.match(dramaDetailSource, /class="drama-res-cover drama-res-cover--empty"/)
  assert.match(dramaDetailSource, /role="img"/)
  assert.match(dramaDetailSource, /暂无图片/)
  assert.match(dramaDetailSource, /tooltip-trigger:focus-visible/)
  assert.equal(dramaDetailSource.includes(':disabled="!assetImageUrl(item)"'), false)
})

test('剧集详情离开保护会拦截未导入的批量剧集，并走统一中文错误', () => {
  assert.match(dramaDetailPageSource, /import \{ dramaDetailUserError, characterRoleLabel, propTypeLabel \} from '@\/components\/dramaDetail\/dramaDetailResourceEdit\.js'/)
  assert.match(dramaDetailSource, /dramaDetailUserError\(/)
  assert.match(dramaDetailSource, /async function confirmBatchImportLeave\(\)/)
  assert.match(dramaDetailSource, /episodeBatchImportDialogRef\.value\?\.isImporting\?\.\(\)/)
  assert.match(dramaDetailSource, /ElMessage\.warning\('正在导入剧集，请完成后再离开。'\)/)
  assert.match(dramaDetailSource, /episodeBatchImportDialogRef\.value\?\.hasUnsavedWork\?\.\(\)/)
  assert.match(
    dramaDetailSource,
    /function handleInfoBeforeUnload\(event\) \{[\s\S]*shouldProtectInfoLeave\.value && !episodeBatchImportDialogRef\.value\?\.hasUnsavedWork\?\.\(\)/,
  )
})

test('批量导入弹窗关闭会保护进行中的导入和未提交草稿', () => {
  const dialogSource = readFileSync(new URL('../src/components/EpisodeBatchImportDialog.vue', import.meta.url), 'utf8')
  assert.match(dialogSource, /:before-close="requestClose"/)
  assert.match(dialogSource, /ElMessage\.warning\('正在导入剧集，请完成后再关闭。'\)/)
  assert.match(dialogSource, /关闭批量导入？/)
  assert.match(dialogSource, /已选择的剧本文件和预览结果尚未导入，关闭后会丢失。/)
  assert.match(dialogSource, /文件内容为空，请选择包含章节文本的 TXT 文件/)
  assert.match(dialogSource, /aria-label="选择 TXT 剧本文件"/)
})
