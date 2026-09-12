const { test } = require('node:test');
const assert = require('node:assert/strict');

const dramaImportService = require('../src/services/dramaImportService');
const {
  DEFAULT_IMPORT_LIMITS,
  DramaImportError,
  createImageValidatorProcessSpec,
  normalizeImportLimits,
  validateImportComplexity,
  validateZipEntryName,
} = require('../src/services/dramaImportValidation');

const PUBLIC_EXPORTS = [
  'DEFAULT_IMPORT_LIMITS',
  'DramaImportError',
  'createImageValidatorProcessSpec',
  'importDrama',
  'parseZip',
  'resolveSourceOriginalQuotaBytes',
  'validateImportComplexity',
];

function baseProject(overrides = {}) {
  return {
    characters: [],
    episodes: [],
    scenes: [],
    props: [],
    ...overrides,
  };
}

test('项目导入公开 API 仍从 dramaImportService 原样导出', () => {
  assert.deepEqual(Object.keys(dramaImportService).sort(), PUBLIC_EXPORTS);
  assert.equal(dramaImportService.DEFAULT_IMPORT_LIMITS, DEFAULT_IMPORT_LIMITS);
  assert.equal(dramaImportService.DramaImportError, DramaImportError);
  assert.equal(dramaImportService.createImageValidatorProcessSpec, createImageValidatorProcessSpec);
  assert.equal(dramaImportService.validateImportComplexity, validateImportComplexity);
});

test('normalizeImportLimits 拒绝非正整数且不改写默认上限', () => {
  assert.throws(
    () => normalizeImportLimits({ maxCharacters: 0 }),
    (error) => error instanceof DramaImportError
      && error.code === 'INVALID_LIMIT'
      && error.message === '压缩包限制必须是正整数'
  );
  assert.throws(
    () => normalizeImportLimits({ maxCharacters: 1.5 }),
    (error) => error.code === 'INVALID_LIMIT'
  );
  const limits = normalizeImportLimits({ maxCharacters: 2 });
  limits.maxCharacters = 1;
  assert.equal(DEFAULT_IMPORT_LIMITS.maxCharacters, 1000);
  assert.equal(normalizeImportLimits().maxCharacters, 1000);
});

test('validateImportComplexity 拒绝非对象根节点和非数组字段', () => {
  assert.throws(
    () => validateImportComplexity(null, DEFAULT_IMPORT_LIMITS),
    (error) => error instanceof DramaImportError
      && error.code === 'INVALID_IMPORT_STRUCTURE'
      && error.message === '项目清单根节点必须是对象'
  );
  assert.throws(
    () => validateImportComplexity(baseProject({ characters: 'not-an-array' }), DEFAULT_IMPORT_LIMITS),
    (error) => error.code === 'INVALID_IMPORT_STRUCTURE'
      && /项目清单中的角色必须是数组/.test(error.message)
      && error.details?.field === 'characters'
  );
});

test('validateImportComplexity 把角色数量和故事素材数量当作不同上限', () => {
  assert.throws(
    () => validateImportComplexity(
      baseProject({
        characters: [{}, {}],
      }),
      { ...DEFAULT_IMPORT_LIMITS, maxCharacters: 1 }
    ),
    (error) => error.code === 'IMPORT_ENTITY_LIMIT_EXCEEDED'
      && error.statusCode === 413
      && /项目导入实体角色超过配置上限/.test(error.message)
      && error.details?.name === 'characters'
      && error.details?.actual === 2
  );

  const twoSources = validateImportComplexity(
    baseProject({
      source_intake: { sources: [{}, {}] },
    }),
    { ...DEFAULT_IMPORT_LIMITS, maxCharacters: 1 }
  );
  assert.equal(twoSources.entities.characters, 0);
  assert.equal(twoSources.entities.source_originals, 2);
  assert.equal(twoSources.entities.total, 3);
});

test('validateImportComplexity 累计全景图生成记录且拒绝非对象实体', () => {
  const result = validateImportComplexity(
    baseProject({
      scenes: [{ panorama_image_file: 'scenes/pano.png' }],
    }),
    DEFAULT_IMPORT_LIMITS
  );
  assert.equal(result.entities.image_generations, 1);
  assert.equal(result.media_references, 1);

  assert.throws(
    () => validateImportComplexity(
      baseProject({ scenes: ['bad'] }),
      DEFAULT_IMPORT_LIMITS
    ),
    (error) => error.code === 'INVALID_IMPORT_STRUCTURE'
      && error.message === '项目清单中的场景必须是对象'
  );
});

test('validateZipEntryName 拒绝逃逸、盘符和反斜杠路径', () => {
  assert.equal(validateZipEntryName('media/a.png', DEFAULT_IMPORT_LIMITS), 'media/a.png');
  assert.equal(validateZipEntryName('dir/sub/', DEFAULT_IMPORT_LIMITS, true), 'dir/sub');
  assert.throws(
    () => validateZipEntryName('../outside.png', DEFAULT_IMPORT_LIMITS),
    (error) => error instanceof DramaImportError
      && error.code === 'UNSAFE_ARCHIVE_PATH'
      && error.message === '压缩包不安全：条目路径会逃逸'
  );
  assert.throws(
    () => validateZipEntryName('C:/windows/bad.png', DEFAULT_IMPORT_LIMITS),
    (error) => error.code === 'UNSAFE_ARCHIVE_PATH'
      && error.message === '压缩包不安全：条目路径无效'
  );
  assert.throws(
    () => validateZipEntryName('dir\\file.png', DEFAULT_IMPORT_LIMITS),
    (error) => error.code === 'UNSAFE_ARCHIVE_PATH'
  );
});
