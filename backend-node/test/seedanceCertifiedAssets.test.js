const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeMaterialHubAssetUrl,
  applySeedance2CertifiedAssetUrlsToVideoOpts,
  collectActiveCharacterVoiceRefs,
  rewriteOneImageUrlForSd2,
  VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME,
} = require('../src/services/videoGateway/seedanceCertifiedAssets');

function mockDb(rows, sqlIncludes = 'seedance2_asset') {
  return {
    prepare(sql) {
      assert.match(sql, /drama_id/);
      return {
        all(dramaId) {
          assert.equal(Number(dramaId), 41);
          return sql.includes(sqlIncludes) ? rows : [];
        },
      };
    },
  };
}

test('normalizeMaterialHubAssetUrl 统一成 asset 协议', () => {
  assert.equal(normalizeMaterialHubAssetUrl('asset://asset-1'), 'asset://asset-1');
  assert.equal(normalizeMaterialHubAssetUrl('asset-xyz'), 'asset://asset-xyz');
  assert.equal(normalizeMaterialHubAssetUrl('/abc'), 'asset://abc');
  assert.equal(normalizeMaterialHubAssetUrl(''), null);
});

test('认证角色图会替换视频参考 URL，已有 asset 协议保持不变', () => {
  const db = mockDb([{
    image_url: 'https://cdn.example/char.png?x=1',
    local_path: 'projects/1/characters/a.png',
    seedance2_asset: {
      status: 'active',
      hub_asset_id: 'asset-sd2',
      certified_image_url: 'https://cdn.example/certified.png',
      certified_local_path: 'projects/1/characters/certified.png',
    },
  }]);
  const rewritten = applySeedance2CertifiedAssetUrlsToVideoOpts(db, { info() {} }, {
    drama_id: 41,
    video_gen_id: 9,
    image_url: 'https://cdn.example/char.png?x=1',
    first_frame_url: 'https://cdn.example/certified.png',
    last_frame_url: 'asset://keep',
    reference_urls: ['https://example.invalid/static/projects/1/characters/a.png'],
  });
  assert.equal(rewritten.image_url, 'asset://asset-sd2');
  assert.equal(rewritten.first_frame_url, 'asset://asset-sd2');
  assert.equal(rewritten.last_frame_url, 'asset://keep');
  assert.deepEqual(rewritten.reference_urls, ['asset://asset-sd2']);
});

test('未激活的认证资产不会改写参考图', () => {
  const db = mockDb([{
    image_url: 'https://cdn.example/char.png',
    local_path: '',
    seedance2_asset: { status: 'pending', hub_asset_id: 'asset-sd2' },
  }]);
  const rewritten = applySeedance2CertifiedAssetUrlsToVideoOpts(db, null, {
    drama_id: 41,
    image_url: 'https://cdn.example/char.png',
  });
  assert.equal(rewritten.image_url, 'https://cdn.example/char.png');
});

test('音色参考只收集 active 角色，协议集合覆盖火山和可灵', () => {
  const db = {
    prepare() {
      return {
        all() {
          return [
            { id: 11, seedance2_voice_asset: { status: 'active', url: 'https://voice/a.wav' } },
            { id: 12, seedance2_voice_asset: { status: 'failed', url: 'https://voice/b.wav' } },
          ];
        },
      };
    },
  };
  const map = collectActiveCharacterVoiceRefs(db, 41);
  assert.equal(map.get(11), 'https://voice/a.wav');
  assert.equal(map.has(12), false);
  assert.equal(VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME.has('volcengine_omni'), true);
  assert.equal(VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME.has('kling'), true);
  assert.equal(rewriteOneImageUrlForSd2('data:image/png;base64,xx', { urlToAsset: new Map(), relPathToAsset: new Map() }).changed, false);
});
