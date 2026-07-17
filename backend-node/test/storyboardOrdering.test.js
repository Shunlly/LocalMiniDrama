const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const storyboardService = require('../src/services/storyboardService');

const log = { info() {}, warn() {}, error() {} };

function createOrderingDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER NOT NULL,
      storyboard_number INTEGER NOT NULL,
      deleted_at TEXT,
      updated_at TEXT
    );
  `);
  return db;
}

test('deleting an inserted storyboard compacts only its episode back to contiguous order', () => {
  const db = createOrderingDb();
  try {
    db.prepare(
      `INSERT INTO storyboards (id, episode_id, storyboard_number, updated_at)
       VALUES (?, ?, ?, 'before')`
    ).run(10, 1, 1);
    db.prepare(
      `INSERT INTO storyboards (id, episode_id, storyboard_number, updated_at)
       VALUES (?, ?, ?, 'before')`
    ).run(11, 1, 2);
    db.prepare(
      `INSERT INTO storyboards (id, episode_id, storyboard_number, updated_at)
       VALUES (?, ?, ?, 'before')`
    ).run(12, 1, 3);
    db.prepare(
      `INSERT INTO storyboards (id, episode_id, storyboard_number, updated_at)
       VALUES (?, ?, ?, 'before')`
    ).run(13, 1, 4);
    db.prepare(
      `INSERT INTO storyboards (id, episode_id, storyboard_number, updated_at)
       VALUES (?, ?, ?, 'before')`
    ).run(20, 2, 7);

    assert.equal(storyboardService.deleteStoryboard(db, log, 10), true);
    assert.deepEqual(
      db.prepare(
        `SELECT id, storyboard_number FROM storyboards
         WHERE episode_id = 1 AND deleted_at IS NULL
         ORDER BY storyboard_number ASC`
      ).all(),
      [
        { id: 11, storyboard_number: 1 },
        { id: 12, storyboard_number: 2 },
        { id: 13, storyboard_number: 3 },
      ]
    );
    assert.equal(db.prepare('SELECT storyboard_number FROM storyboards WHERE id = 20').get().storyboard_number, 7);
    assert.equal(storyboardService.deleteStoryboard(db, log, 999), false);
  } finally {
    db.close();
  }
});

test('order-integrity migration repairs historic gaps deterministically', () => {
  const db = createOrderingDb();
  try {
    const insert = db.prepare(
      `INSERT INTO storyboards (id, episode_id, storyboard_number, updated_at)
       VALUES (?, ?, ?, 'before')`
    );
    insert.run(3, 1, 8);
    insert.run(1, 1, 2);
    insert.run(2, 1, 4);
    insert.run(4, 2, 5);
    db.prepare('UPDATE storyboards SET deleted_at = ? WHERE id = 2').run('deleted');

    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '35_storyboard_order_integrity.sql'),
      'utf8'
    );
    db.exec(migration);

    assert.deepEqual(
      db.prepare(
        `SELECT id, episode_id, storyboard_number FROM storyboards
         WHERE deleted_at IS NULL ORDER BY episode_id ASC, storyboard_number ASC`
      ).all(),
      [
        { id: 1, episode_id: 1, storyboard_number: 1 },
        { id: 3, episode_id: 1, storyboard_number: 2 },
        { id: 4, episode_id: 2, storyboard_number: 1 },
      ]
    );
    assert.equal(db.prepare('SELECT storyboard_number FROM storyboards WHERE id = 2').get().storyboard_number, 4);
  } finally {
    db.close();
  }
});
