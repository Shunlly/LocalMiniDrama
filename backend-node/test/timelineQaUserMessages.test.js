const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timelineRoutes = require('../src/routes/timelines');
const qaReportRoutes = require('../src/routes/qaReports');
const timelineService = require('../src/services/timelineService');
const qaService = require('../src/services/qaService');

const timelinesSrc = fs.readFileSync(path.join(__dirname, '../src/routes/timelines.js'), 'utf8');
const qaSrc = fs.readFileSync(path.join(__dirname, '../src/routes/qaReports.js'), 'utf8');

const leftover = [
  'Timeline operation failed',
  'Drama timeline not found',
  'Episode timeline not found',
  'QA operation failed',
  'QA report not found',
];

const allowQuotedEnglish = new Set([
  '../response',
  '../services/timelineService',
  '../services/qaService',
  'BAD_REQUEST',
  'WORKFLOW_NOT_READY',
  'timeline drama get',
  'timeline episode get',
  'timeline srt export',
  'timeline manifest export',
  'qa reports list',
  'qa reports get',
  'qa reports audit',
  'qa reports remediate',
  'Content-Type',
  'application/x-subrip; charset=utf-8',
  'Content-Disposition',
]);

const log = { error() {} };
const db = {};
const timelines = timelineRoutes(db, log);
const qa = qaReportRoutes(db, log);

function quotedStrings(source) {
  const out = [];
  const re = /(['"])([^'"\n]*)\1/g;
  let match;
  while ((match = re.exec(source))) out.push(match[2]);
  return out;
}

function isUserFacingEnglish(text) {
  if (allowQuotedEnglish.has(text)) return false;
  if (/[\u4e00-\u9fff]/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  return /\b(not found|failed|error|invalid|missing|cannot|unable|please)\b/i.test(text)
    || /[A-Za-z]+ [A-Za-z]+/.test(text);
}

function createRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

function invoke(handler, req) {
  const res = createRes();
  handler(req, res);
  return res;
}

function withStubs(stubs, fn) {
  const originals = stubs.map(([obj, key]) => [obj, key, obj[key]]);
  try {
    for (const [obj, key, impl] of stubs) obj[key] = impl;
    return fn();
  } finally {
    for (const [obj, key, original] of originals) obj[key] = original;
  }
}

function withNodeEnv(value, fn) {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
}

function codedError(message, code, extra) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra || {});
  return err;
}

function assertUserError(res, status, code, message) {
  assert.equal(res.statusCode, status);
  assert.equal(res.body && res.body.success, false);
  assert.equal(res.body && res.body.error && res.body.error.code, code);
  assert.equal(res.body.error.message, message);
  assert.match(res.body.error.message, /[\u4e00-\u9fff]/);
}

test('时间线和 QA 路由不再向前端返回英文错误文案', () => {
  for (const phrase of leftover) {
    assert.equal(timelinesSrc.includes(phrase), false, phrase);
    assert.equal(qaSrc.includes(phrase), false, phrase);
  }
  for (const text of quotedStrings(timelinesSrc).concat(quotedStrings(qaSrc))) {
    assert.equal(isUserFacingEnglish(text), false, text);
  }
  assert.match(timelinesSrc, /未找到该项目的时间线/);
  assert.match(timelinesSrc, /未找到该分集的时间线/);
  assert.match(timelinesSrc, /时间线操作失败，请稍后重试/);
  assert.match(qaSrc, /未找到该 QA 报告/);
  assert.match(qaSrc, /QA 操作失败，请稍后重试/);
});

test('时间线路由返回可操作的简体中文错误', () => {
  withStubs([
    [timelineService, 'getDramaTimeline', () => null],
    [timelineService, 'getEpisodeTimeline', () => null],
    [timelineService, 'exportEpisodeSrt', () => null],
    [timelineService, 'exportDramaManifest', () => null],
  ], () => {
    assertUserError(
      invoke(timelines.getDramaTimeline, { params: { id: 9 } }),
      404,
      'NOT_FOUND',
      '未找到该项目的时间线，请确认项目存在且已生成时间线'
    );
    assertUserError(
      invoke(timelines.getEpisodeTimeline, { params: { episode_id: 9 } }),
      404,
      'NOT_FOUND',
      '未找到该分集的时间线，请确认分集存在且已生成时间线'
    );
    assertUserError(
      invoke(timelines.exportEpisodeSrt, { params: { episode_id: 9 } }),
      404,
      'NOT_FOUND',
      '未找到该分集的时间线，请确认分集存在且已生成时间线'
    );
    assertUserError(
      invoke(timelines.exportDramaManifest, { params: { id: 9 } }),
      404,
      'NOT_FOUND',
      '未找到该项目的时间线，请确认项目存在且已生成时间线'
    );
  });

  withNodeEnv('test', () => {
    withStubs([
      [timelineService, 'getDramaTimeline', () => { throw new Error('SQLITE_ERROR: no such table'); }],
      [timelineService, 'getEpisodeTimeline', () => { throw codedError('drama_id 必填', 'BAD_REQUEST'); }],
      [timelineService, 'exportEpisodeSrt', () => { throw codedError('invalid episode id', 'BAD_REQUEST'); }],
      [timelineService, 'exportDramaManifest', () => { throw new Error(''); }],
    ], () => {
      assertUserError(
        invoke(timelines.getDramaTimeline, { params: { id: 1 } }),
        500,
        'INTERNAL_ERROR',
        '时间线操作失败，请稍后重试'
      );
      assertUserError(
        invoke(timelines.getEpisodeTimeline, { params: { episode_id: 1 } }),
        400,
        'BAD_REQUEST',
        'drama_id 必填'
      );
      assertUserError(
        invoke(timelines.exportEpisodeSrt, { params: { episode_id: 1 } }),
        400,
        'BAD_REQUEST',
        '请求参数无效，请检查项目或分集 ID 后重试'
      );
      assertUserError(
        invoke(timelines.exportDramaManifest, { params: { id: 1 } }),
        500,
        'INTERNAL_ERROR',
        '时间线操作失败，请稍后重试'
      );
    });
  });
});

test('QA 报告路由返回可操作的简体中文错误并保留错误码', () => {
  withStubs([
    [qaService, 'getQaReportById', () => null],
    [qaService, 'remediateQaReport', () => null],
  ], () => {
    const message = '未找到该 QA 报告，请确认报告 ID 是否正确，或先重新执行 QA 审计';
    assertUserError(invoke(qa.get, { params: { report_id: 8 } }), 404, 'NOT_FOUND', message);
    assertUserError(invoke(qa.remediate, { params: { report_id: 8 }, body: {} }), 404, 'NOT_FOUND', message);
  });

  withNodeEnv('test', () => {
    withStubs([
      [qaService, 'listQaReports', () => { throw new Error('database is locked'); }],
      [qaService, 'getQaReportById', () => { throw codedError('项目不存在或已移入回收站', 'DRAMA_NOT_FOUND'); }],
      [qaService, 'auditDrama', () => { throw codedError('请先选择项目', 'BAD_REQUEST'); }],
      [qaService, 'remediateQaReport', () => {
        throw codedError('Production 启动条件未满足：文本模型', 'WORKFLOW_NOT_READY', {
          details: { ready: false },
        });
      }],
    ], () => {
      assertUserError(
        invoke(qa.list, { query: {} }),
        500,
        'INTERNAL_ERROR',
        'QA 操作失败，请稍后重试'
      );
      assertUserError(
        invoke(qa.get, { params: { report_id: 1 } }),
        500,
        'INTERNAL_ERROR',
        '项目不存在或已移入回收站'
      );
      assertUserError(
        invoke(qa.audit, { body: {} }),
        400,
        'BAD_REQUEST',
        '请先选择项目'
      );
      const ready = invoke(qa.remediate, { params: { report_id: 1 }, body: {} });
      assertUserError(ready, 409, 'WORKFLOW_NOT_READY', 'Production 启动条件未满足：文本模型');
      assert.deepEqual(ready.body.error.details, { ready: false });
    });

    withStubs([
      [qaService, 'auditDrama', () => { throw codedError('invalid drama_id', 'BAD_REQUEST'); }],
      [qaService, 'remediateQaReport', () => {
        throw codedError('Workflow is not ready', 'WORKFLOW_NOT_READY', { details: { ready: false } });
      }],
    ], () => {
      assertUserError(
        invoke(qa.audit, { body: {} }),
        400,
        'BAD_REQUEST',
        '请求参数无效，请检查项目、分集或报告 ID 后重试'
      );
      assertUserError(
        invoke(qa.remediate, { params: { report_id: 2 }, body: {} }),
        409,
        'WORKFLOW_NOT_READY',
        '当前制作流程尚未就绪，请先完成必要配置后再执行 QA 修复'
      );
    });
  });
});
