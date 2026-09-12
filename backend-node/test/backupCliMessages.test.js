const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BACKUP_PUBLIC_MESSAGES = require('../src/services/backupPublicMessages');
const { DataBackupError } = require('../src/services/dataBackupService');
const { formatBackupCliError } = require('../src/services/backupSettingsService');

const HAN_RE = /[\u4e00-\u9fff]/;
const CLAIM_OR_LEASE_RE = /\b(?:claim(?:ed|s|ing)?|leases?)\b/i;
const SCRIPT_ROOT = path.join(__dirname, '..', 'scripts');
const SERVICE_ROOT = path.join(__dirname, '..', 'src', 'services');

function readScript(name) {
  return fs.readFileSync(path.join(SCRIPT_ROOT, name), 'utf8');
}

function messageOf(formatted) {
  const separator = '] ';
  const index = String(formatted).indexOf(separator);
  return index >= 0 ? formatted.slice(index + separator.length) : String(formatted);
}

function collectBackupErrorCodes(source) {
  const codes = new Set();
  for (const match of source.matchAll(/backupError\(\s*'([A-Z0-9_]+)'/g)) {
    codes.add(match[1]);
  }
  return codes;
}

test('备份 CLI 三码已入中文码表，英文 publicMessage 不会打给用户', () => {
  const expected = {
    MACHINE_RESULT_TOO_LARGE: '备份发布结果超过机器通道限制。',
    MACHINE_RESULT_WRITE_FAILED: '无法写入备份发布结果。',
    PUBLICATION_TIMEOUT: '备份发布路径未在截止时间前完成提交。',
  };
  for (const [code, message] of Object.entries(expected)) {
    assert.equal(BACKUP_PUBLIC_MESSAGES[code], message);
    assert.match(message, HAN_RE);
    const english = new DataBackupError(code, 'The backup publication result exceeded its machine-channel bound.');
    const formatted = formatBackupCliError(english);
    assert.equal(formatted, `[${code}] ${message}`);
    assert.doesNotMatch(formatted, /exceeded|written|deadline|publication result/i);
  }
});

test('备份错误码表覆盖抛出码，文案为简体中文且不含 claim/lease', () => {
  const backupModules = fs.readdirSync(SERVICE_ROOT)
    .filter((name) => name.startsWith('dataBackup') && name.endsWith('.js'))
    .sort();
  const sources = {
    ...Object.fromEntries(backupModules.map((name) => [name, fs.readFileSync(path.join(SERVICE_ROOT, name), 'utf8')])),
    'backupSettingsService.js': fs.readFileSync(path.join(SERVICE_ROOT, 'backupSettingsService.js'), 'utf8'),
    'backup-data.js': readScript('backup-data.js'),
    'restore-data.js': readScript('restore-data.js'),
    'recover-maintenance.js': readScript('recover-maintenance.js'),
  };
  const thrownCodes = new Set();
  for (const source of Object.values(sources)) {
    for (const code of collectBackupErrorCodes(source)) thrownCodes.add(code);
  }
  assert.ok(Object.keys(BACKUP_PUBLIC_MESSAGES).length >= 80);
  assert.ok(thrownCodes.size >= 70, `抛出码过少：${thrownCodes.size}`);
  for (const code of thrownCodes) {
    const mapped = BACKUP_PUBLIC_MESSAGES[code];
    assert.equal(typeof mapped, 'string', `${code} 缺少中文映射`);
    assert.match(mapped, HAN_RE, `${code} 映射不是简体中文`);
    assert.doesNotMatch(mapped, CLAIM_OR_LEASE_RE, `${code} 映射含英文 claim/lease`);
  }
  for (const [code, message] of Object.entries(BACKUP_PUBLIC_MESSAGES)) {
    assert.match(message, HAN_RE, `${code} 映射不是简体中文`);
    assert.doesNotMatch(message, CLAIM_OR_LEASE_RE, `${code} 映射含英文 claim/lease`);
    assert.doesNotMatch(message, /[A-Za-z]{8,}/, `${code} 映射含英文长词`);
  }
});

test('formatBackupCliError 优先可信中文 publicMessage，缺参打缺少参数值', () => {
  const specific = new DataBackupError('INVALID_ARGUMENT', '--output 缺少参数值。');
  assert.equal(formatBackupCliError(specific), '[INVALID_ARGUMENT] --output 缺少参数值。');
  assert.match(formatBackupCliError(specific), /缺少参数值/);
  assert.doesNotMatch(formatBackupCliError(specific), /备份参数不完整/);

  const restoreSpecific = new DataBackupError('INVALID_ARGUMENT', '--input 缺少参数值。');
  assert.equal(formatBackupCliError(restoreSpecific), '[INVALID_ARGUMENT] --input 缺少参数值。');

  const english = new DataBackupError('INVALID_ARGUMENT', 'The flag requires a value.');
  assert.equal(formatBackupCliError(english), `[INVALID_ARGUMENT] ${BACKUP_PUBLIC_MESSAGES.INVALID_ARGUMENT}`);
  assert.doesNotMatch(formatBackupCliError(english), /requires a value/i);
});

test('英文 claim/lease 原文不会打给用户，混合中文也不例外', () => {
  const cases = [
    ['PATH_CLAIM_RESTORE_FAILED', 'The private claim is not a directory.'],
    ['PATH_CLAIM_RESTORE_FAILED', 'The private claim directory identity changed.'],
    ['PATH_CLAIM_RESTORE_FAILED', 'A claimed replacement could not be restored safely.'],
    ['OUTPUT_CLEANUP_FAILED', 'The failed backup output could not be claimed without touching a replacement.'],
    ['OUTPUT_CLEANUP_FAILED', 'The claimed failed backup output could not be removed.'],
    ['MAINTENANCE_LOCK_RELEASE_FAILED', 'The claimed maintenance recovery lease could not be removed.'],
    ['MAINTENANCE_LOCK_RELEASE_FAILED', 'The claimed service maintenance lock could not be removed.'],
    ['MAINTENANCE_LEASE_INVALID', 'The external maintenance lease could not be read consistently.'],
    ['MAINTENANCE_LEASE_INVALID', 'The external maintenance lease changed while it was read.'],
    ['MAINTENANCE_LEASE_INVALID', 'The external maintenance lease changed before it was read.'],
  ];
  for (const [code, english] of cases) {
    const formatted = formatBackupCliError(new DataBackupError(code, english));
    assert.equal(formatted, `[${code}] ${BACKUP_PUBLIC_MESSAGES[code]}`);
    assert.doesNotMatch(messageOf(formatted), CLAIM_OR_LEASE_RE);

    const mixed = formatBackupCliError(new DataBackupError(code, `维护失败：${english}`));
    assert.equal(mixed, `[${code}] ${BACKUP_PUBLIC_MESSAGES[code]}`);
    assert.doesNotMatch(messageOf(mixed), CLAIM_OR_LEASE_RE);
    assert.doesNotMatch(messageOf(mixed), /维护失败/);
  }

  const unknown = formatBackupCliError(new DataBackupError('WEIRD_CODE', 'The private claim is not a directory.'));
  assert.equal(unknown, `[WEIRD_CODE] ${BACKUP_PUBLIC_MESSAGES.BACKUP_FAILED}`);
  assert.doesNotMatch(messageOf(unknown), CLAIM_OR_LEASE_RE);
});

test('备份 CLI 源码不再包含已列出的英文构造函数', () => {
  const leftoverEnglish = [
    'requires a value.',
    'Duplicate backup options are not allowed.',
    'Unknown backup option.',
    'Unknown restore option.',
    'Unknown maintenance recovery option.',
    'The publication timeout must be a canonical integer.',
    'The publication timeout is outside the supported range.',
    'The backup publication result exceeded its machine-channel bound.',
    'The backup publication result could not be written.',
    'The backup publication path is not a regular file.',
    'The backup publication path was not committed before the deadline.',
    'Help output is unavailable on the descriptor publication channel.',
    'Descriptor publication requires an operation id and publication path, without --output.',
    'Descriptor publication options require --descriptor-publication.',
    'Descriptor publication requires an absolute data.zip path.',
    'Restore requires --input <archive.zip>.',
    'Maintenance lock is not a regular file.',
    'Maintenance lock could not be read safely.',
    'Maintenance recovery requires explicit confirmation with --yes.',
    'Database, storage, and source-text locations are required.',
    'The inspected owner scope and PID are required.',
    'No maintenance lock exists.',
    'The maintenance lock owner changed after inspection; inspect it again.',
  ];
  const sources = {
    'backup-data.js': readScript('backup-data.js'),
    'restore-data.js': readScript('restore-data.js'),
    'recover-maintenance.js': readScript('recover-maintenance.js'),
  };
  for (const [name, source] of Object.entries(sources)) {
    for (const phrase of leftoverEnglish) {
      assert.equal(source.includes(phrase), false, `${name} 仍包含：${phrase}`);
    }
    assert.match(source, /formatBackupCliError/);
    assert.match(source, /BACKUP_PUBLIC_MESSAGES\[code\]/);
  }
  assert.match(sources['backup-data.js'], /缺少参数值/);
  assert.match(sources['backup-data.js'], /不能重复指定备份选项/);
  assert.match(sources['backup-data.js'], /未知备份选项/);
  assert.match(sources['backup-data.js'], /throw backupError\('MACHINE_RESULT_TOO_LARGE'\)/);
  assert.match(sources['backup-data.js'], /throw backupError\('MACHINE_RESULT_WRITE_FAILED'\)/);
  assert.match(sources['backup-data.js'], /throw backupError\('PUBLICATION_TIMEOUT'\)/);
  assert.match(sources['restore-data.js'], /缺少参数值/);
  assert.match(sources['restore-data.js'], /未知恢复选项/);
  assert.match(sources['recover-maintenance.js'], /缺少参数值/);
  assert.match(sources['recover-maintenance.js'], /未知维护恢复选项/);
});

test('备份与恢复 CLI 参数错误输出简体中文', () => {
  const backupMissing = spawnSync(process.execPath, [path.join(SCRIPT_ROOT, 'backup-data.js'), '--output'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(backupMissing.status, 1);
  assert.match(backupMissing.stderr, /\[INVALID_ARGUMENT\]/);
  assert.match(backupMissing.stderr, /缺少参数值/);
  assert.doesNotMatch(backupMissing.stderr, /备份参数不完整/);
  assert.match(backupMissing.stderr, HAN_RE);
  assert.doesNotMatch(backupMissing.stderr, /requires a value/i);

  const backupUnknown = spawnSync(process.execPath, [path.join(SCRIPT_ROOT, 'backup-data.js'), '--unknown-flag'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(backupUnknown.status, 1);
  assert.match(backupUnknown.stderr, /\[INVALID_ARGUMENT\]/);
  assert.match(backupUnknown.stderr, HAN_RE);
  assert.doesNotMatch(backupUnknown.stderr, /Unknown backup option/i);

  const restoreMissing = spawnSync(process.execPath, [path.join(SCRIPT_ROOT, 'restore-data.js'), '--input'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(restoreMissing.status, 1);
  assert.match(restoreMissing.stderr, /\[INVALID_ARGUMENT\]/);
  assert.match(restoreMissing.stderr, /缺少参数值/);
  assert.doesNotMatch(restoreMissing.stderr, /备份参数不完整/);
  assert.match(restoreMissing.stderr, HAN_RE);
  assert.doesNotMatch(restoreMissing.stderr, /requires a value/i);

  const recoverMissing = spawnSync(process.execPath, [path.join(SCRIPT_ROOT, 'recover-maintenance.js'), '--pid'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(recoverMissing.status, 1);
  assert.match(recoverMissing.stderr, /\[INVALID_ARGUMENT\]/);
  assert.match(recoverMissing.stderr, /缺少参数值/);
  assert.doesNotMatch(recoverMissing.stderr, /备份参数不完整/);
  assert.doesNotMatch(recoverMissing.stderr, /requires a value/i);
});

test('维护恢复 CLI 构造函数使用简体中文', () => {
  const { parseArguments, recoverMaintenanceLock } = require('../scripts/recover-maintenance.js');
  assert.throws(
    () => parseArguments(['--pid']),
    (error) => error instanceof DataBackupError
      && error.code === 'INVALID_ARGUMENT'
      && /缺少参数值/.test(error.publicMessage)
      && !/requires a value/i.test(error.publicMessage),
  );
  assert.throws(
    () => parseArguments(['--unknown-flag']),
    (error) => error.code === 'INVALID_ARGUMENT'
      && /未知维护恢复选项/.test(error.publicMessage),
  );
  assert.throws(
    () => recoverMaintenanceLock({ confirmed: false }),
    (error) => error.code === 'CONFIRMATION_REQUIRED'
      && HAN_RE.test(error.publicMessage)
      && !/explicit confirmation/i.test(error.publicMessage),
  );
  assert.throws(
    () => recoverMaintenanceLock({
      confirmed: true,
      databasePath: 'x',
      storagePath: 'y',
      storySourcesPath: 'z',
    }),
    (error) => error.code === 'INVALID_ARGUMENT'
      && /作用域和 PID/.test(error.publicMessage),
  );
});
