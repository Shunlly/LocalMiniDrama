import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const filmListView = readFileSync(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')

test('新建弹窗取消按钮的读屏名称是取消新建项目', () => {
  const footer = filmListView.match(/title="新建项目"[\s\S]*?<template #footer>([\s\S]*?)<\/template>/)
  assert.ok(footer, '缺少新建项目弹窗页脚')
  assert.match(footer[1], /<el-button aria-label="取消新建项目" @click="showNewDialog = false">取消<\/el-button>/)
  assert.doesNotMatch(footer[1], /aria-label="Cancel"/)
})
