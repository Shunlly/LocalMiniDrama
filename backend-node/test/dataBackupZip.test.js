const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const dataBackupService = require('../src/services/dataBackupService');
const { DataBackupError } = require('../src/services/dataBackupErrors');
const { FORMAT_VERSION } = require('../src/services/dataBackupFormatContract');
const {
  BACKUP_PUBLICATION_RESULT_SCHEMA,
  DEFAULT_LIMITS,
  fileIdentity,
} = require('../src/services/dataBackupValidation');
const zip = require('../src/services/dataBackupZip');

function expectCode(code) {
  return (error) => error instanceof DataBackupError && error.code === code;
}

function signature(fn) {
  const text = Function.prototype.toString.call(fn);
  const match = text.match(/^(async )?function ([^(]+)\(([^)]*)\)/);
  assert.ok(match, '无法解析函数签名');
  return {
    async: Boolean(match[1]),
    name: match[2].trim(),
    params: match[3].split(',').map((part) => part.trim()).filter(Boolean),
  };
}

async function removeDir(root) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fsp.rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function makeTempRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'lmd-backup-zip-'));
  t.after(async () => {
    await removeDir(root);
  });
  return root;
}

function bufferSource(name, content, mtimeMs = Date.now()) {
  return { name, buffer: Buffer.from(content), mtimeMs };
}

async function closeArchive(archive) {
  if (archive?.ownsHandle && archive.handle) await archive.handle.close().catch(() => {});
}

test('dataBackupService 仍导出同一 writeZip64ArchiveToHandle，备份/恢复入口签名不变', () => {
  assert.equal(dataBackupService.writeZip64ArchiveToHandle, zip.writeZip64ArchiveToHandle);
  assert.deepEqual(signature(dataBackupService.createDataBackup), {
    async: true,
    name: 'createDataBackup',
    params: ['options'],
  });
  assert.deepEqual(signature(dataBackupService.restoreDataBackup), {
    async: true,
    name: 'restoreDataBackup',
    params: ['options'],
  });
  assert.deepEqual(signature(zip.writeZip64ArchiveToHandle), {
    async: true,
    name: 'writeZip64ArchiveToHandle',
    params: ['handle', 'sources', 'signal'],
  });
  assert.deepEqual(Object.keys(zip).sort(), [
    'consumeArchiveEntry',
    'createCentralZip64Extra',
    'createDescriptorArchive',
    'createLocalZip64Extra',
    'descriptorCall',
    'descriptorHandle',
    'descriptorPublicationMarker',
    'descriptorRead',
    'descriptorStat',
    'dosDateTime',
    'findEndOfCentralDirectory',
    'finishCrc32',
    'readArchiveDirectory',
    'readExactly',
    'readUInt64Safe',
    'readZip64Values',
    'sha256Descriptor',
    'updateCrc32',
    'writeAll',
    'writeStoredZipEntry',
    'writeZip64Archive',
    'writeZip64ArchiveToHandle',
  ]);
});

test('CRC32 与 DOS 时间按 ZIP 约定计算，年份被夹紧到 1980-2107', () => {
  const crc = zip.finishCrc32(zip.updateCrc32(0xffffffff, Buffer.from('123456789')));
  assert.equal(crc, 0xcbf43926);
  const date = new Date(2026, 0, 2, 3, 4, 6);
  assert.deepEqual(zip.dosDateTime(date), {
    dosDate: ((2026 - 1980) << 9) | (1 << 5) | 2,
    dosTime: (3 << 11) | (4 << 5) | 3,
  });
  assert.equal(zip.dosDateTime(new Date(1970, 5, 1)).dosDate >>> 9, 0);
  assert.equal(zip.dosDateTime(new Date(2200, 5, 1)).dosDate >>> 9, 2107 - 1980);
});

test('ZIP64 extra 与 EOCD/uint64 解析保持原布局', () => {
  const local = zip.createLocalZip64Extra();
  assert.equal(local.length, 20);
  assert.equal(local.readUInt16LE(0), 0x0001);
  assert.equal(local.readUInt16LE(2), 16);
  assert.equal(local.readBigUInt64LE(4), 0n);
  assert.equal(local.readBigUInt64LE(12), 0n);

  const central = zip.createCentralZip64Extra(42, 99);
  assert.deepEqual(
    zip.readZip64Values(central, {
      uncompressedSize: true,
      compressedSize: true,
      localOffset: true,
      diskStart: false,
    }),
    { uncompressedSize: 42, compressedSize: 42, localOffset: 99 }
  );
  assert.deepEqual(zip.readZip64Values(central, {
    uncompressedSize: false,
    compressedSize: false,
    localOffset: false,
    diskStart: false,
  }), {});

  const tail = Buffer.alloc(22);
  tail.writeUInt32LE(0x06054b50, 0);
  assert.deepEqual(zip.findEndOfCentralDirectory(tail, 1000), {
    bufferOffset: 0,
    fileOffset: 1000,
  });
  assert.equal(zip.readUInt64Safe(Buffer.from('0800000000000000', 'hex'), 0), 8);
  assert.throws(() => zip.findEndOfCentralDirectory(Buffer.alloc(22), 0), expectCode('INVALID_ARCHIVE'));
  assert.throws(
    () => zip.readZip64Values(Buffer.from([0x01, 0x00, 0x01, 0x00]), {
      uncompressedSize: true,
      compressedSize: false,
      localOffset: false,
      diskStart: false,
    }),
    expectCode('INVALID_ARCHIVE')
  );
});

test('writeAll 支持分次写入，bytesWritten 为 0 时失败', async () => {
  const chunks = [];
  const handle = {
    async write(buffer, offset, length, position) {
      const take = Math.min(2, length);
      chunks.push({ position, bytes: Buffer.from(buffer.subarray(offset, offset + take)) });
      return { bytesWritten: take, buffer };
    },
  };
  const next = await zip.writeAll(handle, Buffer.from('abcdef'), 10);
  assert.equal(next, 16);
  assert.deepEqual(Buffer.concat(chunks.map((chunk) => chunk.bytes)).toString(), 'abcdef');
  assert.deepEqual(chunks.map((chunk) => chunk.position), [10, 12, 14]);
  await assert.rejects(
    zip.writeAll({ async write() { return { bytesWritten: 0 }; } }, Buffer.from('x'), 0),
    expectCode('ARCHIVE_WRITE_FAILED')
  );
});

test('writeZip64Archive 往返读取 buffer 与文件条目，调用方句柄保持打开', async (t) => {
  const root = await makeTempRoot(t);
  const archivePath = path.join(root, 'backup.zip');
  const storagePath = path.join(root, 'cover.txt');
  await fsp.writeFile(storagePath, 'cover-bytes');
  const storageStat = await fsp.stat(storagePath);
  const manifest = '{"format":"zip64-test"}\n';
  const database = Buffer.from('sqlite-bytes');
  await zip.writeZip64Archive(archivePath, [
    bufferSource('manifest.json', manifest),
    bufferSource('database.sqlite', database),
    {
      name: 'storage/images/cover.txt',
      filePath: storagePath,
      identity: fileIdentity(storageStat),
      sha256: crypto.createHash('sha256').update('cover-bytes').digest('hex'),
      mtimeMs: storageStat.mtimeMs,
    },
  ]);

  const owned = await fsp.open(archivePath, 'r');
  try {
    const archive = await zip.readArchiveDirectory(archivePath, DEFAULT_LIMITS, owned);
    assert.equal(archive.ownsHandle, false);
    assert.equal(archive.handle, owned);
    assert.deepEqual(archive.entries.map((entry) => entry.name), [
      'manifest.json',
      'database.sqlite',
      'storage/images/cover.txt',
    ]);
    assert.equal(archive.entries.every((entry) => entry.method === 0), true);

    const manifestResult = await zip.consumeArchiveEntry(archive, archive.entries[0], {
      collect: true,
      sha256: true,
    });
    assert.equal(manifestResult.buffer.toString('utf8'), manifest);
    assert.equal(manifestResult.sha256, crypto.createHash('sha256').update(manifest).digest('hex'));

    const dbResult = await zip.consumeArchiveEntry(archive, archive.entries[1], { collect: true });
    assert.equal(Buffer.compare(dbResult.buffer, database), 0);

    const extracted = path.join(root, 'out', 'cover.txt');
    await zip.consumeArchiveEntry(archive, archive.entries[2], { destination: extracted });
    assert.equal(await fsp.readFile(extracted, 'utf8'), 'cover-bytes');
    assert.equal((await owned.stat()).isFile(), true);
  } finally {
    await owned.close().catch(() => {});
  }
});

test('readArchiveDirectory 拒绝缺失、过小和不完整备份包', async (t) => {
  const root = await makeTempRoot(t);
  const missing = path.join(root, 'missing.zip');
  const tiny = path.join(root, 'tiny.zip');
  const incomplete = path.join(root, 'incomplete.zip');
  await fsp.writeFile(tiny, Buffer.alloc(10));
  await zip.writeZip64Archive(incomplete, [
    bufferSource('manifest.json', '{}'),
    bufferSource('storage/a.txt', 'x'),
  ]);

  await assert.rejects(zip.readArchiveDirectory(missing, DEFAULT_LIMITS), expectCode('ARCHIVE_UNAVAILABLE'));
  await assert.rejects(zip.readArchiveDirectory(tiny, DEFAULT_LIMITS), expectCode('INVALID_ARCHIVE'));
  await assert.rejects(zip.readArchiveDirectory(incomplete, DEFAULT_LIMITS), expectCode('INVALID_ARCHIVE'));
});

test('写入路径校验文件变化、哈希变化、超长路径和取消', async (t) => {
  const root = await makeTempRoot(t);
  const archivePath = path.join(root, 'reject.zip');
  const filePath = path.join(root, 'database.sqlite');
  await fsp.writeFile(filePath, 'hello');
  const stat = await fsp.stat(filePath);

  await assert.rejects(
    zip.writeZip64Archive(archivePath, [{
      name: 'a'.repeat(65536),
      buffer: Buffer.from('x'),
      mtimeMs: Date.now(),
    }]),
    expectCode('UNSAFE_ARCHIVE_PATH')
  );

  await fsp.writeFile(filePath, 'hello!');
  await assert.rejects(
    zip.writeZip64Archive(path.join(root, 'changed.zip'), [
      bufferSource('manifest.json', '{}'),
      {
        name: 'database.sqlite',
        filePath,
        identity: fileIdentity(stat),
        mtimeMs: stat.mtimeMs,
      },
    ]),
    expectCode('STORAGE_CHANGED')
  );

  await fsp.writeFile(filePath, 'hello');
  const current = await fsp.stat(filePath);
  await assert.rejects(
    zip.writeZip64Archive(path.join(root, 'hash.zip'), [
      bufferSource('manifest.json', '{}'),
      {
        name: 'storage/a.txt',
        filePath,
        identity: fileIdentity(current),
        sha256: '00'.repeat(32),
        mtimeMs: current.mtimeMs,
      },
    ]),
    expectCode('BACKUP_DATA_CHANGED')
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    zip.writeZip64Archive(path.join(root, 'aborted.zip'), [
      bufferSource('manifest.json', '{}'),
      bufferSource('database.sqlite', 'db'),
    ], controller.signal),
    expectCode('OPERATION_ABORTED')
  );
});

test('consumeArchiveEntry 在 CRC 不匹配时拒绝，readExactly 遇到截断也拒绝', async (t) => {
  const root = await makeTempRoot(t);
  const archivePath = path.join(root, 'crc.zip');
  await zip.writeZip64Archive(archivePath, [
    bufferSource('manifest.json', '{"ok":true}'),
    bufferSource('database.sqlite', 'payload'),
  ]);
  const archive = await zip.readArchiveDirectory(archivePath, DEFAULT_LIMITS);
  try {
    const tampered = { ...archive.entries[1], crc: 1 };
    await assert.rejects(zip.consumeArchiveEntry(archive, tampered, { collect: true }), expectCode('INVALID_ARCHIVE'));
    await assert.rejects(
      zip.readExactly({ async read() { return { bytesRead: 0 }; } }, 4, 0),
      expectCode('INVALID_ARCHIVE')
    );
    await assert.rejects(zip.readExactly(archive.handle, -1, 0), expectCode('INVALID_ARCHIVE'));
  } finally {
    await closeArchive(archive);
  }
});

test('createDescriptorArchive 写出并校验调用方描述符，不关闭 fd', async (t) => {
  const root = await makeTempRoot(t);
  const publicationPath = path.join(root, 'data.zip');
  const temporaryPath = path.join(root, '.data.zip.tmp');
  const writeHandle = await fsp.open(temporaryPath, 'wx+', 0o600);
  const readHandle = await fsp.open(temporaryPath, 'r+');
  try {
    const publication = await zip.createDescriptorArchive(
      {
        readFd: readHandle.fd,
        writeFd: writeHandle.fd,
        publicationPath,
        publicationFile: 'data.zip',
        operationId: '0123456789abcdef0123456789abcdef',
        waitForPublication: async (marker) => {
          assert.equal(marker.phase, 'ready');
          assert.equal(marker.schema, BACKUP_PUBLICATION_RESULT_SCHEMA);
          assert.equal(marker.format_version, FORMAT_VERSION);
          await fsp.rename(temporaryPath, publicationPath);
        },
      },
      [
        bufferSource('manifest.json', '{"ok":true}'),
        bufferSource('database.sqlite', 'db-bytes'),
      ],
      DEFAULT_LIMITS
    );

    assert.equal((await readHandle.stat()).isFile(), true);
    assert.equal((await writeHandle.stat()).isFile(), true);
    assert.equal(publication.committed.phase, 'committed');
    assert.equal(publication.committed.archive_sha256, publication.ready.archive_sha256);
    assert.equal(publication.committed.archive_bytes, String(publication.archiveBytes));
    assert.equal(publication.ready.publication_file, 'data.zip');
  } finally {
    await readHandle.close().catch(() => {});
    await writeHandle.close().catch(() => {});
  }
});

test('createDescriptorArchive 拒绝非空描述符和发布后身份变化', async (t) => {
  const root = await makeTempRoot(t);
  const nonempty = path.join(root, 'nonempty.bin');
  await fsp.writeFile(nonempty, 'x');
  const nonemptyHandle = await fsp.open(nonempty, 'r+');
  try {
    await assert.rejects(
      zip.createDescriptorArchive(
        {
          readFd: nonemptyHandle.fd,
          writeFd: nonemptyHandle.fd,
          publicationPath: path.join(root, 'data.zip'),
          publicationFile: 'data.zip',
          operationId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          waitForPublication: async () => {},
        },
        [bufferSource('manifest.json', '{}')],
        DEFAULT_LIMITS
      ),
      expectCode('INVALID_DESCRIPTOR_PUBLICATION')
    );
  } finally {
    await nonemptyHandle.close().catch(() => {});
  }

  const publicationPath = path.join(root, 'data.zip');
  const temporaryPath = path.join(root, '.copy.tmp');
  const writeHandle = await fsp.open(temporaryPath, 'wx+', 0o600);
  const readHandle = await fsp.open(temporaryPath, 'r+');
  try {
    await assert.rejects(
      zip.createDescriptorArchive(
        {
          readFd: readHandle.fd,
          writeFd: writeHandle.fd,
          publicationPath,
          publicationFile: 'data.zip',
          operationId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          waitForPublication: async () => {
            await fsp.copyFile(temporaryPath, publicationPath);
          },
        },
        [
          bufferSource('manifest.json', '{}'),
          bufferSource('database.sqlite', 'db'),
        ],
        DEFAULT_LIMITS
      ),
      expectCode('PUBLICATION_IDENTITY_MISMATCH')
    );
  } finally {
    await readHandle.close().catch(() => {});
    await writeHandle.close().catch(() => {});
  }
});

test('descriptor 辅助函数按 fd 读写并生成发布标记', async (t) => {
  const root = await makeTempRoot(t);
  const filePath = path.join(root, 'desc.bin');
  const fd = fs.openSync(filePath, 'w+');
  try {
    const handle = zip.descriptorHandle(fd);
    await zip.writeAll(handle, Buffer.from('abcd'), 0);
    await handle.sync();
    const stat = await zip.descriptorStat(fd);
    assert.equal(Number(stat.size), 4);
    const buffer = Buffer.alloc(4);
    const read = await zip.descriptorRead(fd, buffer, 0, 4, 0);
    assert.equal(read.bytesRead, 4);
    assert.equal(buffer.toString(), 'abcd');
    assert.equal(await zip.sha256Descriptor(fd, 4), crypto.createHash('sha256').update('abcd').digest('hex'));
    const marker = zip.descriptorPublicationMarker(
      { operationId: 'cc'.repeat(16), publicationFile: 'data.zip' },
      'ready',
      'dd'.repeat(32),
      4,
      'identity'
    );
    assert.equal(marker.schema, BACKUP_PUBLICATION_RESULT_SCHEMA);
    assert.equal(marker.archive_bytes, '4');
    const resolved = await zip.descriptorCall((done) => done(null, 9, Buffer.from('z')));
    assert.equal(resolved.value, 9);
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
  }
});
