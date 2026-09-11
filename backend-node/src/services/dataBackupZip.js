'use strict';

// 备份 ZIP64 编解码：写入存储条目、描述符归档，以及中央目录解析与条目消费。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable, Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const {
  FORMAT_VERSION,
  MINIMUM_ZIP_ARCHIVE_BYTES,
} = require('./dataBackupFormatContract');
const {
  DataBackupError,
  assertOperationNotAborted,
  backupError,
} = require('./dataBackupErrors');
const {
  BACKUP_PUBLICATION_RESULT_SCHEMA,
  DATABASE_ENTRY,
  MANIFEST_ENTRY,
  STORAGE_PREFIX,
  STORY_SOURCES_PREFIX,
  assertRegularDescriptorStat,
  assertRegularZipEntry,
  assertUnusedArchiveCollisionKey,
  canonicalPhysicalIdentity,
  descriptorSize,
  sameDescriptorIdentity,
  sameFileIdentity,
  toSafeNumber,
  validateArchiveName,
} = require('./dataBackupValidation');
const { lstatIfExists } = require('./dataBackupPaths');

// 写出归档条目后把目标文件权限收敛为仅所有者可读写。
async function chmodPrivate(target) {
  try {
    await fsp.chmod(target, 0o600);
  } catch (error) {
    if (!['ENOSYS', 'ENOTSUP', 'EPERM', 'EINVAL'].includes(error.code)) throw error;
  }
}

const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP64_UINT32 = 0xffffffff;
const ZIP64_UINT16 = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function updateCrc32(current, buffer) {
  let crc = current;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function finishCrc32(current) {
  return (current ^ 0xffffffff) >>> 0;
}

function dosDateTime(dateValue) {
  const date = new Date(dateValue || Date.now());
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

async function writeAll(handle, buffer, startPosition) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset, startPosition + offset);
    if (result.bytesWritten <= 0) throw backupError('ARCHIVE_WRITE_FAILED');
    offset += result.bytesWritten;
  }
  return startPosition + buffer.length;
}

function descriptorCall(invoker) {
  return new Promise((resolve, reject) => {
    invoker((error, value, buffer) => {
      if (error) reject(error);
      else resolve({ value, buffer });
    });
  });
}

function descriptorHandle(fd) {
  return Object.freeze({
    async write(buffer, offset, length, position) {
      const result = await descriptorCall((done) => fs.write(fd, buffer, offset, length, position, done));
      return { bytesWritten: result.value, buffer: result.buffer };
    },
    async sync() {
      await descriptorCall((done) => fs.fsync(fd, (error) => done(error, undefined)));
    },
  });
}

async function descriptorStat(fd) {
  const result = await descriptorCall((done) => fs.fstat(fd, { bigint: true }, done));
  return result.value;
}

async function descriptorRead(fd, buffer, offset, length, position) {
  const result = await descriptorCall((done) => fs.read(fd, buffer, offset, length, position, done));
  return { bytesRead: result.value, buffer: result.buffer };
}

async function sha256Descriptor(fd, expectedBytes, signal) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (position < expectedBytes) {
    assertOperationNotAborted(signal);
    const length = Math.min(buffer.length, expectedBytes - position);
    const result = await descriptorRead(fd, buffer, 0, length, position);
    if (result.bytesRead <= 0) {
      throw backupError('PUBLICATION_CONTENT_MISMATCH');
    }
    hash.update(buffer.subarray(0, result.bytesRead));
    position += result.bytesRead;
  }
  return hash.digest('hex');
}

function descriptorPublicationMarker(publication, phase, archiveSha256, archiveBytes, filesystemIdentity) {
  return Object.freeze({
    schema: BACKUP_PUBLICATION_RESULT_SCHEMA,
    operation_id: publication.operationId,
    phase,
    publication_file: publication.publicationFile,
    archive_sha256: archiveSha256,
    archive_bytes: String(archiveBytes),
    filesystem_identity: filesystemIdentity,
    format_version: FORMAT_VERSION,
  });
}

function createLocalZip64Extra() {
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(16, 2);
  extra.writeBigUInt64LE(0n, 4);
  extra.writeBigUInt64LE(0n, 12);
  return extra;
}

function createCentralZip64Extra(size, offset) {
  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(BigInt(size), 4);
  extra.writeBigUInt64LE(BigInt(size), 12);
  extra.writeBigUInt64LE(BigInt(offset), 20);
  return extra;
}

async function writeStoredZipEntry(archiveHandle, position, source, signal) {
  assertOperationNotAborted(signal);
  const nameBuffer = Buffer.from(source.name, 'utf8');
  if (nameBuffer.length > ZIP64_UINT16) {
    throw backupError('UNSAFE_ARCHIVE_PATH');
  }
  const localOffset = position;
  const localExtra = createLocalZip64Extra();
  const { dosDate, dosTime } = dosDateTime(source.mtimeMs);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(ZIP_LOCAL_SIGNATURE, 0);
  localHeader.writeUInt16LE(45, 4);
  localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(ZIP64_UINT32, 18);
  localHeader.writeUInt32LE(ZIP64_UINT32, 22);
  localHeader.writeUInt16LE(nameBuffer.length, 26);
  localHeader.writeUInt16LE(localExtra.length, 28);
  position = await writeAll(archiveHandle, localHeader, position);
  position = await writeAll(archiveHandle, nameBuffer, position);
  position = await writeAll(archiveHandle, localExtra, position);

  let crc = 0xffffffff;
  let size = 0;
  const contentHash = source.sha256 ? crypto.createHash('sha256') : null;
  if (source.buffer) {
    crc = updateCrc32(crc, source.buffer);
    if (contentHash) contentHash.update(source.buffer);
    size = source.buffer.length;
    position = await writeAll(archiveHandle, source.buffer, position);
  } else {
    let sourceHandle;
    try {
      sourceHandle = await fsp.open(source.filePath, fs.constants.O_RDONLY);
      const before = await sourceHandle.stat();
      if (!sameFileIdentity(before, source.identity)) {
        throw backupError('STORAGE_CHANGED');
      }
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let sourcePosition = 0;
      while (sourcePosition < source.identity.size) {
        assertOperationNotAborted(signal);
        const length = Math.min(buffer.length, source.identity.size - sourcePosition);
        const result = await sourceHandle.read(buffer, 0, length, sourcePosition);
        if (result.bytesRead <= 0) {
          throw backupError('STORAGE_CHANGED');
        }
        const chunk = buffer.subarray(0, result.bytesRead);
        crc = updateCrc32(crc, chunk);
        if (contentHash) contentHash.update(chunk);
        size += result.bytesRead;
        sourcePosition += result.bytesRead;
        position = await writeAll(archiveHandle, chunk, position);
      }
      const after = await sourceHandle.stat();
      if (size !== source.identity.size || !sameFileIdentity(after, source.identity)) {
        throw backupError('STORAGE_CHANGED');
      }
    } finally {
      if (sourceHandle) await sourceHandle.close();
    }
  }

  if (contentHash && contentHash.digest('hex') !== source.sha256) {
    throw backupError('BACKUP_DATA_CHANGED');
  }

  assertOperationNotAborted(signal);

  const finalCrc = finishCrc32(crc);
  const crcPatch = Buffer.alloc(4);
  crcPatch.writeUInt32LE(finalCrc, 0);
  await writeAll(archiveHandle, crcPatch, localOffset + 14);
  const sizePatch = Buffer.alloc(16);
  sizePatch.writeBigUInt64LE(BigInt(size), 0);
  sizePatch.writeBigUInt64LE(BigInt(size), 8);
  await writeAll(archiveHandle, sizePatch, localOffset + 30 + nameBuffer.length + 4);
  return {
    position,
    central: { nameBuffer, localOffset, size, crc: finalCrc, dosDate, dosTime },
  };
}

async function writeZip64ArchiveToHandle(handle, sources, signal) {
  try {
    assertOperationNotAborted(signal);
    let position = 0;
    const centralEntries = [];
    for (const source of sources) {
      assertOperationNotAborted(signal);
      const result = await writeStoredZipEntry(handle, position, source, signal);
      position = result.position;
      centralEntries.push(result.central);
    }

    const centralOffset = position;
    for (const entry of centralEntries) {
      assertOperationNotAborted(signal);
      const extra = createCentralZip64Extra(entry.size, entry.localOffset);
      const header = Buffer.alloc(46);
      header.writeUInt32LE(ZIP_CENTRAL_SIGNATURE, 0);
      header.writeUInt16LE((3 << 8) | 45, 4);
      header.writeUInt16LE(45, 6);
      header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(entry.dosTime, 12);
      header.writeUInt16LE(entry.dosDate, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(ZIP64_UINT32, 20);
      header.writeUInt32LE(ZIP64_UINT32, 24);
      header.writeUInt16LE(entry.nameBuffer.length, 28);
      header.writeUInt16LE(extra.length, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE((0o100600 << 16) >>> 0, 38);
      header.writeUInt32LE(ZIP64_UINT32, 42);
      position = await writeAll(handle, header, position);
      position = await writeAll(handle, entry.nameBuffer, position);
      position = await writeAll(handle, extra, position);
    }

    const centralSize = position - centralOffset;
    assertOperationNotAborted(signal);
    const zip64EndOffset = position;
    const zip64End = Buffer.alloc(56);
    zip64End.writeUInt32LE(ZIP64_END_SIGNATURE, 0);
    zip64End.writeBigUInt64LE(44n, 4);
    zip64End.writeUInt16LE((3 << 8) | 45, 12);
    zip64End.writeUInt16LE(45, 14);
    zip64End.writeUInt32LE(0, 16);
    zip64End.writeUInt32LE(0, 20);
    zip64End.writeBigUInt64LE(BigInt(centralEntries.length), 24);
    zip64End.writeBigUInt64LE(BigInt(centralEntries.length), 32);
    zip64End.writeBigUInt64LE(BigInt(centralSize), 40);
    zip64End.writeBigUInt64LE(BigInt(centralOffset), 48);
    position = await writeAll(handle, zip64End, position);

    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(ZIP64_LOCATOR_SIGNATURE, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(zip64EndOffset), 8);
    locator.writeUInt32LE(1, 16);
    position = await writeAll(handle, locator, position);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(ZIP_END_SIGNATURE, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(ZIP64_UINT16, 8);
    end.writeUInt16LE(ZIP64_UINT16, 10);
    end.writeUInt32LE(ZIP64_UINT32, 12);
    end.writeUInt32LE(ZIP64_UINT32, 16);
    end.writeUInt16LE(0, 20);
    position = await writeAll(handle, end, position);
    await handle.sync();
    return position;
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('ARCHIVE_WRITE_FAILED', error);
  }
}

async function writeZip64Archive(tempPath, sources, signal) {
  let handle;
  try {
    handle = await fsp.open(tempPath, 'wx', 0o600);
    return await writeZip64ArchiveToHandle(handle, sources, signal);
  } finally {
    if (handle) await handle.close();
  }
}

async function createDescriptorArchive(publication, sources, limits, signal) {
  let readStat;
  let writeStat;
  try {
    [readStat, writeStat] = await Promise.all([
      descriptorStat(publication.readFd),
      descriptorStat(publication.writeFd),
    ]);
  } catch (error) {
    throw backupError('INVALID_DESCRIPTOR_PUBLICATION', error);
  }
  assertRegularDescriptorStat(readStat);
  assertRegularDescriptorStat(writeStat);
  if (!sameDescriptorIdentity(readStat, writeStat) || descriptorSize(readStat) !== 0 || descriptorSize(writeStat) !== 0) {
    throw backupError('INVALID_DESCRIPTOR_PUBLICATION');
  }
  const filesystemIdentity = canonicalPhysicalIdentity(readStat);
  const archiveBytesWritten = await writeZip64ArchiveToHandle(
    descriptorHandle(publication.writeFd),
    sources,
    signal
  );
  assertOperationNotAborted(signal);

  [readStat, writeStat] = await Promise.all([
    descriptorStat(publication.readFd),
    descriptorStat(publication.writeFd),
  ]);
  assertRegularDescriptorStat(readStat);
  assertRegularDescriptorStat(writeStat);
  const archiveBytes = descriptorSize(readStat);
  if (
    !sameDescriptorIdentity(readStat, writeStat) ||
    canonicalPhysicalIdentity(readStat) !== filesystemIdentity ||
    descriptorSize(writeStat) !== archiveBytes ||
    archiveBytes !== archiveBytesWritten
  ) {
    throw backupError('PUBLICATION_CONTENT_MISMATCH');
  }
  if (archiveBytes > limits.maxArchiveBytes) {
    throw backupError('ARCHIVE_LIMIT_EXCEEDED');
  }
  const archiveSha256 = await sha256Descriptor(publication.readFd, archiveBytes, signal);
  const preReadyStat = await descriptorStat(publication.readFd);
  if (
    canonicalPhysicalIdentity(preReadyStat) !== filesystemIdentity ||
    descriptorSize(preReadyStat, 'PUBLICATION_CONTENT_MISMATCH') !== archiveBytes
  ) {
    throw backupError('PUBLICATION_CONTENT_MISMATCH');
  }

  const ready = descriptorPublicationMarker(
    publication,
    'ready',
    archiveSha256,
    archiveBytes,
    filesystemIdentity
  );
  await publication.waitForPublication(ready);
  assertOperationNotAborted(signal);

  let finalPathStat;
  try {
    finalPathStat = await fsp.lstat(publication.publicationPath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw backupError('PUBLICATION_IDENTITY_MISMATCH');
    }
    throw backupError('PUBLICATION_IDENTITY_MISMATCH', error);
  }
  const [finalReadStat, finalWriteStat] = await Promise.all([
    descriptorStat(publication.readFd),
    descriptorStat(publication.writeFd),
  ]);
  if (
    !finalPathStat.isFile() || finalPathStat.isSymbolicLink() ||
    !sameDescriptorIdentity(finalReadStat, finalWriteStat) ||
    canonicalPhysicalIdentity(finalReadStat) !== filesystemIdentity ||
    canonicalPhysicalIdentity(finalPathStat) !== filesystemIdentity
  ) {
    throw backupError('PUBLICATION_IDENTITY_MISMATCH');
  }
  if (descriptorSize(finalReadStat, 'PUBLICATION_CONTENT_MISMATCH') !== archiveBytes) {
    throw backupError('PUBLICATION_CONTENT_MISMATCH');
  }
  const committedSha256 = await sha256Descriptor(publication.readFd, archiveBytes, signal);
  const committedReadStat = await descriptorStat(publication.readFd);
  if (
    committedSha256 !== archiveSha256 ||
    canonicalPhysicalIdentity(committedReadStat) !== filesystemIdentity ||
    descriptorSize(committedReadStat, 'PUBLICATION_CONTENT_MISMATCH') !== archiveBytes
  ) {
    throw backupError('PUBLICATION_CONTENT_MISMATCH');
  }
  const committed = descriptorPublicationMarker(
    publication,
    'committed',
    committedSha256,
    archiveBytes,
    filesystemIdentity
  );
  return { archiveBytes, ready, committed };
}

async function readExactly(handle, length, position) {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) {
    throw backupError('INVALID_ARCHIVE');
  }
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (result.bytesRead <= 0) {
      throw backupError('INVALID_ARCHIVE');
    }
    offset += result.bytesRead;
  }
  return buffer;
}

function readUInt64Safe(buffer, offset) {
  return toSafeNumber(buffer.readBigUInt64LE(offset));
}

function findEndOfCentralDirectory(tail, tailOffset) {
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) !== ZIP_END_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(index + 20);
    if (index + 22 + commentLength === tail.length) {
      return { bufferOffset: index, fileOffset: tailOffset + index };
    }
  }
  throw backupError('INVALID_ARCHIVE');
}

function readZip64Values(extra, needs) {
  let cursor = 0;
  let zip64 = null;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + size > extra.length) {
      throw backupError('INVALID_ARCHIVE');
    }
    if (id === 0x0001) {
      if (zip64) throw backupError('INVALID_ARCHIVE');
      zip64 = extra.subarray(cursor, cursor + size);
    }
    cursor += size;
  }
  if (cursor !== extra.length) {
    throw backupError('INVALID_ARCHIVE');
  }
  if (!Object.values(needs).some(Boolean)) return {};
  if (!zip64) throw backupError('INVALID_ARCHIVE');

  const result = {};
  let offset = 0;
  for (const key of ['uncompressedSize', 'compressedSize', 'localOffset']) {
    if (!needs[key]) continue;
    if (offset + 8 > zip64.length) {
      throw backupError('INVALID_ARCHIVE');
    }
    result[key] = readUInt64Safe(zip64, offset);
    offset += 8;
  }
  if (needs.diskStart) {
    if (offset + 4 > zip64.length) {
      throw backupError('INVALID_ARCHIVE');
    }
    result.diskStart = zip64.readUInt32LE(offset);
  }
  return result;
}

async function readArchiveDirectory(archivePath, limits, archiveHandle = null) {
  const archiveStat = await lstatIfExists(archivePath);
  if (!archiveStat || archiveStat.isSymbolicLink() || !archiveStat.isFile()) {
    throw backupError('ARCHIVE_UNAVAILABLE');
  }
  if (archiveStat.size > limits.maxArchiveBytes) {
    throw backupError('ARCHIVE_LIMIT_EXCEEDED');
  }

  let handle = archiveHandle;
  const ownsHandle = !archiveHandle;
  try {
    if (ownsHandle) handle = await fsp.open(archivePath, 'r');
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.size !== archiveStat.size || openedStat.dev !== archiveStat.dev || openedStat.ino !== archiveStat.ino) {
      throw backupError('ARCHIVE_CHANGED');
    }
    if (openedStat.size < MINIMUM_ZIP_ARCHIVE_BYTES) {
      throw backupError('INVALID_ARCHIVE');
    }

    const tailLength = Math.min(openedStat.size, 22 + ZIP64_UINT16 + 20);
    const tailOffset = openedStat.size - tailLength;
    const tail = await readExactly(handle, tailLength, tailOffset);
    const endLocation = findEndOfCentralDirectory(tail, tailOffset);
    const end = tail.subarray(endLocation.bufferOffset, endLocation.bufferOffset + 22);
    const diskNumber = end.readUInt16LE(4);
    const centralDisk = end.readUInt16LE(6);
    let entriesOnDisk = end.readUInt16LE(8);
    let entryCount = end.readUInt16LE(10);
    let centralSize = end.readUInt32LE(12);
    let centralOffset = end.readUInt32LE(16);
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
      throw backupError('INVALID_ARCHIVE');
    }

    const needsZip64 = entryCount === ZIP64_UINT16 || centralSize === ZIP64_UINT32 || centralOffset === ZIP64_UINT32;
    let centralBoundary = endLocation.fileOffset;
    if (needsZip64) {
      const locatorOffset = endLocation.fileOffset - 20;
      if (locatorOffset < 0) throw backupError('INVALID_ARCHIVE');
      const locator = await readExactly(handle, 20, locatorOffset);
      if (
        locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE ||
        locator.readUInt32LE(4) !== 0 ||
        locator.readUInt32LE(16) !== 1
      ) {
        throw backupError('INVALID_ARCHIVE');
      }
      const zip64Offset = readUInt64Safe(locator, 8);
      const zip64End = await readExactly(handle, 56, zip64Offset);
      const zip64RecordSize = readUInt64Safe(zip64End, 4);
      if (
        zip64End.readUInt32LE(0) !== ZIP64_END_SIGNATURE ||
        zip64RecordSize !== 44 ||
        zip64Offset + 12 + zip64RecordSize !== locatorOffset
      ) {
        throw backupError('INVALID_ARCHIVE');
      }
      if (zip64End.readUInt32LE(16) !== 0 || zip64End.readUInt32LE(20) !== 0) {
        throw backupError('INVALID_ARCHIVE');
      }
      entriesOnDisk = readUInt64Safe(zip64End, 24);
      entryCount = readUInt64Safe(zip64End, 32);
      centralSize = readUInt64Safe(zip64End, 40);
      centralOffset = readUInt64Safe(zip64End, 48);
      if (entriesOnDisk !== entryCount || zip64Offset + 56 > locatorOffset) {
        throw backupError('INVALID_ARCHIVE');
      }
      centralBoundary = zip64Offset;
    }

    if (entryCount < 2 || entryCount > limits.maxFiles + 2) {
      throw backupError('FILE_LIMIT_EXCEEDED');
    }
    if (
      centralOffset < 0 ||
      centralSize < 0 ||
      centralOffset + centralSize > centralBoundary ||
      centralOffset + centralSize > openedStat.size
    ) {
      throw backupError('INVALID_ARCHIVE');
    }

    const entries = [];
    const duplicateNames = new Set();
    let position = centralOffset;
    let directoryFileCount = 0;
    let payloadBytes = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (position + 46 > centralOffset + centralSize) {
        throw backupError('INVALID_ARCHIVE');
      }
      const header = await readExactly(handle, 46, position);
      if (header.readUInt32LE(0) !== ZIP_CENTRAL_SIGNATURE) {
        throw backupError('INVALID_ARCHIVE');
      }
      const versionMadeBy = header.readUInt16LE(4);
      const versionNeeded = header.readUInt16LE(6);
      const flags = header.readUInt16LE(8);
      const method = header.readUInt16LE(10);
      const crc = header.readUInt32LE(16);
      let compressedSize = header.readUInt32LE(20);
      let uncompressedSize = header.readUInt32LE(24);
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      let diskStart = header.readUInt16LE(34);
      const externalAttributes = header.readUInt32LE(38);
      let localOffset = header.readUInt32LE(42);
      const variableLength = nameLength + extraLength + commentLength;
      if (nameLength === 0 || nameLength > limits.maxPathBytes || position + 46 + variableLength > centralOffset + centralSize) {
        throw backupError('UNSAFE_ARCHIVE_PATH');
      }
      const variable = await readExactly(handle, variableLength, position + 46);
      const rawName = variable.subarray(0, nameLength);
      const extra = variable.subarray(nameLength, nameLength + extraLength);
      const name = validateArchiveName(rawName.toString('utf8'), rawName, limits);
      const zip64 = readZip64Values(extra, {
        uncompressedSize: uncompressedSize === ZIP64_UINT32,
        compressedSize: compressedSize === ZIP64_UINT32,
        localOffset: localOffset === ZIP64_UINT32,
        diskStart: diskStart === ZIP64_UINT16,
      });
      if (uncompressedSize === ZIP64_UINT32) uncompressedSize = zip64.uncompressedSize;
      if (compressedSize === ZIP64_UINT32) compressedSize = zip64.compressedSize;
      if (localOffset === ZIP64_UINT32) localOffset = zip64.localOffset;
      if (diskStart === ZIP64_UINT16) diskStart = zip64.diskStart;
      if (diskStart !== 0) throw backupError('INVALID_ARCHIVE');
      const allowedFlags = ZIP_UTF8_FLAG | ZIP_DATA_DESCRIPTOR_FLAG | (method === 8 ? 0x0006 : 0);
      if ((flags & ~allowedFlags) !== 0 || ![0, 8].includes(method)) {
        throw backupError('UNSUPPORTED_ARCHIVE');
      }
      assertRegularZipEntry(externalAttributes);
      if (uncompressedSize > limits.maxFileBytes) {
        throw backupError('FILE_LIMIT_EXCEEDED');
      }
      if (compressedSize > limits.maxArchiveBytes) {
        throw backupError('ARCHIVE_LIMIT_EXCEEDED');
      }
      if (method === 8 && uncompressedSize > 0 && compressedSize === 0) {
        throw backupError('INVALID_ARCHIVE');
      }
      if (method === 8 && compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
        throw backupError('COMPRESSION_LIMIT_EXCEEDED');
      }

      assertUnusedArchiveCollisionKey(duplicateNames, name);
      if (name.startsWith(STORAGE_PREFIX) || name.startsWith(STORY_SOURCES_PREFIX)) {
        directoryFileCount += 1;
      }
      if (name !== MANIFEST_ENTRY) {
        payloadBytes += uncompressedSize;
        if (!Number.isSafeInteger(payloadBytes) || payloadBytes > limits.maxTotalBytes) {
          throw backupError('SIZE_LIMIT_EXCEEDED');
        }
      }
      entries.push({
        name,
        rawName,
        versionMadeBy,
        versionNeeded,
        flags,
        method,
        crc,
        compressedSize,
        uncompressedSize,
        externalAttributes,
        localOffset,
      });
      position += 46 + variableLength;
    }

    if (position !== centralOffset + centralSize || directoryFileCount > limits.maxFiles) {
      throw backupError('INVALID_ARCHIVE');
    }
    if (!duplicateNames.has(MANIFEST_ENTRY) || !duplicateNames.has(DATABASE_ENTRY)) {
      throw backupError('INVALID_ARCHIVE');
    }

    const ranges = [];
    for (const entry of entries) {
      if (entry.localOffset + 30 > centralOffset) {
        throw backupError('INVALID_ARCHIVE');
      }
      const local = await readExactly(handle, 30, entry.localOffset);
      if (local.readUInt32LE(0) !== ZIP_LOCAL_SIGNATURE) {
        throw backupError('INVALID_ARCHIVE');
      }
      const localFlags = local.readUInt16LE(6);
      const localMethod = local.readUInt16LE(8);
      const localCrc = local.readUInt32LE(14);
      const localCompressed = local.readUInt32LE(18);
      const localUncompressed = local.readUInt32LE(22);
      const localNameLength = local.readUInt16LE(26);
      const localExtraLength = local.readUInt16LE(28);
      if (localFlags !== entry.flags || localMethod !== entry.method || localNameLength !== entry.rawName.length) {
        throw backupError('INVALID_ARCHIVE');
      }
      const localName = await readExactly(handle, localNameLength, entry.localOffset + 30);
      if (!localName.equals(entry.rawName)) {
        throw backupError('INVALID_ARCHIVE');
      }
      const localExtra = await readExactly(
        handle,
        localExtraLength,
        entry.localOffset + 30 + localNameLength
      );
      const localZip64 = readZip64Values(localExtra, {
        uncompressedSize: localUncompressed === ZIP64_UINT32,
        compressedSize: localCompressed === ZIP64_UINT32,
        localOffset: false,
        diskStart: false,
      });
      const resolvedLocalCompressed = localCompressed === ZIP64_UINT32
        ? localZip64.compressedSize
        : localCompressed;
      const resolvedLocalUncompressed = localUncompressed === ZIP64_UINT32
        ? localZip64.uncompressedSize
        : localUncompressed;
      const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataOffset + entry.compressedSize;
      if (!Number.isSafeInteger(dataEnd) || dataEnd > centralOffset) {
        throw backupError('INVALID_ARCHIVE');
      }
      let rangeEnd = dataEnd;
      if ((entry.flags & ZIP_DATA_DESCRIPTOR_FLAG) !== 0) {
        const marker = await readExactly(handle, 4, rangeEnd);
        const hasSignature = marker.readUInt32LE(0) === ZIP_DATA_DESCRIPTOR_SIGNATURE;
        let descriptorOffset = rangeEnd + (hasSignature ? 4 : 0);
        const usesZip64 = localCompressed === ZIP64_UINT32 || localUncompressed === ZIP64_UINT32 || entry.versionNeeded >= 45;
        const descriptorLength = usesZip64 ? 20 : 12;
        const descriptor = await readExactly(handle, descriptorLength, descriptorOffset);
        const descriptorCrc = descriptor.readUInt32LE(0);
        const descriptorCompressed = usesZip64 ? readUInt64Safe(descriptor, 4) : descriptor.readUInt32LE(4);
        const descriptorUncompressed = usesZip64 ? readUInt64Safe(descriptor, 12) : descriptor.readUInt32LE(8);
        if (
          descriptorCrc !== entry.crc ||
          descriptorCompressed !== entry.compressedSize ||
          descriptorUncompressed !== entry.uncompressedSize
        ) {
          throw backupError('INVALID_ARCHIVE');
        }
        rangeEnd = descriptorOffset + descriptorLength;
      } else if (
        localCrc !== entry.crc ||
        resolvedLocalCompressed !== entry.compressedSize ||
        resolvedLocalUncompressed !== entry.uncompressedSize
      ) {
        throw backupError('INVALID_ARCHIVE');
      }
      if (rangeEnd > centralOffset) {
        throw backupError('INVALID_ARCHIVE');
      }
      entry.dataOffset = dataOffset;
      entry.rangeEnd = rangeEnd;
      ranges.push({ start: entry.localOffset, end: rangeEnd });
    }
    ranges.sort((a, b) => a.start - b.start);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index].start < ranges[index - 1].end) {
        throw backupError('INVALID_ARCHIVE');
      }
    }

    return { handle, ownsHandle, entries, archiveStat: openedStat, payloadBytes };
  } catch (error) {
    if (ownsHandle && handle) await handle.close().catch(() => {});
    if (error instanceof DataBackupError) throw error;
    throw backupError('INVALID_ARCHIVE', error);
  }
}

async function consumeArchiveEntry(archive, entry, options = {}) {
  const hash = options.sha256 ? crypto.createHash('sha256') : null;
  const chunks = options.collect ? [] : null;
  let crc = 0xffffffff;
  let bytes = 0;
  const verifier = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > entry.uncompressedSize) {
        callback(backupError('INVALID_ARCHIVE'));
        return;
      }
      crc = updateCrc32(crc, chunk);
      if (hash) hash.update(chunk);
      if (chunks) chunks.push(Buffer.from(chunk));
      callback(null, chunk);
    },
  });

  let source;
  if (entry.compressedSize === 0) {
    source = Readable.from([]);
  } else {
    source = fs.createReadStream(null, {
      fd: archive.handle.fd,
      autoClose: false,
      start: entry.dataOffset,
      end: entry.dataOffset + entry.compressedSize - 1,
    });
  }
  const streams = [source];
  if (entry.method === 8) streams.push(zlib.createInflateRaw());
  streams.push(verifier);

  if (options.destination) {
    await fsp.mkdir(path.dirname(options.destination), { recursive: true, mode: 0o700 });
    streams.push(fs.createWriteStream(options.destination, { flags: 'wx', mode: 0o600 }));
  } else {
    streams.push(new Writable({ write(chunk, encoding, callback) { callback(); } }));
  }

  try {
    await pipeline(...streams);
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('INVALID_ARCHIVE', error);
  }
  if (bytes !== entry.uncompressedSize || finishCrc32(crc) !== entry.crc) {
    throw backupError('INVALID_ARCHIVE');
  }
  if (options.destination) await chmodPrivate(options.destination);
  return {
    bytes,
    buffer: chunks ? Buffer.concat(chunks, bytes) : null,
    sha256: hash ? hash.digest('hex') : null,
  };
}

module.exports = {
  consumeArchiveEntry,
  createCentralZip64Extra,
  createDescriptorArchive,
  createLocalZip64Extra,
  descriptorCall,
  descriptorHandle,
  descriptorPublicationMarker,
  descriptorRead,
  descriptorStat,
  dosDateTime,
  findEndOfCentralDirectory,
  finishCrc32,
  readArchiveDirectory,
  readExactly,
  readUInt64Safe,
  readZip64Values,
  sha256Descriptor,
  updateCrc32,
  writeAll,
  writeStoredZipEntry,
  writeZip64Archive,
  writeZip64ArchiveToHandle,
};
