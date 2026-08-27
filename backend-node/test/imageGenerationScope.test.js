'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const imageRoutes = require('../src/routes/images');

const TEST_DRAMA_ID = 2;
const TEST_EPISODE_ID = 20;
const TEST_STORYBOARD_ID = 200;

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER,
      drama_id INTEGER,
      idempotency_key TEXT,
      provider TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      model TEXT,
      image_url TEXT,
      local_path TEXT,
      frame_type TEXT,
      scene_id INTEGER,
      character_id INTEGER,
      reference_images TEXT,
      use_first_frame_layout_lock INTEGER,
      size TEXT,
      task_id TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER,
      message TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX idx_image_generations_idempotency_key
      ON image_generations(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    INSERT INTO episodes (id, drama_id) VALUES (${TEST_EPISODE_ID}, ${TEST_DRAMA_ID});
    INSERT INTO storyboards (id, episode_id) VALUES (${TEST_STORYBOARD_ID}, ${TEST_EPISODE_ID});
    INSERT INTO storyboards (id, episode_id) VALUES (201, ${TEST_EPISODE_ID});
  `);
  return db;
}

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('image generation rejects a storyboard owned by another drama before creating a task', () => {
  const db = createDb();
  try {
    const res = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: { drama_id: 1, storyboard_id: 200, prompt: 'test' },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /storyboard_id.*drama_id/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 0);
  } finally {
    db.close();
  }
});

test('image generation does not reuse an idempotency key across project scope', () => {
  const db = createDb();
  db.prepare(
    'INSERT INTO image_generations (storyboard_id, drama_id, idempotency_key) VALUES (200, 2, ?)'
  ).run('shared-key');
  try {
    const res = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: { drama_id: 1, idempotency_key: 'shared-key', prompt: 'test' },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /idempotency_key.*drama/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
  } finally {
    db.close();
  }
});

test('image upload rejects a storyboard owned by another drama before inserting', () => {
  const db = createDb();
  try {
    const res = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).upload({
      body: {
        drama_id: 1,
        storyboard_id: 200,
        image_url: 'https://example.test/upload.png',
      },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /storyboard_id.*drama_id/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 0);
  } finally {
    db.close();
  }
});

test('image generation does not reuse a scoped idempotency record when scope is omitted', () => {
  const db = createDb();
  db.prepare(
    'INSERT INTO image_generations (storyboard_id, drama_id, idempotency_key) VALUES (200, 2, ?)'
  ).run('unscoped-key');
  try {
    const res = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: { idempotency_key: 'unscoped-key', prompt: 'test' },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /idempotency_key.*drama|idempotency_key.*storyboard/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 1);
  } finally {
    db.close();
  }
});

test('image generation does not reuse an idempotency key for another storyboard in the same drama', () => {
  const db = createDb();
  db.prepare(
    'INSERT INTO image_generations (storyboard_id, drama_id, idempotency_key) VALUES (200, 2, ?)'
  ).run('storyboard-key');
  try {
    const res = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: {
        drama_id: 2,
        storyboard_id: 201,
        idempotency_key: 'storyboard-key',
        prompt: 'test',
      },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /idempotency_key.*storyboard/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 1);
  } finally {
    db.close();
  }
});

test('image generation reuses an idempotency key for the same normalized scope', () => {
  const db = createDb();
  db.prepare(
    'INSERT INTO image_generations (storyboard_id, drama_id, idempotency_key) VALUES (?, ?, ?)'
  ).run(TEST_STORYBOARD_ID, TEST_DRAMA_ID, 'same-scope-key');
  try {
    const res = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: {
        drama_id: TEST_DRAMA_ID,
        storyboard_id: TEST_STORYBOARD_ID,
        idempotency_key: 'same-scope-key',
        prompt: 'test',
      },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.idempotent_reuse, true);
    assert.equal(res.body.data.drama_id, TEST_DRAMA_ID);
    assert.equal(res.body.data.storyboard_id, TEST_STORYBOARD_ID);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 1);
  } finally {
    db.close();
  }
});

test('image generation rejects a soft-deleted idempotency key before creating a task', () => {
  const db = createDb();
  db.prepare(
    `INSERT INTO image_generations (storyboard_id, drama_id, idempotency_key, deleted_at)
     VALUES (200, 2, ?, ?)`
  ).run('deleted-key', new Date().toISOString());
  try {
    const res = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: {
        drama_id: 2,
        storyboard_id: 200,
        idempotency_key: 'deleted-key',
        prompt: 'test',
      },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /idempotency_key.*deleted/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 1);
  } finally {
    db.close();
  }
});

for (const probe of [
  { name: 'another drama', body: { drama_id: 1 } },
  { name: 'another storyboard in the same drama', body: { drama_id: 2, storyboard_id: 201 } },
  { name: 'no scope', body: {} },
]) {
  test(`image generation hides a deleted idempotency key from ${probe.name}`, () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO image_generations (storyboard_id, drama_id, idempotency_key, deleted_at)
       VALUES (200, 2, 'deleted-cross-scope-key', ?)`
    ).run(new Date().toISOString());
    try {
      const res = responseRecorder();
      imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
        body: { ...probe.body, idempotency_key: 'deleted-cross-scope-key', prompt: 'test' },
      }, res);

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
      assert.match(res.body.error.message, /idempotency_key.*another drama or storyboard/i);
      assert.doesNotMatch(res.body.error.message, /deleted/i);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 1);
    } finally {
      db.close();
    }
  });
}

test('image generation safely backfills a legacy zero drama scope before reuse', () => {
  const db = createDb();
  db.prepare(
    'INSERT INTO image_generations (storyboard_id, drama_id, idempotency_key) VALUES (?, 0, ?)'
  ).run(TEST_STORYBOARD_ID, 'legacy-scope-key');
  try {
    const res = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: {
        storyboard_id: TEST_STORYBOARD_ID,
        idempotency_key: 'legacy-scope-key',
        prompt: 'test',
      },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.idempotent_reuse, true);
    assert.equal(res.body.data.drama_id, TEST_DRAMA_ID);
    assert.equal(res.body.data.storyboard_id, TEST_STORYBOARD_ID);
    assert.equal(
      db.prepare('SELECT drama_id FROM image_generations WHERE idempotency_key = ?').get('legacy-scope-key').drama_id,
      TEST_DRAMA_ID
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
  } finally {
    db.close();
  }
});

test('fresh global image generation remains valid without a storyboard', () => {
  const db = createDb();
  try {
    const res = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: {
        drama_id: 0,
        idempotency_key: 'fresh-global-key',
        prompt: 'global image',
        __defer_processing: true,
      },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.drama_id, 0);
    assert.equal(res.body.data.storyboard_id, null);
    assert.deepEqual(
      db.prepare('SELECT drama_id, storyboard_id FROM image_generations WHERE idempotency_key = ?').get('fresh-global-key'),
      { drama_id: 0, storyboard_id: null }
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 1);
  } finally {
    db.close();
  }
});

test('a global idempotency key only reuses the exact normalized global tuple', () => {
  const db = createDb();
  db.prepare(
    'INSERT INTO image_generations (storyboard_id, drama_id, idempotency_key) VALUES (NULL, 0, ?)'
  ).run('exact-global-key');
  try {
    const globalRes = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: { idempotency_key: 'exact-global-key', prompt: 'global reuse' },
    }, globalRes);
    assert.equal(globalRes.statusCode, 201);
    assert.equal(globalRes.body.data.idempotent_reuse, true);
    assert.equal(globalRes.body.data.drama_id, 0);
    assert.equal(globalRes.body.data.storyboard_id, null);

    const projectRes = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: { drama_id: 2, idempotency_key: 'exact-global-key', prompt: 'project probe' },
    }, projectRes);
    assert.equal(projectRes.statusCode, 400);
    assert.match(projectRes.body.error.message, /another drama or storyboard/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 1);
  } finally {
    db.close();
  }
});

for (const invalidDramaId of [-7, 1.5, 'not-a-number', true]) {
  test(`image generation rejects invalid drama_id ${JSON.stringify(invalidDramaId)}`, () => {
    const db = createDb();
    try {
      const res = responseRecorder();
      imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
        body: {
          drama_id: invalidDramaId,
          idempotency_key: `invalid-drama-${String(invalidDramaId)}`,
          prompt: 'invalid scope',
          __defer_processing: true,
        },
      }, res);

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
      assert.match(res.body.error.message, /drama_id.*invalid/i);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 0);
    } finally {
      db.close();
    }
  });
}

for (const invalidDramaId of [[], {}, false]) {
  const label = Array.isArray(invalidDramaId) ? 'array' : typeof invalidDramaId;
  test(`image generation rejects ${label} drama_id input`, () => {
    const db = createDb();
    try {
      const res = responseRecorder();
      imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
        body: {
          drama_id: invalidDramaId,
          idempotency_key: `invalid-drama-type-${label}`,
          prompt: 'invalid scope type',
          __defer_processing: true,
        },
      }, res);

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
      assert.match(res.body.error.message, /drama_id.*invalid/i);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 0);
    } finally {
      db.close();
    }
  });
}

for (const allowedGlobal of [
  { name: 'omitted', body: {} },
  { name: 'null', body: { drama_id: null } },
  { name: 'empty string', body: { drama_id: '' } },
  { name: 'whitespace string', body: { drama_id: '   ' } },
]) {
  test(`image generation accepts ${allowedGlobal.name} as explicit global scope`, () => {
    const db = createDb();
    try {
      const res = responseRecorder();
      imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
        body: {
          ...allowedGlobal.body,
          idempotency_key: `allowed-global-${allowedGlobal.name}`,
          prompt: 'global scope',
          __defer_processing: true,
        },
      }, res);

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.drama_id, 0);
      assert.equal(res.body.data.storyboard_id, null);
    } finally {
      db.close();
    }
  });
}

for (const invalidStoryboardId of [-7, 1.5, 'not-a-number', true]) {
  test(`image generation rejects invalid storyboard_id ${JSON.stringify(invalidStoryboardId)}`, () => {
    const db = createDb();
    try {
      const res = responseRecorder();
      imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
        body: {
          drama_id: 2,
          storyboard_id: invalidStoryboardId,
          idempotency_key: `invalid-storyboard-${String(invalidStoryboardId)}`,
          prompt: 'invalid scope',
          __defer_processing: true,
        },
      }, res);

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
      assert.match(res.body.error.message, /storyboard_id.*invalid/i);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 0);
    } finally {
      db.close();
    }
  });
}

test('fresh positive-integer project image scope remains valid without a storyboard', () => {
  const db = createDb();
  try {
    const res = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).create({
      body: {
        drama_id: TEST_DRAMA_ID,
        idempotency_key: 'fresh-project-key',
        prompt: 'project image',
        __defer_processing: true,
      },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.drama_id, TEST_DRAMA_ID);
    assert.equal(res.body.data.storyboard_id, null);

    const readRes = responseRecorder();
    imageRoutes(db, {}, { error() {}, info() {}, warn() {} }).get({
      params: { id: res.body.data.id },
    }, readRes);
    assert.equal(readRes.statusCode, 404);
  } finally {
    db.close();
  }
});
