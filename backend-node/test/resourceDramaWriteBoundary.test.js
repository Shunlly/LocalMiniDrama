const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaService = require('../src/services/dramaService');
const propService = require('../src/services/propService');
const sceneService = require('../src/services/sceneService');
const characterRoutes = require('../src/routes/characters');

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function createFixture() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  const insertDrama = db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at, deleted_at, trash_state, recycle_phase)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`
  );
  insertDrama.run(11, '可写项目', now, now, null, null, null);
  insertDrama.run(22, '回收中项目', now, now, null, 'recycling', 'claimed');
  insertDrama.run(33, '人工介入项目', now, now, null, 'recycling', 'manual_intervention');
  insertDrama.run(44, '历史回收项目', now, now, null, 'trash', null);
  insertDrama.run(55, '已删除项目', now, now, now, null, 'completed');
  insertDrama.run(66, '异常状态项目', now, now, null, null, 'manual_intervention');
  insertDrama.run(77, '另一个可写项目', now, now, null, null, null);
  insertDrama.run(88, '状态回收中项目', now, now, null, null, null);
  insertDrama.run(99, '状态人工介入项目', now, now, null, null, null);
  db.prepare('UPDATE dramas SET status = ? WHERE id = ?').run('recycling', 88);
  db.prepare('UPDATE dramas SET status = ? WHERE id = ?').run('manual_intervention', 99);

  const insertEpisode = db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`
  );
  insertEpisode.run(1101, 11, 1, '第一集', now, now);
  insertEpisode.run(7701, 77, 1, '另一个项目第一集', now, now);

  const insertProp = db.prepare(
    `INSERT INTO props (id, drama_id, episode_id, name, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`
  );
  insertProp.run(11001, 11, 1101, '可写道具', now, now);
  insertProp.run(22001, 22, null, '回收中道具', now, now);
  insertProp.run(33001, 33, null, '人工介入道具', now, now);
  insertProp.run(44001, 44, null, '历史回收道具', now, now);
  insertProp.run(55001, 55, null, '已删除道具', now, now);
  insertProp.run(66001, 66, null, '异常状态道具', now, now);
  insertProp.run(77001, 77, 7701, '另一个项目道具', now, now);

  const insertScene = db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, status, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL)`
  );
  insertScene.run(11002, 11, 1101, '可写场景', now, now);
  insertScene.run(22002, 22, null, '回收中场景', now, now);
  insertScene.run(33002, 33, null, '人工介入场景', now, now);
  insertScene.run(44002, 44, null, '历史回收场景', now, now);
  insertScene.run(55002, 55, null, '已删除场景', now, now);
  insertScene.run(66002, 66, null, '异常状态场景', now, now);
  insertScene.run(77002, 77, 7701, '另一个项目场景', now, now);

  const insertCharacter = db.prepare(
    `INSERT INTO characters (id, drama_id, name, appearance, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`
  );
  insertCharacter.run(11003, 11, '可写角色', '外貌', now, now);
  insertCharacter.run(22003, 22, '回收中角色', '外貌', now, now);
  insertCharacter.run(33003, 33, '人工介入角色', '外貌', now, now);
  insertCharacter.run(44003, 44, '历史回收角色', '外貌', now, now);
  insertCharacter.run(55003, 55, '已删除角色', '外貌', now, now);
  insertCharacter.run(66003, 66, '异常状态角色', '外貌', now, now);
  insertCharacter.run(88003, 88, '状态回收中角色', '外貌', now, now);
  insertCharacter.run(99003, 99, '状态人工介入角色', '外貌', now, now);

  db.prepare(
    `INSERT INTO storyboards (id, episode_id, title, created_at, updated_at, deleted_at)
     VALUES (9901, 1101, '可写分镜', ?, ?, NULL)`
  ).run(now, now);
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (9901, 11001)').run();
  return db;
}

function invoke(handler, req) {
  const result = { statusCode: null, body: null };
  const res = {
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  handler(req, res);
  return result;
}

async function invokeAsync(handler, req) {
  const result = { statusCode: null, body: null };
  const res = {
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  await handler(req, res);
  return result;
}

test('回收、人工介入、历史回收和已删除项目的子资源业务入口全部拒绝', () => {
  const db = createFixture();
  const handlers = characterRoutes(db, {}, log, {});

  for (const state of [
    { dramaId: 22, propId: 22001, sceneId: 22002, characterId: 22003, status: 409 },
    { dramaId: 33, propId: 33001, sceneId: 33002, characterId: 33003, status: 409 },
    { dramaId: 44, propId: 44001, sceneId: 44002, characterId: 44003, status: 404 },
    { dramaId: 55, propId: 55001, sceneId: 55002, characterId: 55003, status: 404 },
    { dramaId: 66, propId: 66001, sceneId: 66002, characterId: 66003, status: 409 },
    { dramaId: 88, propId: null, sceneId: null, characterId: 88003, status: 409 },
    { dramaId: 99, propId: null, sceneId: null, characterId: 99003, status: 409 },
  ]) {
    assert.deepEqual(propService.listByDramaId(db, state.dramaId), []);
    if (state.propId != null) {
      assert.equal(propService.getById(db, state.propId), null);
      assert.equal(propService.update(db, log, state.propId, { name: '越权修改' }), null);
      assert.equal(propService.deleteById(db, log, state.propId), false);
    }
    assert.deepEqual(sceneService.listByDramaId(db, state.dramaId), []);
    assert.equal(sceneService.getSceneById(db, state.sceneId), null);
    assert.deepEqual(sceneService.updateScene(db, log, state.sceneId, { location: '越权修改' }), {
      ok: false,
      error: 'scene not found',
    });
    assert.deepEqual(sceneService.deleteScene(db, log, state.sceneId), {
      ok: false,
      error: 'scene not found',
    });
    assert.throws(
      () => propService.create(db, log, { drama_id: state.dramaId, name: '越权新增' }),
      (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS' || error.code === 'DRAMA_NOT_FOUND'
    );
    assert.throws(
      () => sceneService.createScene(db, log, state.dramaId, { location: '越权新增' }),
      (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS' || error.code === 'DRAMA_NOT_FOUND'
    );

    const response = invoke(handlers.putImage, {
      params: { id: String(state.characterId) },
      body: { ref_image: 'attacker-controlled-reference' },
    });
    assert.equal(response.statusCode, state.status);
    assert.equal(
      db.prepare('SELECT ref_image FROM characters WHERE id = ?').get(state.characterId).ref_image,
      null
    );
  }
  db.close();
});

test('场景和道具创建校验真实父项目及 episode 归属，禁止跨项目引用', () => {
  const db = createFixture();

  assert.throws(
    () => sceneService.createScene(db, log, 11, { episode_id: 7701, location: '跨项目场景' }),
    (error) => error.code === 'CROSS_PROJECT_REFERENCE'
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM scenes WHERE location = ?').get('跨项目场景').count,
    0
  );
  assert.throws(
    () => propService.create(db, log, { drama_id: 11, episode_id: 7701, name: '跨项目道具' }),
    (error) => error.code === 'CROSS_PROJECT_REFERENCE'
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM props WHERE name = ?').get('跨项目道具').count,
    0
  );

  const scene = sceneService.createScene(db, log, 11, { episode_id: 1101, location: '同项目场景' });
  assert.equal(scene.drama_id, 11);
  assert.equal(
    db.prepare('SELECT episode_id FROM scenes WHERE id = ?').get(scene.id).episode_id,
    1101
  );
  const prop = propService.create(db, log, { drama_id: 11, episode_id: 1101, name: '同项目道具' });
  assert.equal(prop.drama_id, 11);
  assert.equal(prop.name, '同项目道具');
  db.close();
});

test('场景空更新保持原有成功语义，同时仍校验资源所属项目可写', () => {
  const db = createFixture();

  assert.deepEqual(sceneService.updateScene(db, log, 11002, {}), { ok: true });
  assert.deepEqual(sceneService.updateScene(db, log, 22002, {}), {
    ok: false,
    error: 'scene not found',
  });

  db.close();
});

test('道具关联分镜校验分镜和道具的真实项目，跨项目失败且不破坏原关联', () => {
  const db = createFixture();
  assert.throws(
    () => propService.associateWithStoryboard(db, log, 9901, [77001]),
    (error) => error.code === 'CROSS_PROJECT_REFERENCE'
  );
  assert.deepEqual(
    db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = 9901').all(),
    [{ prop_id: 11001 }]
  );
  assert.equal(propService.associateWithStoryboard(db, log, 9901, []), true);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM storyboard_props WHERE storyboard_id = 9901').get().count,
    0
  );
  db.close();
});

test('活动项目角色额外字段更新可用，专用回收站列表仍可读取历史项目', () => {
  const db = createFixture();
  const handlers = characterRoutes(db, {}, log, {});
  const response = invoke(handlers.putImage, {
    params: { id: '11003' },
    body: { ref_image: 'active-reference' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(db.prepare('SELECT ref_image FROM characters WHERE id = 11003').get().ref_image, 'active-reference');

  const trash = dramaService.listTrashedDramas(db, { page: 1, page_size: 20 });
  assert.ok(trash.dramas.some((drama) => Number(drama.id) === 55));
  db.close();
});

test('回收项目角色的生成、上传和素材库入口在真实 handler 层 fail closed', async () => {
  const db = createFixture();
  const uploadCalls = [];
  const handlers = characterRoutes(db, {}, log, {
    uploadFile() {
      uploadCalls.push('uploadFile');
      throw new Error('不应调用上传器');
    },
    removeFile() {
      uploadCalls.push('removeFile');
    },
  });
  const characterService = require('../src/services/characterLibraryService');
  const methodNames = [
    'generateCharacterFourViewImage',
    'uploadCharacterImage',
    'applyLibraryItemToCharacter',
    'addCharacterToLibrary',
    'addCharacterToMaterialLibrary',
  ];
  const originalMethods = Object.fromEntries(methodNames.map((name) => [name, characterService[name]]));
  const calls = [];
  for (const name of methodNames) {
    characterService[name] = () => {
      calls.push(name);
      return { ok: true };
    };
  }

  try {
    const generate = await invokeAsync(handlers.generateImage, {
      params: { id: '22003' },
      body: {},
    });
    assert.equal(generate.statusCode, 409);

    const upload = invoke(handlers.uploadImage, {
      params: { id: '22003' },
      file: { buffer: Buffer.from('image'), originalname: 'image.png', mimetype: 'image/png' },
    });
    assert.equal(upload.statusCode, 409);

    const imageFromLibrary = invoke(handlers.imageFromLibrary, {
      params: { id: '22003' },
      body: { library_id: 1 },
    });
    assert.equal(imageFromLibrary.statusCode, 409);

    const addToLibrary = invoke(handlers.addToLibrary, {
      params: { id: '22003' },
      body: {},
    });
    assert.equal(addToLibrary.statusCode, 409);

    const addToMaterialLibrary = invoke(handlers.addToMaterialLibrary, {
      params: { id: '22003' },
      body: {},
    });
    assert.equal(addToMaterialLibrary.statusCode, 409);

    assert.deepEqual(calls, []);
    assert.deepEqual(uploadCalls, []);
    assert.equal(db.prepare('SELECT image_url, ref_image FROM characters WHERE id = 22003').get().image_url, null);
    assert.equal(db.prepare('SELECT image_url, ref_image FROM characters WHERE id = 22003').get().ref_image, null);
  } finally {
    for (const name of methodNames) characterService[name] = originalMethods[name];
    db.close();
  }
});
