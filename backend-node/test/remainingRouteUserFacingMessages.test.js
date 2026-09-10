const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const promptOverrides = require('../src/routes/promptOverrides');
const { publicErrorMessage, uploadFormErrorMessage } = require('../src/routes/serviceFailure');
const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');
const assetRoutes = require('../src/routes/assets');

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

describe('剩余路由对用户返回中文错误', () => {
  it('源码不再把 err.message 直接交给 internalError', () => {
    const dir = path.join(__dirname, '../src/routes');
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      assert.equal(source.includes('response.internalError(res, err.message)'), false, file);
      assert.equal(source.includes('response.internalError(res, err.message ||'), false, file);
      assert.equal(source.includes('response.badRequest(res, err.message)'), false, file);
      assert.equal(source.includes('response.badRequest(res, err.message ||'), false, file);
      assert.equal(source.includes("writeNd({ type: 'error', message: err.message"), false, file);
      assert.equal(source.includes('response.notFound(res, err.message)'), false, file);
    }
  });

  it('素材列表失败映射为中文，不回传 SQLITE 英文', () => {
    const silent = { error() {} };
    const res = mockRes();
    assetRoutes({
      prepare() { throw new Error('SQLITE_ERROR: no such table: assets'); },
    }, silent).list({ query: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(hasCjk(res.body.error.message), true);
    assert.doesNotMatch(res.body.error.message, /SQLITE_ERROR|no such table/i);
  });

  it('夹杂英文字段名的中文错误不会直接回给用户', () => {
    assert.equal(isTrustedChineseUserError('drama_id 必填'), false);
    assert.equal(isTrustedChineseUserError('prompt 不能为空'), false);
    assert.equal(isTrustedChineseUserError('项目 ID 必填'), true);
    assert.equal(publicErrorMessage({ message: 'drama_id 必填' }, '请求参数无效'), '请求参数无效');
    assert.equal(publicErrorMessage({ message: '项目 ID 必填' }, '请求参数无效'), '项目 ID 必填');
  });

  it('上传表单错误码映射为中文，不回传 multer 英文', () => {
    assert.equal(uploadFormErrorMessage({ code: 'LIMIT_UNEXPECTED_FILE', message: 'Unexpected field' }, '上传失败'), '不支持的上传字段，请按页面提示选择文件');
    assert.equal(uploadFormErrorMessage({ message: 'Unexpected field' }, 'ZIP 上传失败，请更换文件后重试'), 'ZIP 上传失败，请更换文件后重试');
    assert.equal(uploadFormErrorMessage({ message: '请上传 TXT 文本文件' }, '素材导入失败，请更换文件后重试'), '请上传 TXT 文本文件');
  });

  it('提示词覆盖未知 key 和空内容是中文', () => {
    const silent = { error() {}, info() {} };
    const routes = promptOverrides.routes({}, silent);
    const unknown = mockRes();
    routes.update({ params: { key: 'not-a-prompt' }, body: { content: 'x' } }, unknown);
    assert.equal(unknown.statusCode, 400);
    assert.match(unknown.body.error.message, /未知的提示词/);
    assert.doesNotMatch(unknown.body.error.message, /\bkey\b/i);

    const empty = mockRes();
    routes.update({ params: { key: 'story_expansion_system' }, body: { content: '   ' } }, empty);
    assert.equal(empty.statusCode, 400);
    assert.equal(hasCjk(empty.body.error.message), true);
    assert.doesNotMatch(empty.body.error.message, /^content /);
  });
});
