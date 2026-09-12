const { test } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_IMPORT_LIMITS, DramaImportError } = require('../src/services/dramaImportValidation');
const {
  declaredFreeCanvasDramaId,
  normalizeFreeCanvasImportManifest,
  normalizeSourceIntakeManifest,
  parseFreeCanvasReferenceId,
} = require('../src/services/dramaImportManifest');

const NOW = '2026-01-02T03:04:05.000Z';
const HASH64 = 'ab'.repeat(32);

function sourceEntry(overrides = {}) {
  const sourceRef = overrides.source_ref || 'src1';
  const extension = overrides.extension || '.txt';
  return {
    source_ref: sourceRef,
    source_type: 'novel',
    title: '测试素材',
    content_hash: HASH64,
    metadata: { note: 'keep', api_key: 'secret', original_file: 'drop-me' },
    created_at: NOW,
    original: {
      archive_path: `source-intake/originals/${sourceRef}/original${extension}`,
      size: 12,
      sha256: HASH64,
      mime: 'text/plain',
    },
    ...overrides,
  };
}

test('normalizeSourceIntakeManifest 在缺省时返回空列表', () => {
  assert.deepEqual(normalizeSourceIntakeManifest({}, DEFAULT_IMPORT_LIMITS, NOW), []);
  assert.deepEqual(normalizeSourceIntakeManifest({ source_intake: null }, DEFAULT_IMPORT_LIMITS, NOW), []);
});

test('normalizeSourceIntakeManifest 拒绝非对象清单和不受支持的版本', () => {
  assert.throws(
    () => normalizeSourceIntakeManifest({ source_intake: [] }, DEFAULT_IMPORT_LIMITS, NOW),
    (error) => error instanceof DramaImportError
      && error.code === 'INVALID_SOURCE_MANIFEST'
      && error.message === '素材导入清单必须是对象'
  );
  assert.throws(
    () => normalizeSourceIntakeManifest({
      source_intake: { manifest_version: 2, hash_algorithm: 'sha256', sources: [] },
    }, DEFAULT_IMPORT_LIMITS, NOW),
    (error) => error.code === 'UNSUPPORTED_SOURCE_MANIFEST'
      && error.message === '素材导入清单版本或哈希算法不受支持'
  );
});

test('normalizeSourceIntakeManifest 校验路径、剥离敏感元数据，且不把角色清单当成素材清单', () => {
  const [entry] = normalizeSourceIntakeManifest({
    characters: [{ name: '林夏' }],
    source_intake: {
      manifest_version: 1,
      hash_algorithm: 'sha256',
      sources: [sourceEntry()],
    },
  }, DEFAULT_IMPORT_LIMITS, NOW);
  assert.equal(entry.source_ref, 'src1');
  assert.equal(entry.source_type, 'novel');
  assert.equal(entry.original.archive_path, 'source-intake/originals/src1/original.txt');
  assert.equal(entry.metadata.note, 'keep');
  assert.equal(entry.metadata.api_key, undefined);
  assert.equal(entry.metadata.original_file, undefined);

  assert.throws(
    () => normalizeSourceIntakeManifest({
      source_intake: {
        manifest_version: 1,
        hash_algorithm: 'sha256',
        sources: [sourceEntry({
          original: {
            archive_path: '../outside.txt',
            size: 12,
            sha256: HASH64,
            mime: 'text/plain',
          },
        })],
      },
    }, DEFAULT_IMPORT_LIMITS, NOW),
    (error) => error.code === 'UNSAFE_ARCHIVE_PATH'
      && error.message === '压缩包不安全：条目路径会逃逸'
  );
});

test('parseFreeCanvasReferenceId 不允许跨项目或跨类型引用互换', () => {
  assert.equal(parseFreeCanvasReferenceId(5, 11, 'assetId', 'asset'), 5);
  assert.equal(parseFreeCanvasReferenceId('asset:5', 11, 'assetId', 'asset'), 5);
  assert.equal(parseFreeCanvasReferenceId('project:11:asset:5', 11, 'assetId', 'asset'), 5);
  assert.throws(
    () => parseFreeCanvasReferenceId('project:22:asset:5', 11, 'assetId', 'asset'),
    (error) => error.code === 'BAD_REQUEST'
      && error.message === '自由画布导入素材 ID不属于当前项目'
  );
  assert.throws(
    () => parseFreeCanvasReferenceId('storyboard:5', 11, 'assetId', 'asset'),
    (error) => error.code === 'BAD_REQUEST'
      && error.message === '自由画布导入素材 ID必须为项目范围内的引用'
  );
});

test('declaredFreeCanvasDramaId 要求 projectId 与 dramaId 指向同一项目', () => {
  assert.equal(declaredFreeCanvasDramaId({ projectId: 11, dramaId: 11 }), 11);
  assert.throws(
    () => declaredFreeCanvasDramaId({ projectId: 11, dramaId: 22 }),
    (error) => error.code === 'BAD_REQUEST'
      && error.message === '自由画布项目标识必须引用同一项目'
  );
});

test('normalizeFreeCanvasImportManifest 拒绝剧集列表与分镜列表混用', () => {
  const emptyCanvas = { version: 1, nodes: [], edges: [] };
  const ok = normalizeFreeCanvasImportManifest({
    episodes: [],
    scenes: [],
    free_canvas_import: {
      manifest_version: 1,
      source_drama_id: 11,
      episode_ids: [],
      storyboard_ids: [],
      scene_refs: [],
      assets: [],
      video_generations: [],
      media: [],
    },
  }, emptyCanvas);
  assert.equal(ok.sourceDramaId, 11);
  assert.deepEqual(ok.episodeIds, []);
  assert.deepEqual(ok.storyboardIds, []);

  assert.throws(
    () => normalizeFreeCanvasImportManifest({
      episodes: [{ storyboards: [] }],
      scenes: [],
      free_canvas_import: {
        manifest_version: 1,
        source_drama_id: 11,
        episode_ids: [],
        storyboard_ids: [11],
        scene_refs: [],
        assets: [],
        video_generations: [],
        media: [],
      },
    }, emptyCanvas),
    (error) => error.code === 'BAD_REQUEST'
      && error.message === '自由画布导入剧集列表与导出剧集不一致'
  );

  assert.throws(
    () => normalizeFreeCanvasImportManifest({
      episodes: [{ storyboards: [] }],
      scenes: [],
      free_canvas_import: {
        manifest_version: 1,
        source_drama_id: 11,
        episode_ids: [11],
        storyboard_ids: [11],
        scene_refs: [],
        assets: [],
        video_generations: [],
        media: [],
      },
    }, emptyCanvas),
    (error) => error.code === 'BAD_REQUEST'
      && error.message === '自由画布导入分镜列表与导出分镜不一致'
  );

  assert.throws(
    () => normalizeFreeCanvasImportManifest({
      episodes: [],
      scenes: [],
      free_canvas_import: {
        manifest_version: 1,
        source_drama_id: 11,
        episode_ids: [],
        storyboard_ids: [],
        scene_refs: [],
        assets: [],
        video_generations: [],
        media: [],
      },
    }, { projectId: 22, nodes: [] }),
    (error) => error.code === 'BAD_REQUEST'
      && error.message === '自由画布导入源项目与画布项目引用不一致'
  );
});
