'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  hubBusinessErrorMessage,
  normalizeMaterialHubToken,
  unwrapMaterialHubAssetView,
} = require('../src/services/jimengMaterialHubService');

describe('jimengMaterialHub response parsing', () => {
  it('hubBusinessErrorMessage detects model_ark 200+error body', () => {
    const msg = hubBusinessErrorMessage({
      error: '[Failed to download media from https://vendor.invalid/image?token=synthetic-private-value.]',
    });
    assert.match(msg, /failed/i);
    assert.doesNotMatch(msg, /synthetic-private-value|vendor\.invalid/);
  });

  it('unwrapMaterialHubAssetView parses flat AssetView', () => {
    const asset = unwrapMaterialHubAssetView({
      id: 'asset-20260602203139-2vr49',
      asset_url: 'asset://asset-20260602203139-2vr49',
      status: 'processing',
    });
    assert.equal(asset.id, 'asset-20260602203139-2vr49');
    assert.equal(asset.status, 'processing');
  });

  it('unwrapMaterialHubAssetView parses data wrapper', () => {
    const asset = unwrapMaterialHubAssetView({
      data: { asset_id: 'AST-1', status: 'active', asset_url: 'asset://x' },
    });
    assert.equal(asset.id, 'AST-1');
  });

  it('unwrapMaterialHubAssetView returns null when only error field', () => {
    assert.equal(unwrapMaterialHubAssetView({ error: 'failed' }), null);
  });

  it('normalizeMaterialHubToken strips Bearer and zero-width chars', () => {
    const t = normalizeMaterialHubToken('Bearer sk-test\u200bkey\u200b');
    assert.equal(t, 'sk-testkey');
  });

});
