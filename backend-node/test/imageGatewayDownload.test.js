const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  downloadImageToLocalAbortable,
  removeDownloadedImage,
} = require('../src/services/imageGateway/download');

test('空地址或非字符串不下载', async () => {
  assert.equal(await downloadImageToLocalAbortable('/tmp', '', 'images', { warn() {}, info() {} }), null);
  assert.equal(await downloadImageToLocalAbortable('/tmp', null, 'images', { warn() {}, info() {} }), null);
});

test('非法 data URL 返回空且不抛给调用方', async () => {
  const warnings = [];
  const result = await downloadImageToLocalAbortable(
    '/tmp',
    'data:text/plain;base64,xxxx',
    'images',
    { warn(message) { warnings.push(message); }, info() {} },
  );
  assert.equal(result, null);
  assert.equal(warnings.some((item) => String(item).includes('下载图片到本地失败')), true);
});

test('没有本地路径时清理函数直接返回', () => {
  assert.equal(removeDownloadedImage('/tmp', '', { warn() {} }), undefined);
  assert.equal(removeDownloadedImage('/tmp', null, { warn() {} }), undefined);
});
