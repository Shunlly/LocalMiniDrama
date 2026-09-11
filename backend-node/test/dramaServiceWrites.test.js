'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { resolveStylePreset } = require('../src/constants/generationStylePresets');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaService = require('../src/services/dramaService');
const dramaServiceWrites = require('../src/services/dramaServiceWrites');

const silentLog = { info() {}, warn() {}, error() {}, errorw() {} };

test('公开写接口仍从 dramaService 再导出，且写模块不回头依赖入口', () => {
  assert.equal(dramaService.createDrama, dramaServiceWrites.createDrama);
  assert.equal(dramaService.updateDrama, dramaServiceWrites.updateDrama);
  assert.equal(dramaService.saveOutline, dramaServiceWrites.saveOutline);
  assert.equal(dramaService.saveCharacters, dramaServiceWrites.saveCharacters);
  assert.equal(dramaService.saveEpisodes, dramaServiceWrites.saveEpisodes);
  assert.equal(dramaService.saveProgress, dramaServiceWrites.saveProgress);
  assert.equal(dramaService.saveCanvasLayout, dramaServiceWrites.saveCanvasLayout);

  const source = fs.readFileSync(
    path.join(__dirname, '../src/services/dramaServiceWrites.js'),
    'utf8'
  );
  assert.equal(source.includes("require('./dramaService')"), false);
  assert.equal(source.includes('FOREIGN KEY'), false);
  assert.equal(/REFERENCES\s+[A-Za-z_]/.test(source), false);
});

test('保存大纲会展开预设画风，显式画风文案不被覆盖，回收中项目拒绝写入', () => {
  const db = new Database(':memory:');
  try {
    runMigrationsAndEnsure(db);
    const active = dramaService.createDrama(db, silentLog, { title: '活动项目' });
    const other = dramaService.createDrama(db, silentLog, { title: '对照项目' });
    const recyclingId = 22;
    assert.notEqual(Number(active.id), Number(other.id));
    assert.notEqual(Number(active.id), recyclingId);
    assert.notEqual(Number(other.id), recyclingId);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO dramas (id, title, style, status, created_at, updated_at, trash_state, recycle_phase)
       VALUES (?, '回收中项目', 'documentary', 'draft', ?, ?, 'recycling', 'claimed')`
    ).run(recyclingId, now, now);

    const cinematic = resolveStylePreset('cinematic');
    assert.ok(cinematic);
    assert.equal(dramaService.saveOutline(db, silentLog, active.id, {
      title: '活动项目',
      style: 'cinematic',
    }), true);
    const outlined = dramaService.getDramaById(db, active.id);
    assert.equal(outlined.style, 'cinematic');
    assert.equal(outlined.metadata.style_prompt_zh, cinematic.zh);
    assert.equal(outlined.metadata.style_prompt_en, cinematic.en);

    assert.equal(dramaService.saveOutline(db, silentLog, active.id, {
      title: '活动项目',
      style: 'realistic',
      metadata: { style_prompt_zh: '自定义中文画风', style_prompt_en: 'custom style prompt' },
    }), true);
    const custom = dramaService.getDramaById(db, active.id);
    assert.equal(custom.style, 'realistic');
    assert.equal(custom.metadata.style_prompt_zh, '自定义中文画风');
    assert.equal(custom.metadata.style_prompt_en, 'custom style prompt');

    assert.equal(dramaService.saveProgress(db, silentLog, active.id, {
      current_step: 'characters',
      step_data: { note: '保留画风' },
    }), true);
    const progressed = dramaService.getDramaById(db, active.id);
    assert.equal(progressed.metadata.current_step, 'characters');
    assert.equal(progressed.metadata.style_prompt_zh, '自定义中文画风');

    assert.equal(dramaService.saveEpisodes(db, silentLog, other.id, {
      episodes: [{ episode_number: 1, title: '对照集', script_content: '对照剧本' }],
    }), true);
    const otherEpisode = db.prepare(
      'SELECT id, drama_id FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
    ).get(other.id);
    assert.ok(otherEpisode);
    assert.equal(Number(otherEpisode.drama_id), Number(other.id));
    assert.notEqual(Number(otherEpisode.drama_id), Number(active.id));
    assert.equal(dramaService.saveCharacters(db, silentLog, active.id, {
      episode_id: otherEpisode.id,
      characters: [{ name: '甲' }],
    }), false);

    assert.throws(
      () => dramaService.saveOutline(db, silentLog, recyclingId, { title: '回收中项目', style: 'noir' }),
      (error) => {
        assert.equal(error.code, 'DRAMA_RECYCLE_IN_PROGRESS');
        assert.match(error.message, /回收站/);
        return true;
      }
    );
    const recycling = db.prepare('SELECT title, style, metadata FROM dramas WHERE id = ?').get(recyclingId);
    assert.equal(recycling.title, '回收中项目');
    assert.equal(recycling.style, 'documentary');
    assert.equal(recycling.metadata, null);
  } finally {
    db.close();
  }
});
