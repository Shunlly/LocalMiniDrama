const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  productionProviderTypeLabel,
  timelineTrackTypeLabel,
  productionAssetTypeLabel,
  productionCompositeError,
  failedInvocationMessage,
  assembleProductionFailure,
} = require('../src/services/providerSdkErrors');

describe('providerSdkErrors 错误装配', () => {
  it('供应商、轨道和素材标签保持原中文映射', () => {
    assert.equal(productionProviderTypeLabel('image'), '图片供应商');
    assert.equal(productionProviderTypeLabel('video'), '视频供应商');
    assert.equal(productionProviderTypeLabel('tts'), '配音供应商');
    assert.equal(productionProviderTypeLabel('compositor'), '合成供应商');
    assert.equal(productionProviderTypeLabel('text'), '供应商');
    assert.equal(timelineTrackTypeLabel('video'), '视频');
    assert.equal(timelineTrackTypeLabel('subtitle'), '字幕');
    assert.equal(timelineTrackTypeLabel('voice'), '旁白');
    assert.equal(timelineTrackTypeLabel('dialogue'), '对白');
    assert.equal(timelineTrackTypeLabel('effect'), '音效');
    assert.equal(timelineTrackTypeLabel('bgm'), '背景音乐');
    assert.equal(timelineTrackTypeLabel('transition'), '转场');
    assert.equal(timelineTrackTypeLabel('unknown'), 'unknown');
    assert.equal(timelineTrackTypeLabel(''), '未知');
    assert.equal(productionAssetTypeLabel('character'), '角色');
    assert.equal(productionAssetTypeLabel('scene'), '场景');
    assert.equal(productionAssetTypeLabel('prop'), '道具');
    assert.equal(productionAssetTypeLabel('other'), 'other');
    assert.equal(productionAssetTypeLabel(''), '素材');
  });

  it('合成错误带固定错误码，失败调用文案不含英文协议细节', () => {
    const error = productionCompositeError('第 9 集还没有时间线，请先生成时间线后再合成');
    assert.equal(error.code, 'PRODUCTION_TIMELINE_INVALID');
    assert.equal(error.message, '第 9 集还没有时间线，请先生成时间线后再合成');
    assert.equal(failedInvocationMessage('image'), '图片供应商请求失败，请稍后重试');
    assert.equal(failedInvocationMessage('unknown'), '供应商请求失败，请稍后重试');
  });

  it('生产失败装配会清洗英文异常，保留可信中文前缀', () => {
    const wrapped = assembleProductionFailure(
      '分镜 12 的图片生成失败',
      new Error('connect ECONNREFUSED 127.0.0.1:443'),
      '请检查图片服务配置后重试',
    );
    assert.equal(wrapped.message, '分镜 12 的图片生成失败：请检查图片服务配置后重试');
    assert.doesNotMatch(wrapped.message, /ECONNREFUSED|127\.0\.0\.1/);

    const secret = assembleProductionFailure(
      '分镜 12 的配音生成失败',
      new Error('Invalid API key sk-secret-value'),
      '请检查配音服务配置后重试',
    );
    assert.doesNotMatch(secret.message, /sk-secret|Invalid API key/i);
    assert.match(secret.message, /分镜 12 的配音生成失败：/);

    const trusted = assembleProductionFailure(
      '第 9 集整集合成失败',
      new Error('该集缺少一个或多个已落盘的视频片段，请先完成分镜视频生成'),
      '请检查视频合成环境后重试',
    );
    assert.equal(
      trusted.message,
      '第 9 集整集合成失败：该集缺少一个或多个已落盘的视频片段，请先完成分镜视频生成',
    );
  });

  it('服务文件仍直接调用 toUserFacingProcessError，不把未知错误原文拼进用户文案', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/services/providerSdkService.js'), 'utf8');
    assert.match(source, /toUserFacingProcessError\(error/);
    assert.equal(source.includes("error.message || '未知错误'"), false);
    assert.match(source, /assembleProductionFailure\(/);
  });
});