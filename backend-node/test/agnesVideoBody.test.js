const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAgnesVideoImagePayload, formatVideoPostBodyForLog } = require('../src/services/videoClient');

describe('formatVideoPostBodyForLog', () => {
  it('redacts prompts and signed URL queries while preserving image indexes', () => {
    const formatted = formatVideoPostBodyForLog({
      model: 'agnes-video-v2.0',
      prompt: 'private story prompt',
      extra_body: {
        image: [
          'https://cdn/a.jpg?X-Amz-Signature=secret-a',
          'https://cdn/b.png?token=secret-b',
        ],
      },
    });
    const serialized = JSON.stringify(formatted);
    assert.match(formatted.prompt, /^\[REDACTED_PROMPT length=\d+\]$/);
    assert.match(formatted.extra_body.image[0], /^\[0\] https:\/\/cdn\/a\.jpg\?\[REDACTED\]$/);
    assert.match(formatted.extra_body.image[1], /^\[1\] https:\/\/cdn\/b\.png\?\[REDACTED\]$/);
    assert.doesNotMatch(serialized, /private story prompt|secret-a|secret-b/);
  });

  it('summarizes base64 image fields', () => {
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(100);
    const formatted = formatVideoPostBodyForLog({ image: dataUrl });
    assert.match(formatted.image, /^\(base64, \d+ chars\)$/);
  });
});

describe('buildAgnesVideoImagePayload', () => {
  it('uses extra_body.image array for omni multi-reference without keyframes mode', () => {
    const refs = ['https://cdn/a.jpg', 'https://cdn/b.png', 'https://cdn/c.png'];
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: 'https://cdn/a.jpg',
      lastResolved: 'https://cdn/z.jpg',
    });
    assert.equal(out.strategy, 'omni_reference_extra_body');
    assert.deepEqual(out.extra_body, { image: refs });
    assert.equal(out.image, undefined);
    assert.equal(out.extra_body.mode, undefined);
  });

  it('uses single top-level image string for one omni reference', () => {
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: ['https://cdn/scene.jpg'],
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(out.strategy, 'omni_reference_single');
    assert.equal(out.image, 'https://cdn/scene.jpg');
  });

  it('uses extra_body keyframes only for classic first/last (not omni)', () => {
    const out = buildAgnesVideoImagePayload({
      useOmniReference: false,
      resolvedRefs: [],
      firstResolved: 'https://cdn/first.jpg',
      lastResolved: 'https://cdn/last.jpg',
    });
    assert.equal(out.strategy, 'classic_keyframes');
    assert.deepEqual(out.extra_body, {
      mode: 'keyframes',
      image: ['https://cdn/first.jpg', 'https://cdn/last.jpg'],
    });
    assert.equal(out.image, undefined);
  });

  it('does not use keyframes mode when omni refs exist', () => {
    const refs = ['https://cdn/s.jpg', 'https://cdn/c.jpg'];
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: 'https://cdn/s.jpg',
      lastResolved: 'https://cdn/l.jpg',
    });
    assert.equal(out.strategy, 'omni_reference_extra_body');
    assert.equal(out.extra_body.mode, undefined);
  });
});
