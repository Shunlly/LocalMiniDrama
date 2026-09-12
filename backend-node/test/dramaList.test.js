const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const dramaService = require('../src/services/dramaService');
const dramaRoutes = require('../src/routes/drama');

const log = {
  info() {},
  error() {},
  errorw() {},
};

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      genre TEXT,
      style TEXT,
      tags TEXT,
      thumbnail TEXT,
      total_episodes INTEGER DEFAULT 1,
      total_duration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      metadata TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      episode_number INTEGER DEFAULT 1,
      title TEXT,
      script_content TEXT,
      description TEXT,
      duration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      video_url TEXT,
      thumbnail TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      image_url TEXT,
      local_path TEXT,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      image_url TEXT,
      local_path TEXT,
      deleted_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      image_url TEXT,
      local_path TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

test('drama list searches across project metadata and applies a safe deterministic sort', () => {
  const db = createDb();
  const insert = db.prepare(`
    INSERT INTO dramas
      (id, title, description, genre, style, tags, metadata, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(1, 'Beta', '城市故事', 'drama', 'realistic', 'urban', '{}', 'draft', '2026-07-01', '2026-07-03');
  insert.run(2, 'Alpha', '星际远征', 'sci-fi', 'cinematic', 'space', '{"aspect_ratio":"16:9"}', 'published', '2026-07-02', '2026-07-02');
  insert.run(3, 'Gamma', '另一部', 'drama', 'realistic', '星际,未来', '{}', 'draft', '2026-07-03', '2026-07-01');

  const searched = dramaService.listDramas(db, {
    page: 1,
    page_size: 10,
    keyword: '星际',
    sort: 'title-asc',
  });
  assert.equal(searched.total, 2);
  assert.deepEqual(searched.dramas.map((item) => item.id), [2, 3]);

  const page = dramaService.listDramas(db, {
    page: 1,
    page_size: 1,
    sort: 'created-desc',
  });
  assert.equal(page.total, 3);
  assert.equal(page.pageSize, 1);
  assert.equal(page.dramas[0].id, 3);
  db.close();
});

test('drama list search matches the localized style and genre labels shown by the frontend', () => {
  const db = createDb();
  const insert = db.prepare(`
    INSERT INTO dramas
      (id, title, description, genre, style, tags, metadata, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(1, 'Project One', '', 'drama', 'realistic', '', '{}', 'draft', '2026-07-01', '2026-07-01');
  insert.run(2, 'Project Two', '', 'comedy', 'cinematic', '', '{}', 'draft', '2026-07-02', '2026-07-02');

  assert.deepEqual(
    dramaService.listDramas(db, { keyword: '写实' }).dramas.map((item) => item.id),
    [1],
  );
  assert.deepEqual(
    dramaService.listDramas(db, { keyword: '喜剧' }).dramas.map((item) => item.id),
    [2],
  );
  db.close();
});

test('drama list accepts omitted options and ignores whitespace-only keywords', () => {
  const db = createDb();
  db.prepare(`INSERT INTO dramas (id, title, created_at, updated_at) VALUES (1, 'Default query', '2026-07-01', '2026-07-01')`).run();

  const withoutOptions = dramaService.listDramas(db);
  const withBlankKeyword = dramaService.listDramas(db, { keyword: '  \n\t  ' });

  assert.equal(withoutOptions.total, 1);
  assert.equal(withBlankKeyword.total, 1);
  assert.deepEqual(withBlankKeyword.dramas.map((item) => item.id), [1]);
  db.close();
});

test('drama list ignores unknown sort values instead of interpolating them into SQL', () => {
  const db = createDb();
  db.prepare(`INSERT INTO dramas (id, title, created_at, updated_at) VALUES (1, 'Safe', '2026-07-01', '2026-07-01')`).run();
  const result = dramaService.listDramas(db, { page: 1, page_size: 10, sort: 'title; DROP TABLE dramas' });
  assert.equal(result.total, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM dramas').get().count, 1);
  db.close();
});

test('drama list exposes one usable asset cover candidate without loading full asset collections', () => {
  const db = createDb();
  db.prepare(`INSERT INTO dramas (id, title, created_at, updated_at) VALUES (1, 'Cover', '2026-07-01', '2026-07-01')`).run();
  db.prepare(`INSERT INTO characters (id, drama_id, image_url, local_path) VALUES (1, 1, 'placeholder://character', NULL)`).run();
  db.prepare(`INSERT INTO scenes (id, drama_id, image_url, local_path) VALUES (2, 1, NULL, 'dramas/1/scenes/2.webp')`).run();
  db.prepare(`INSERT INTO props (id, drama_id, image_url, local_path) VALUES (3, 1, 'https://cdn.example.test/prop.webp', NULL)`).run();

  const result = dramaService.listDramas(db, { page: 1, page_size: 10 });
  assert.equal(result.dramas[0].fallback_cover_local_path, 'dramas/1/scenes/2.webp');
  assert.equal(result.dramas[0].fallback_cover_image_url, null);
  assert.equal(result.dramas[0].fallback_cover_source, 'scene');
  assert.equal(result.dramas[0].characters, undefined);
  db.close();
});

test('drama list route forwards pagination, search, status, and sort parameters', () => {
  const db = createDb();
  const insert = db.prepare(`
    INSERT INTO dramas (id, title, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insert.run(1, 'Zulu', 'keep', 'draft', '2026-07-01', '2026-07-01');
  insert.run(2, 'Alpha', 'keep', 'draft', '2026-07-02', '2026-07-02');
  insert.run(3, 'Hidden', 'skip', 'published', '2026-07-03', '2026-07-03');

  const response = {
    body: null,
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const handler = dramaRoutes(db, {}, log).listDramas;
  handler({
    query: {
      page: '1',
      page_size: '1',
      keyword: 'keep',
      status: 'draft',
      sort: 'title-asc',
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.pagination.total, 2);
  assert.equal(response.body.data.pagination.page_size, 1);
  assert.equal(response.body.data.items[0].title, 'Alpha');
  db.close();
});
