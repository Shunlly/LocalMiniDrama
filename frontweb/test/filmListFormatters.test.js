import test from 'node:test'
import assert from 'node:assert/strict'

import { readFilmListSources } from './helpers/filmListSources.js'
import {
  describeListWriteLockReason,
  describePendingProjectPackageWork,
  describeProjectFormSubmitDisabledReason,
  describeTrashLiveStatus,
  describeTrashRestoreAnnouncement,
  describeTrashRestoreBusyReason,
  formatDate,
  formatGenre,
  formatStatus,
  formatStyle,
  normalizeImportFailureFilename,
  projectCoverAlt,
  projectCoverUrl,
  projectListCountLabel,
  projectSearchText,
  resolveImportFailureMessage,
  sanitizeImportFailureReason,
  totalStoryboards,
  truncateProjectTitle,
} from '../src/components/filmList/filmListFormatters.js'

const DRAMA_ID = 11
const OTHER_DRAMA_ID = 22
assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID)

const filmListFiles = readFilmListSources()
const filmListView = filmListFiles.view
const filmListSource = filmListFiles.ui

test('项目列表格式化函数已抽出，列表加载抽到 composable', () => {
  assert.match(filmListView, /from '@\/components\/filmList\/filmListFormatters\.js'/)
  assert.match(filmListView, /from '@\/components\/filmList\/useFilmListLoad\.js'/)
  assert.match(filmListView, /from '@\/components\/filmList\/useFilmListTrash\.js'/)
  assert.match(filmListView, /from '@\/components\/filmList\/useFilmListProjectForms\.js'/)
  assert.match(filmListView, /from '@\/components\/filmList\/useFilmListImportExport\.js'/)
  assert.match(filmListView, /from '@\/components\/filmList\/useFilmListNavigation\.js'/)
  assert.doesNotMatch(filmListView, /async function loadList\(/)
  assert.match(filmListSource, /async function loadList\(/)
  assert.match(filmListSource, /function projectCoverUrl\(drama\) \{\s*return resolveProjectCoverUrl\(drama, projectCoverErrors\.value\)/)
  assert.doesNotMatch(filmListView, /function projectSearchText\(/)
  assert.doesNotMatch(filmListView, /function formatDate\(/)
  assert.doesNotMatch(filmListView, /function formatStatus\(/)
  assert.doesNotMatch(filmListView, /function formatStyle\(/)
  assert.doesNotMatch(filmListView, /function formatGenre\(/)
  assert.doesNotMatch(filmListView, /function totalStoryboards\(/)
  assert.doesNotMatch(filmListView, /function normalizeImportFailureFilename\(/)
  assert.doesNotMatch(filmListView, /function sanitizeImportFailureReason\(/)
  assert.doesNotMatch(filmListView, /function resolveImportFailureMessage\(/)
  assert.doesNotMatch(filmListView, /function projectCoverAlt\(/)
  assert.doesNotMatch(filmListView, /function projectListCountLabel\(/)
  assert.doesNotMatch(filmListView, /function truncateProjectTitle\(/)
  assert.match(filmListView, /<FilmListTrashDialog/)
  assert.doesNotMatch(filmListView, /title="项目回收站"/)
  assert.match(filmListSource, /title="项目回收站"/)
  assert.match(filmListSource, /回收站中没有项目/)
  assert.doesNotMatch(filmListView, /export function loadList/)
  assert.doesNotMatch(filmListView, /export function useFilmList\b/)
})

test('日期、状态、风格、类型和分镜数按原语义格式化', () => {
  assert.equal(formatDate(''), '')
  assert.equal(formatDate(null), '')
  assert.equal(formatDate('not-a-date'), '')
  assert.match(formatDate('2026-09-11T12:34:00'), /2026/)
  assert.equal(formatStatus('draft'), '草稿')
  assert.equal(formatStatus('published'), '已发布')
  assert.equal(formatStatus('archived'), '已归档')
  assert.equal(formatStatus('generating'), '生成中')
  assert.equal(formatStatus('processing'), '生成中')
  assert.equal(formatStatus('completed'), '已完成')
  assert.equal(formatStatus('failed'), '失败')
  assert.equal(formatStatus(''), '草稿')
  assert.equal(formatStatus('custom'), '未知状态')
  assert.equal(formatStatus('待审'), '待审')
  assert.equal(formatStyle('realistic'), '写实')
  assert.equal(formatStyle('anime style'), '日本动漫')
  assert.equal(formatStyle('sci-fi'), '科幻')
  assert.equal(formatStyle('unknown-style'), '未知风格')
  assert.equal(formatStyle('水墨风'), '水墨风')
  assert.equal(formatGenre('drama'), '剧情')
  assert.equal(formatGenre('romance'), '爱情')
  assert.equal(formatGenre('mystery'), '未知类型')
  assert.equal(formatGenre('都市'), '都市')
  assert.equal(totalStoryboards({}), 0)
  assert.equal(totalStoryboards({ episodes: [] }), 0)
  assert.equal(totalStoryboards({ episodes: [{}, { storyboards: [{ id: 1 }, { id: 2 }] }] }), 2)
  assert.equal(
    totalStoryboards({
      episodes: [
        { storyboards: [{ id: DRAMA_ID }] },
        { storyboards: [{ id: OTHER_DRAMA_ID }, { id: 33 }] },
      ],
    }),
    3,
  )
})

test('搜索文本使用中文状态/风格/类型，且不会把不同项目混在一起', () => {
  const rain = projectSearchText({
    id: DRAMA_ID,
    title: '雨巷',
    description: '油纸伞',
    status: 'draft',
    style: 'realistic',
    genre: 'drama',
    metadata: { aspect_ratio: '16:9' },
  })
  const moon = projectSearchText({
    id: OTHER_DRAMA_ID,
    title: '月光',
    description: '基地',
    status: 'published',
    style: 'anime style',
    genre: 'romance',
  })
  assert.match(rain, /雨巷/)
  assert.match(rain, /油纸伞/)
  assert.match(rain, /草稿/)
  assert.match(rain, /写实/)
  assert.match(rain, /剧情/)
  assert.match(rain, /16:9/)
  assert.doesNotMatch(rain, /月光/)
  assert.doesNotMatch(rain, /已发布/)
  assert.match(moon, /月光/)
  assert.match(moon, /已发布/)
  assert.match(moon, /日本动漫/)
  assert.match(moon, /爱情/)
  assert.doesNotMatch(moon, /雨巷/)
  assert.doesNotMatch(moon, /草稿/)
})

test('封面地址在 coverErrors 命中后清空，且只影响对应项目', () => {
  const coverErrors = new Set([String(DRAMA_ID)])
  const rain = { id: DRAMA_ID, cover_image_url: 'https://cdn.example.test/rain.webp' }
  const moon = { id: OTHER_DRAMA_ID, cover_image_url: 'https://cdn.example.test/moon.webp' }
  assert.equal(projectCoverUrl(rain, coverErrors), '')
  assert.equal(projectCoverUrl(moon, coverErrors), 'https://cdn.example.test/moon.webp')
  assert.equal(projectCoverUrl(rain), 'https://cdn.example.test/rain.webp')
  assert.equal(projectCoverUrl({ id: OTHER_DRAMA_ID }), '')
})

test('导入失败文件名清洗掉路径和非法字符', () => {
  assert.equal(normalizeImportFailureFilename('C:\\\\Users\\\\33028\\\\Downloads\\\\雨巷.zip'), '雨巷.zip')
  assert.equal(normalizeImportFailureFilename('../a<>b.zip'), 'a__b.zip')
  assert.equal(normalizeImportFailureFilename('...'), '未命名项目包')
  assert.equal(normalizeImportFailureFilename(''), '未命名项目包')
  assert.equal(normalizeImportFailureFilename(null), '未命名项目包')
  const longName = `${'项'.repeat(130)}.zip`
  assert.equal(normalizeImportFailureFilename(longName).length, 120)
})

test('导入失败原因会脱敏路径，并挡住技术堆栈', () => {
  assert.equal(sanitizeImportFailureReason(''), '项目包导入失败，请重新选择项目包后重试')
  assert.equal(sanitizeImportFailureReason('   '), '项目包导入失败，请重新选择项目包后重试')
  assert.equal(sanitizeImportFailureReason('项目包已损坏'), '项目包已损坏')
  assert.match(sanitizeImportFailureReason('无法读取 file:///C:/secret/drama.zip'), /本地文件/)
  assert.doesNotMatch(sanitizeImportFailureReason('无法读取 file:///C:/secret/drama.zip'), /secret/)
  assert.match(sanitizeImportFailureReason('无法读取 C:\\\\Users\\\\33028\\\\secret\\\\drama.zip'), /本地文件/)
  assert.equal(sanitizeImportFailureReason('无法读取 /var/app/backend-node/data/drama.zip'), '无法读取 服务器文件')
  assert.doesNotMatch(sanitizeImportFailureReason('无法读取 /var/app/backend-node/data/drama.zip'), /backend-node|drama\.zip/)
  assert.equal(
    sanitizeImportFailureReason('Traceback (most recent call last): sqlite exception in backend-node'),
    '项目包解析失败，请确认文件完整且与当前版本兼容',
  )
  assert.equal(sanitizeImportFailureReason('x'.repeat(200)).length, 160)
})

test('导入失败消息优先清洗响应体，再回退到 error.message', () => {
  assert.equal(
    resolveImportFailureMessage({ response: { data: '项目包已损坏' } }),
    '项目包已损坏',
  )
  assert.equal(
    resolveImportFailureMessage({ response: { data: { error: { message: '磁盘已满，请清理后重试' } } } }),
    '磁盘已满，请清理后重试',
  )
  assert.equal(
    resolveImportFailureMessage({ response: { data: { message: '版本不兼容，请重新导出' } } }),
    '版本不兼容，请重新导出',
  )
  assert.equal(
    resolveImportFailureMessage({ response: { data: { error: '压缩包不完整，请重新选择' } } }),
    '压缩包不完整，请重新选择',
  )
  assert.equal(
    resolveImportFailureMessage({ message: '请选择 .zip 格式的项目包' }),
    '请选择 .zip 格式的项目包',
  )
  assert.equal(
    resolveImportFailureMessage({
      response: { data: 'Traceback (most recent call last): File backend-node/import.js sqlite exception' },
    }),
    '项目包解析失败，请确认文件完整且与当前版本兼容',
  )
  assert.equal(
    resolveImportFailureMessage({ message: 'Network Error' }),
    '项目包导入失败，请重新选择项目包后重试',
  )
})

test('combined source 仍能匹配导入失败清洗函数体', () => {
  assert.match(
    filmListSource,
    /function normalizeImportFailureFilename\(name\) \{[\s\S]*split\(\/\[\\\\\/\]\/[\s\S]*未命名项目包/,
  )
  assert.match(
    filmListSource,
    /function sanitizeImportFailureReason\(message\) \{[\s\S]*backend-node[\s\S]*项目包解析失败，请确认文件完整且与当前版本兼容/,
  )
  assert.match(
    filmListSource,
    /function resolveImportFailureMessage\(error\) \{[\s\S]*sanitizeImportFailureReason\(responseBody\)[\s\S]*sanitizeImportFailureReason\(responseMessage\)[\s\S]*sanitizeImportFailureReason\(error\?\.message\)/,
  )
  assert.match(filmListSource, /Number.isNaN\(d\.getTime\(\)\)/)
  assert.match(filmListSource, /async function loadList[\s\S]*hasSuccessfulListLoad\.value = true/)
})

test('封面替代文本、标题截断和列表计数不会把不同项目混在一起', () => {
  const longTitle = '雨巷夜色很长很长很长很长很长很长超过二十个字了'
  const rain = { id: DRAMA_ID, title: longTitle }
  const moon = { id: OTHER_DRAMA_ID, title: '月光' }
  assert.ok(longTitle.length > 20)
  assert.equal(projectCoverAlt(rain), `项目「${longTitle}」画面预览`)
  assert.equal(projectCoverAlt({}), '项目「未命名项目」画面预览')
  assert.doesNotMatch(projectCoverAlt(rain), /月光/)
  assert.equal(truncateProjectTitle(moon.title), '月光')
  assert.equal(truncateProjectTitle(longTitle), `${longTitle.slice(0, 20)}…`)
  assert.equal(truncateProjectTitle(''), '未命名')
  assert.equal(projectListCountLabel({ total: 0, page: 1, pageSize: 24, filteredCount: 0, hasFilters: false }), '暂无项目')
  assert.equal(projectListCountLabel({ total: 0, page: 1, pageSize: 24, filteredCount: 0, hasFilters: true }), '0 个项目')
  assert.equal(projectListCountLabel({ total: 3, page: 1, pageSize: 24, filteredCount: 2, hasFilters: true }), '2 / 3 个项目')
  assert.equal(projectListCountLabel({ total: 50, page: 2, pageSize: 24, filteredCount: 24, hasFilters: false }), '25-48 / 50 个项目')
})

test('写锁、表单提交和离开提示给出中文原因', () => {
  assert.equal(describeListWriteLockReason({ loading: true, hasSuccessfulListLoad: false }), '项目列表正在加载，请稍候')
  assert.equal(describeListWriteLockReason({
    loading: false,
    listError: 'offline',
    isStale: false,
    hasSuccessfulListLoad: false,
  }), '项目数据加载失败，成功重试前不能新增或导入')
  assert.equal(describeListWriteLockReason({
    loading: false,
    listError: 'offline',
    isStale: true,
    hasSuccessfulListLoad: true,
  }), '项目列表刷新失败，成功重试前不能新增或导入')
  assert.equal(describeListWriteLockReason({ loading: false, listError: '', hasSuccessfulListLoad: false }), '项目列表尚未就绪')
  assert.equal(describeListWriteLockReason({ loading: false, listError: '', hasSuccessfulListLoad: true }), '')
  assert.equal(describeProjectFormSubmitDisabledReason({
    writeLocked: true,
    writeLockReason: '项目列表正在加载，请稍候',
    title: '雨巷',
  }), '项目列表正在加载，请稍候')
  assert.equal(describeProjectFormSubmitDisabledReason({ writeLocked: false, title: '  ' }), '请先填写项目标题')
  assert.equal(describeProjectFormSubmitDisabledReason({ writeLocked: false, title: '雨巷' }), '')
  assert.equal(describePendingProjectPackageWork({ importing: true, importingExample: null, exportingId: null }), '项目包正在导入，请完成后再离开。')
  assert.equal(describePendingProjectPackageWork({ importing: false, importingExample: 'demo.zip', exportingId: null }), '项目包正在导入，请完成后再离开。')
  assert.equal(describePendingProjectPackageWork({ importing: false, importingExample: null, exportingId: DRAMA_ID }), '项目包正在导出，请完成后再离开。')
  assert.equal(describePendingProjectPackageWork({ importing: false, importingExample: null, exportingId: OTHER_DRAMA_ID }), '项目包正在导出，请完成后再离开。')
  assert.equal(describePendingProjectPackageWork({ importing: false, importingExample: null, exportingId: null }), '')
})

test('回收站状态文案按项目标题区分，恢复忙时只禁用其他项', () => {
  assert.equal(describeTrashLiveStatus({ announcement: '', loading: true, total: 3 }), '正在加载回收站')
  assert.equal(describeTrashLiveStatus({ announcement: '', loading: false, total: 2 }), '回收站中共有 2 个项目')
  assert.equal(describeTrashLiveStatus({ announcement: '项目「雨巷」已恢复，内容与关联素材保持不变。', loading: false, total: 1 }), '项目「雨巷」已恢复，内容与关联素材保持不变。')
  assert.equal(describeTrashRestoreAnnouncement('雨巷'), '项目「雨巷」已恢复，内容与关联素材保持不变。')
  assert.equal(describeTrashRestoreAnnouncement(''), '项目「未命名项目」已恢复，内容与关联素材保持不变。')
  assert.doesNotMatch(describeTrashRestoreAnnouncement('雨巷'), /月光/)
  assert.equal(describeTrashRestoreBusyReason(DRAMA_ID, OTHER_DRAMA_ID), '正在恢复其他项目，请稍候')
  assert.equal(describeTrashRestoreBusyReason(DRAMA_ID, DRAMA_ID), '')
  assert.equal(describeTrashRestoreBusyReason(null, OTHER_DRAMA_ID), '')
})
