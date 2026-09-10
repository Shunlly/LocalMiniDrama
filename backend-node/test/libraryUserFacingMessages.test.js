const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const characterLibraryRoutes = require('../src/routes/characterLibrary');
const propLibraryRoutes = require('../src/routes/propLibrary');
const sceneLibraryRoutes = require('../src/routes/sceneLibrary');

function hasCjk(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

function throwingDb(message) {
  return {
    prepare() {
      throw new Error(message);
    },
  };
}

describe('资料库路由对用户返回中文错误', () => {
  it('源码不再把 err.message 直接交给 internalError', () => {
    for (const file of ['characterLibrary.js', 'propLibrary.js', 'sceneLibrary.js']) {
      const source = fs.readFileSync(path.join(__dirname, '../src/routes', file), 'utf8');
      assert.equal(source.includes('response.internalError(res, err.message)'), false, file);
      assert.match(source, /sendLibraryFailure/);
    }
  });

  it('列表失败映射为中文，不回传 SQLITE 英文', () => {
    const silent = { error() {} };
    const cases = [
      [characterLibraryRoutes, '角色库'],
      [propLibraryRoutes, '道具库'],
      [sceneLibraryRoutes, '场景库'],
    ];
    for (const [factory] of cases) {
      const res = mockRes();
      factory(throwingDb('SQLITE_ERROR: no such table: character_library'), {}, silent).list({ query: {} }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(hasCjk(res.body.error.message), true);
      assert.doesNotMatch(res.body.error.message, /SQLITE_ERROR|no such table/i);
    }
  });
});
