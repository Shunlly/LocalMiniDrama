const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dramaImportService = require('../src/services/dramaImportService');
const {
  buildLegacyImportedFreeCanvasMaps,
  createImportedFreeCanvasMaps,
  mapImportedFreeCanvasId,
  mapImportedFreeCanvasPath,
  remapImportedFreeCanvas,
} = require('../src/services/dramaImportRestore');

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaImportService.js'),
  'utf8'
);
const APPLY_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaImportApply.js'),
  'utf8'
);
const CANVAS_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaImportCanvas.js'),
  'utf8'
);

function expectBadRequest(message) {
  return (error) => error && error.code === 'BAD_REQUEST' && error.message === message;
}

test('画布还原映射已从导入服务文件中移出', () => {
  for (const name of [
    'function mapImportedFreeCanvasId',
    'function mapImportedFreeCanvasPath',
    'function createImportedFreeCanvasMaps',
    'function remapImportedFreeCanvas',
    'function buildLegacyImportedFreeCanvasMaps',
  ]) {
    assert.equal(SERVICE_SRC.includes(name), false, name);
  }
  assert.match(APPLY_SRC, /require\('\.\/dramaImportRestore'\)/);
  assert.match(CANVAS_SRC, /require\('\.\/dramaImportRestore'\)/);
  assert.deepEqual(Object.keys(dramaImportService).sort(), [
    'DEFAULT_IMPORT_LIMITS',
    'DramaImportError',
    'createImageValidatorProcessSpec',
    'importDrama',
    'parseZip',
    'resolveSourceOriginalQuotaBytes',
    'validateImportComplexity',
  ]);
});

test('mapImportedFreeCanvasId 不允许跨项目或跨类型 ID 互换', () => {
  const episodeMap = new Map([[5, 101]]);
  const storyboardMap = new Map([[5, 202]]);
  assert.equal(mapImportedFreeCanvasId(5, episodeMap, 11, 'episodeId', 'episode'), 101);
  assert.equal(mapImportedFreeCanvasId(5, storyboardMap, 11, 'storyboardId', 'storyboard'), 202);
  assert.equal(mapImportedFreeCanvasId('episode:5', episodeMap, 11, 'episodeId', 'episode'), 101);
  assert.equal(mapImportedFreeCanvasId('project:11:episode:5', episodeMap, 11, 'episodeId', 'episode'), 101);

  assert.throws(
    () => mapImportedFreeCanvasId('project:22:episode:5', episodeMap, 11, 'episodeId', 'episode'),
    expectBadRequest('自由画布导入剧集 ID不属于当前项目')
  );
  assert.throws(
    () => mapImportedFreeCanvasId('storyboard:5', episodeMap, 11, 'episodeId', 'episode'),
    expectBadRequest('自由画布导入剧集 ID必须为项目范围内的引用')
  );
  assert.throws(
    () => mapImportedFreeCanvasId(9, episodeMap, 11, 'episodeId', 'episode'),
    expectBadRequest('自由画布导入剧集 ID无法映射到导入项目')
  );
  assert.throws(
    () => mapImportedFreeCanvasId(5, episodeMap, null, 'episodeId', 'episode'),
    expectBadRequest('自由画布导入剧集 ID缺少可验证的源项目引用')
  );
  assert.equal(mapImportedFreeCanvasId(undefined, episodeMap, 11, 'episodeId', 'episode'), undefined);
});

test('mapImportedFreeCanvasPath 只替换规范化后的源路径，无效路径保持原值', () => {
  const pathMap = new Map([
    ['projects/11_demo/images/a.png', 'projects/99_imp/images/a.png'],
  ]);
  assert.equal(
    mapImportedFreeCanvasPath('projects/11_demo/images/a.png', pathMap),
    'projects/99_imp/images/a.png'
  );
  assert.equal(
    mapImportedFreeCanvasPath('/static/projects/11_demo/images/a.png', pathMap),
    'projects/99_imp/images/a.png'
  );
  assert.equal(
    mapImportedFreeCanvasPath('projects/11_demo/images/missing.png', pathMap),
    'projects/11_demo/images/missing.png'
  );
  assert.equal(mapImportedFreeCanvasPath('../outside.png', pathMap), '../outside.png');
  assert.equal(mapImportedFreeCanvasPath(12, pathMap), 12);
  assert.equal(mapImportedFreeCanvasPath(null, pathMap), null);
});

test('createImportedFreeCanvasMaps 为不同实体准备独立映射表', () => {
  const maps = createImportedFreeCanvasMaps(11);
  assert.equal(maps.sourceDramaId, 11);
  maps.episodes.set(1, 10);
  maps.storyboards.set(1, 20);
  maps.assets.set(1, 30);
  assert.equal(maps.episodes.get(1), 10);
  assert.equal(maps.storyboards.get(1), 20);
  assert.equal(maps.assets.get(1), 30);
  assert.equal(maps.scenes.size, 0);
});

test('buildLegacyImportedFreeCanvasMaps 拒绝无法验证的旧版引用，允许无引用画布', () => {
  const empty = buildLegacyImportedFreeCanvasMaps(11, { metadata: {} });
  assert.equal(empty.sourceDramaId, 11);

  const decorative = buildLegacyImportedFreeCanvasMaps(11, {
    metadata: {
      free_canvas: {
        version: 1,
        projectId: 11,
        dramaId: 11,
        nodes: [{ id: 'n1', type: 'text', text: 'hello' }],
        edges: [],
      },
    },
  });
  assert.equal(decorative.sourceDramaId, 11);

  assert.throws(
    () => buildLegacyImportedFreeCanvasMaps(11, {
      metadata: { free_canvas: { version: 1, projectId: 11, nodes: [] } },
    }),
    expectBadRequest('旧版 ZIP 自由画布缺少一致的项目身份声明')
  );
  assert.throws(
    () => buildLegacyImportedFreeCanvasMaps(11, {
      metadata: {
        free_canvas: {
          version: 1,
          projectId: 11,
          dramaId: 11,
          nodes: [{ type: 'image', assetId: 5 }],
        },
      },
    }),
    expectBadRequest('旧版 ZIP 自由画布包含无法验证的引用，缺少导入清单')
  );
});

test('remapImportedFreeCanvas 把节点引用映射到导入后的 ID 和路径，且不把剧集 ID 当成素材 ID', () => {
  const maps = createImportedFreeCanvasMaps(11);
  maps.episodes.set(1, 101);
  maps.storyboards.set(1, 202);
  maps.scenes.set(1, 303);
  maps.assets.set(1, 404);
  maps.paths.set('projects/11_demo/images/a.png', 'projects/99_imp/images/a.png');
  maps.importedAssets.set(404, { id: 404, drama_id: 99, local_path: 'projects/99_imp/images/a.png' });
  maps.sourceAssetPaths.set(1, 'projects/11_demo/images/a.png');

  const remapped = remapImportedFreeCanvas({
    version: 1,
    projectId: 11,
    dramaId: 11,
    episodeId: 1,
    nodes: [
      {
        id: 'n1',
        type: 'image',
        assetId: 1,
        episodeId: 1,
        storyboardId: 1,
        sceneId: 1,
        content: 'projects/11_demo/images/a.png',
        storageKey: 'projects/11_demo/images/a.png',
      },
    ],
    edges: [],
  }, maps, 99);

  assert.equal(remapped.projectId, 99);
  assert.equal(remapped.dramaId, 99);
  assert.equal(remapped.episodeId, 101);
  assert.equal(remapped.nodes[0].assetId, 404);
  assert.equal(remapped.nodes[0].episodeId, 101);
  assert.equal(remapped.nodes[0].storyboardId, 202);
  assert.equal(remapped.nodes[0].sceneId, 303);
  assert.equal(remapped.nodes[0].content, 'projects/99_imp/images/a.png');
  assert.equal(remapped.nodes[0].storageKey, 'projects/99_imp/images/a.png');

  assert.throws(
    () => remapImportedFreeCanvas({
      version: 1,
      projectId: 11,
      dramaId: 11,
      nodes: [{ type: 'image', assetId: 8, content: 'projects/11_demo/images/a.png' }],
    }, maps, 99),
    expectBadRequest('自由画布导入素材 ID无法映射到导入项目')
  );
  assert.throws(
    () => remapImportedFreeCanvas({
      version: 1,
      projectId: 22,
      dramaId: 22,
      nodes: [],
    }, maps, 99),
    expectBadRequest('自由画布导入源项目与画布项目引用不一致')
  );
});

test('remapImportedFreeCanvas 要求图像节点路径与素材本地路径一致', () => {
  const maps = createImportedFreeCanvasMaps(11);
  maps.assets.set(1, 404);
  maps.importedAssets.set(404, { id: 404, drama_id: 99, local_path: 'projects/99_imp/images/a.png' });
  maps.sourceAssetPaths.set(1, 'projects/11_demo/images/a.png');
  maps.paths.set('projects/11_demo/images/b.png', 'projects/99_imp/images/b.png');

  assert.throws(
    () => remapImportedFreeCanvas({
      version: 1,
      projectId: 11,
      dramaId: 11,
      nodes: [{
        type: 'image',
        assetId: 1,
        content: 'projects/11_demo/images/b.png',
      }],
    }, maps, 99),
    expectBadRequest('自由画布导入节点内容必须与素材本地路径一致')
  );
});
