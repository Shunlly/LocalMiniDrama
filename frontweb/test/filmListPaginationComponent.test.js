import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const paginationUrl = new URL('../src/components/filmList/FilmListPagination.vue', import.meta.url)
const FilmListPagination = await loadCompiledSfc(
  paginationUrl,
  'film-list-pagination-component',
  new Map([['vue', vueUrl]]),
)

const renderer = createHostRenderer()

function mountPagination(initial = {}) {
  const events = []
  const currentPage = ref(initial.currentPage ?? 1)
  const pageSize = ref(initial.pageSize ?? 24)
  const mounted = mountHarness(renderer, () => h(FilmListPagination, {
    currentPage: currentPage.value,
    'onUpdate:currentPage': (value) => {
      currentPage.value = value
    },
    pageSize: pageSize.value,
    'onUpdate:pageSize': (value) => {
      pageSize.value = value
    },
    loading: Boolean(initial.loading),
    hasSuccessfulListLoad: initial.hasSuccessfulListLoad !== false,
    listError: initial.listError ?? '',
    total: initial.total ?? 0,
    loadProjectPage: (page) => events.push(['page', page]),
    handleProjectPageSizeChange: (size) => events.push(['size', size]),
  }))
  return { ...mounted, events, currentPage, pageSize }
}

test('成功加载且超过一页时才渲染项目列表分页', async () => {
  const hidden = mountPagination({ total: 10, pageSize: 24, hasSuccessfulListLoad: true })
  try {
    await nextTick()
    assert.equal(findAll(hidden.root, (node) => node.type === 'pagination').length, 0)
  } finally {
    hidden.app.unmount()
  }

  const loading = mountPagination({ total: 50, pageSize: 24, loading: true })
  try {
    await nextTick()
    assert.equal(findAll(loading.root, (node) => node.type === 'pagination').length, 0)
  } finally {
    loading.app.unmount()
  }

  const visible = mountPagination({ total: 50, pageSize: 24, hasSuccessfulListLoad: true })
  try {
    await nextTick()
    const pagination = findAll(visible.root, (node) => node.type === 'pagination')
    assert.equal(pagination.length, 1)
    assert.equal(pagination[0].props.total, 50)
    pagination[0].props.onSelectPage(2)
    assert.deepEqual(visible.events, [['page', 2]])
  } finally {
    visible.app.unmount()
  }
})
