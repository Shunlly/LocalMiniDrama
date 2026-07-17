const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

function enableForeignKeys(database) {
  database.pragma('foreign_keys = ON');
  if (database.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('SQLite foreign key enforcement could not be enabled');
  }
}

function getDb(config) {
  if (db) return db;
  const dbPath = config.path;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const database = new Database(dbPath, {
    verbose: config.type === 'sqlite' && process.env.DEBUG ? console.log : undefined,
  });
  try {
    enableForeignKeys(database);
    database.pragma('journal_mode = WAL');
    database.pragma('busy_timeout = 5000');
  } catch (error) {
    database.close();
    throw error;
  }
  db = database;
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb, enableForeignKeys };
