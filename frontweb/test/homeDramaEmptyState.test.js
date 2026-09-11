import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildProjectReadiness } from '../src/utils/projectReadiness.js'
import { readFilmListLibrarySource } from './helpers/filmListLibrarySource.js'
import { readFilmListSources } from './helpers/filmListSources.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const filmListSource = readFilmListSources().ui
const filmListLibrarySource = readFilmListLibrarySource()
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const dramaDetailHeaderSource = read('../src/components/dramaDetail/DramaDetailHeader.vue')
const dramaDetailDialogsSource = read('../src/components/dramaDetail/DramaDetailResourceDialogs.vue')
const dramaDetailResourceLibrarySource = read('../src/components/dramaDetail/DramaDetailResourceLibrary.vue')
const dramaDetailUiSource = [dramaDetailSource, dramaDetailResourceLibrarySource, dramaDetailDialogsSource, read('../src/components/dramaDetail/DramaDetailEpisodeList.vue')].join('\n')
const readinessPanelSource = read('../src/components/ProjectReadinessPanel.vue')
const CHINESE_RE = /[\u4e00-\u9fff]/

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `缺少 function ${name}`)
  let depth = 0
  let started = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') {
      depth += 1
      started = true
    } else if (char === '}') {
      depth -= 1
      if (started && depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`未能闭合 function ${name}`)
}

function loadEmptyStateHelpers() {
  const names = [
    'clarifySourceWorkflowAction',
    'isNavigableReadinessAction',
    'sameReadinessDestination',
    'resolveEpisodeEmptyState',
  ]
  const body = names.map((name) => extractFunction(dramaDetailSource, name)).join('\n')
  return new Function(`${body}\nreturn { ${names.join(', ')} }`)()
}

test('首页空项目和下一步入口是中文，且空态按钮可点', () => {
  assert.match(filmListSource, /class="action-card action-card--empty" role="status"/)
  assert.match(filmListSource, /还没有短剧项目/)
  assert.match(filmListSource, /新建空白项目，或继续已有项目包。/)
  assert.match(filmListSource, /class="action-btn action-btn-new" :disabled="listWriteLocked" aria-label="新建项目" :title="listWriteLocked \? listWriteLockReason : undefined"/)
  assert.match(filmListSource, /id="project-list-load-error"/)
  assert.match(filmListSource, /listWriteLockReason/)
  assert.match(filmListSource, /项目数据加载失败，成功重试前不能新增或导入/)
  assert.match(filmListSource, /class="action-btn action-btn-import"[\s\S]*:disabled="listWriteLocked" aria-label="导入项目包" :title="listWriteLocked \? listWriteLockReason : undefined"/)
  assert.match(filmListSource, /class="example-btn"[\s\S]*:disabled="listWriteLocked"\s*:title="listWriteLocked \? listWriteLockReason : undefined"/)
  assert.match(filmListSource, /前往素材中心/)
  assert.match(filmListSource, /class="action-btn-material" aria-label="打开素材中心"/)
  assert.match(filmListSource, /查看回收站/)
  assert.match(filmListSource, /class="action-btn-trash" aria-label="打开项目回收站"/)
  assert.match(filmListSource, /没有匹配的项目/)
  assert.match(filmListSource, /换一个关键词或状态，或清除筛选后查看全部项目。/)
  assert.match(filmListSource, /@click="clearProjectFilters"/)
  assert.match(filmListSource, /class="workspace-clear-filters"/)
  assert.match(filmListSource, /aria-label="清除筛选并查看全部项目"/)
  assert.match(filmListSource, /回收站中没有项目/)
  assert.equal((filmListLibrarySource.match(/class="library-empty" role="status"/g) || []).length, 3)
  assert.match(filmListLibrarySource, /aria-label="清除角色素材搜索"/)
  assert.match(filmListLibrarySource, /aria-label="清除场景素材搜索"/)
  assert.match(filmListLibrarySource, /aria-label="清除道具素材搜索"/)
  assert.doesNotMatch(filmListSource, /No projects|Get started|Create project|Next step|Empty state/i)
})

test('剧详情空状态的素材处理下一步保持可点，文案为中文', () => {
  const { resolveEpisodeEmptyState } = loadEmptyStateHelpers()
  const noText = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 0,
    aiConfigs: [],
  })
  const resolvedNoText = resolveEpisodeEmptyState(noText.episodeEmptyState)
  assert.equal(resolvedNoText.primaryAction.label, '新增空白集')
  assert.equal(resolvedNoText.primaryDisabledReason, '')
  assert.equal(resolvedNoText.unblockAction.target, 'source-workflow')
  assert.equal(resolvedNoText.unblockAction.label, '前往素材处理')
  assert.equal(resolvedNoText.note, '')
  assert.match(resolvedNoText.title, CHINESE_RE)
  assert.match(resolvedNoText.description, CHINESE_RE)

  const noSource = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 0,
    aiConfigs: [
      { service_type: 'text', is_active: true, is_default: true, default_model: 'qwen', credential_set: true },
    ],
  })
  const resolvedNoSource = resolveEpisodeEmptyState(noSource.episodeEmptyState)
  assert.equal(resolvedNoSource.primaryAction.label, '新增空白集')
  assert.equal(resolvedNoSource.primaryDisabledReason, '')
  assert.equal(resolvedNoSource.unblockAction.target, 'source-workflow')
  assert.equal(resolvedNoSource.note, '')

  const readyToGenerate = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 1,
    aiConfigs: [
      { service_type: 'text', is_active: true, is_default: true, default_model: 'qwen', credential_set: true },
    ],
  })
  const resolvedReady = resolveEpisodeEmptyState(readyToGenerate.episodeEmptyState)
  assert.equal(resolvedReady.primaryAction.label, '新增空白集')
  assert.equal(resolvedReady.primaryDisabledReason, '')
  assert.equal(resolvedReady.note, '')

  assert.match(
    dramaDetailUiSource,
    /:disabled="Boolean\(episodeEmptyState\.primaryDisabledReason\)"[\s\S]*episodeEmptyState\.primaryAction\.label/,
  )
  assert.match(dramaDetailSource, /label: pending \? '正在检查\.\.\.' : '重试就绪检查'/)
  assert.match(dramaDetailSource, /primaryDisabledReason: pending \? '正在检查项目就绪依赖' : ''/)
})

test('无剧集时资源空状态会新增一集，而不是点页头或只滚走', () => {
  const helper = extractFunction(dramaDetailSource, 'goCreateOrAddEpisode')
  assert.match(helper, /if \(currentEpisodeId\.value\)/)
  assert.match(helper, /goCreate\(\)/)
  assert.match(helper, /return onAddEpisode\(\)/)
  assert.doesNotMatch(helper, /scrollToSection/)
  assert.doesNotMatch(helper, /ElMessage\.warning/)

  assert.match(
    dramaDetailUiSource,
    /本剧暂无制作角色[\s\S]*@click="goCreateOrAddEpisode">\{\{ currentEpisodeId \? '进入制作页提取角色' : '先去新增一集' \}\}/,
  )
  assert.match(
    dramaDetailUiSource,
    /本剧暂无制作场景[\s\S]*@click="goCreateOrAddEpisode">\{\{ currentEpisodeId \? '进入制作页提取场景' : '先去新增一集' \}\}/,
  )
  assert.match(
    dramaDetailUiSource,
    /本剧暂无制作道具[\s\S]*@click="goCreateOrAddEpisode">\{\{ currentEpisodeId \? '进入制作页提取道具' : '先去新增一集' \}\}/,
  )
  assert.match(
    dramaDetailDialogsSource,
    /@click="goCreateOrAddEpisode">\s*\{\{ currentEpisodeId \? '前往制作页新增并入库' : '先去新增一集' \}\}/,
  )
  assert.doesNotMatch(
    dramaDetailSource,
    /@click="goCreate(?:\(\))?"[^>]*>\{\{ currentEpisodeId/,
  )
  assert.match(
    dramaDetailHeaderSource,
    /:disabled="!currentEpisodeId"/,
  )
  assert.match(dramaDetailSource, /@go-create="goCreate"/)
  assert.match(dramaDetailHeaderSource, /进入制作不可用：请先新增一集/)
  assert.match(dramaDetailHeaderSource, /画布模式不可用：请先新增一集/)
})

test('成片就绪度的下一步始终可点，且文案为中文', () => {
  const nextActionBlock = readinessPanelSource.match(/<div class="next-action"[\s\S]*?<\/div>\s*<el-button[\s\S]*?<\/el-button>/)?.[0] || ''
  assert.match(nextActionBlock, /下一步/)
  assert.match(nextActionBlock, /\{\{ readiness\.nextAction\.title \}\}/)
  assert.match(nextActionBlock, /\{\{ readiness\.nextAction\.label \}\}/)
  assert.doesNotMatch(nextActionBlock, /:disabled/)
  assert.match(dramaDetailSource, /nextAction: clarifySourceWorkflowAction\(readiness\.nextAction\)/)
  assert.match(dramaDetailSource, /label: '前往素材处理'/)
})
