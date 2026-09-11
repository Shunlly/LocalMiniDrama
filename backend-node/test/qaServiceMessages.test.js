'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ISSUE_MESSAGES,
  ISSUE_RECOMMENDATIONS,
  PROCESS_ERROR_FALLBACKS,
  REMEDIATION_COPY,
  REMEDIATE_REASONS,
  issueMessage,
  recommendationForIssue,
  workflowActiveStatusReason,
} = require('../src/services/qaServiceMessages');

function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

test('QA issue 文案按草稿/正式模式返回简体中文', () => {
  assert.equal(issueMessage('drama_missing'), '项目不存在');
  assert.equal(
    issueMessage('media_timeline_incomplete', { draftMode: true }),
    '草稿流程的时间线计划不完整'
  );
  assert.equal(
    issueMessage('media_timeline_incomplete', { draftMode: false }),
    '正式交付检查要求每个分镜都有非占位的真实生成媒体'
  );
  assert.equal(
    issueMessage('storyboards_incomplete', { draftMode: false }),
    ISSUE_MESSAGES.storyboards_incomplete.production
  );
  assert.equal(issueMessage('unknown_code'), '');
});

test('QA 建议、修复动作和跳过原因都是简体中文', () => {
  const texts = [
    ...Object.values(ISSUE_RECOMMENDATIONS),
    ...Object.values(PROCESS_ERROR_FALLBACKS),
    ...Object.values(REMEDIATE_REASONS),
    ...Object.values(REMEDIATION_COPY).flatMap((item) => [item.label, item.reason]),
    workflowActiveStatusReason('pending'),
    workflowActiveStatusReason('processing'),
    workflowActiveStatusReason('paused'),
    workflowActiveStatusReason('other'),
  ];
  for (const text of texts) {
    assert.equal(hasCjk(text), true, text);
    assert.doesNotMatch(text, /[A-Za-z]{4,}\s+[A-Za-z]{4,}/);
  }
  assert.equal(
    recommendationForIssue({ code: 'storyboards_incomplete', message: 'fallback' }),
    '请在生成媒体前补齐分镜草稿字段。'
  );
  assert.equal(recommendationForIssue({ code: 'custom', message: '请先选择项目' }), '请先选择项目');
});
