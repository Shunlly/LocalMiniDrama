const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaImportService = require('../src/services/dramaImportService');
const skillRegistryService = require('../src/services/skillRegistryService');
const dramaRoutes = require('../src/routes/drama');
const { runImportImageValidatorCli } = require('../src/services/importImageValidator');

const exportSrc = [
  'dramaExportService.js',
  'dramaExportCollect.js',
  'dramaExportArchive.js',
  'dramaExportCollection.js',
  'dramaExportErrors.js',
].map((name) => fs.readFileSync(path.join(__dirname, '../src/services', name), 'utf8')).join('\n');
const importSrc = [
  'dramaImportService.js',
  'dramaImportValidation.js',
  'dramaImportMediaValidation.js',
  'dramaImportManifest.js',
  'dramaImportFreeCanvasManifest.js',
  'dramaImportFreeCanvasManifestFields.js',
  'dramaImportZip.js',
  'dramaImportRestore.js',
  'dramaImportParse.js',
  'dramaImportMedia.js',
  'dramaImportApply.js',
  'dramaImportCanvas.js',
].map((name) => fs.readFileSync(path.join(__dirname, '../src/services', name), 'utf8')).join('\n');
const validatorSrc = fs.readFileSync(path.join(__dirname, '../src/services/importImageValidator.js'), 'utf8');
const skillSrc = fs.readFileSync(path.join(__dirname, '../src/services/skillRegistryService.js'), 'utf8');

const leftover = [
  'Project export encountered an invalid file size.',
  'Project export could not materialize a file.',
  'Project export source changed while being read.',
  'Project export rejected unsafe source metadata.',
  'Project export rejected an unsafe source original.',
  'A project export file exceeds the configured size limit.',
  'unsafe source',
  'mismatched title',
  'unsafe URL',
  'size mismatch',
  'project.json field',
  'Project import ',
  'Source Intake manifest',
  'Source Intake original',
  'Imported source',
  'must be an array.',
  'must be an object.',
  'exceeds the configured limit.',
  'exceeds the safe integer range.',
  'image pixel limit exceeded',
  'Sharp could not decode image metadata',
  'Unknown or templated skill not found',
  'Skill is disabled or missing',
  'Electron image validation requires an application entry',
  'media validation failed',
  'ffprobe is unavailable',
];

const silentLog = { info() {}, warn() {}, error() {}, errorw() {} };

function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function mockResponse() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
    },
  };
}

function makeArchive(project) {
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(project)));
  return zip.toBuffer();
}

test('project import/export keep leftover English errors out of user-facing messages', () => {
  for (const phrase of leftover) {
    assert.equal(exportSrc.includes(phrase), false, phrase);
    assert.equal(importSrc.includes(phrase), false, phrase);
    assert.equal(validatorSrc.includes(phrase), false, phrase);
    assert.equal(skillSrc.includes(phrase), false, phrase);
  }
  assert.match(exportSrc, /项目导出拒绝了不安全的素材元数据/);
  assert.match(exportSrc, /项目导出读取时源文件发生变化，请重试/);
  assert.match(exportSrc, /导入素材/);
  assert.match(importSrc, /项目包大小与清单不一致/);
  assert.match(importSrc, /素材 URL 不安全/);
  assert.match(importSrc, /素材导入清单必须是对象/);
  assert.match(importSrc, /项目清单中的/);
  assert.match(validatorSrc, /图片像素数量超过上限/);
  assert.match(skillSrc, /找不到技能或技能模板/);
});

test('项目导入结构错误返回可操作简体中文', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-import-zh-'));
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  try {
    assert.throws(
      () => dramaImportService.importDrama(
        db,
        { storage: { local_path: storageRoot } },
        silentLog,
        makeArchive({
          version: '1.6',
          drama: { title: '坏结构', status: 'draft', metadata: {} },
          characters: 'not-an-array',
          episodes: [],
          scenes: [],
          props: [],
        })
      ),
      (error) => error?.name === 'DramaImportError'
        && error.code === 'INVALID_IMPORT_STRUCTURE'
        && hasCjk(error.message)
        && /项目清单/.test(error.message)
        && /必须是数组/.test(error.message)
        && !/must be an array/i.test(error.message)
    );
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('导入 HTTP 接口不会把英文结构错误回给前端', () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-import-http-zh-'));
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  try {
    const res = mockResponse();
    dramaRoutes(db, { storage: { local_path: storageRoot } }, silentLog).importDrama(
      {
        file: {
          buffer: makeArchive({
            version: '1.6',
            drama: { title: '坏清单', status: 'draft', metadata: {} },
            characters: [],
            episodes: [],
            scenes: [],
            props: [],
            source_intake: [],
          }),
        },
      },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'INVALID_SOURCE_MANIFEST');
    assert.equal(hasCjk(res.body.error.message), true);
    assert.match(res.body.error.message, /素材导入清单/);
    assert.doesNotMatch(res.body.error.message, /Source Intake|must be an object/i);
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('技能注册用户错误使用简体中文', (t) => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => db.close());
  assert.throws(
    () => skillRegistryService.loadSkillRuntime(db, 'not-a-real-skill'),
    (error) => error.code === 'SKILL_NOT_FOUND'
      && hasCjk(error.message)
      && /找不到技能/.test(error.message)
      && !/Unknown or templated/i.test(error.message)
  );
});

test('图片校验 CLI 失败原因使用简体中文', async () => {
  let output = '';
  const stdout = {
    write(value, callback) {
      output += String(value);
      callback();
    },
  };
  const exitCode = await runImportImageValidatorCli(['only-one-arg'], stdout);
  assert.equal(exitCode, 1);
  const payload = JSON.parse(output);
  assert.equal(hasCjk(payload.reason), true);
  assert.match(payload.reason, /图片校验/);
  assert.doesNotMatch(payload.reason, /requires project root/i);
});
