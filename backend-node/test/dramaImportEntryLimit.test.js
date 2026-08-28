const test = require('node:test');
const assert = require('node:assert/strict');

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;
const ZIP64_EOCD_SIZE = 56;
const ZIP64_LOCATOR_SIZE = 20;

function makeStoredZip(entryCount) {
  const names = Array.from(
    { length: entryCount },
    (_, index) => Buffer.from(`f${String(index).padStart(4, '0')}`, 'ascii')
  );
  const localSize = names.reduce((total, name) => total + LOCAL_HEADER_SIZE + name.length, 0);
  const centralSize = names.reduce((total, name) => total + CENTRAL_HEADER_SIZE + name.length, 0);
  const archive = Buffer.alloc(localSize + centralSize + EOCD_SIZE);
  let localOffset = 0;
  let centralOffset = localSize;

  for (const name of names) {
    archive.writeUInt32LE(0x04034b50, localOffset);
    archive.writeUInt16LE(20, localOffset + 4);
    archive.writeUInt16LE(name.length, localOffset + 26);
    name.copy(archive, localOffset + LOCAL_HEADER_SIZE);

    archive.writeUInt32LE(0x02014b50, centralOffset);
    archive.writeUInt16LE(20, centralOffset + 4);
    archive.writeUInt16LE(20, centralOffset + 6);
    archive.writeUInt16LE(name.length, centralOffset + 28);
    archive.writeUInt32LE(localOffset, centralOffset + 42);
    name.copy(archive, centralOffset + CENTRAL_HEADER_SIZE);

    localOffset += LOCAL_HEADER_SIZE + name.length;
    centralOffset += CENTRAL_HEADER_SIZE + name.length;
  }

  archive.writeUInt32LE(0x06054b50, centralOffset);
  archive.writeUInt16LE(entryCount, centralOffset + 8);
  archive.writeUInt16LE(entryCount, centralOffset + 10);
  archive.writeUInt32LE(centralSize, centralOffset + 12);
  archive.writeUInt32LE(localSize, centralOffset + 16);
  return archive;
}

function makeForgedEocd(entryCount) {
  const archive = Buffer.alloc(EOCD_SIZE);
  archive.writeUInt32LE(0x06054b50, 0);
  archive.writeUInt16LE(entryCount, 8);
  archive.writeUInt16LE(entryCount, 10);
  return archive;
}

function makeForgedZip64Eocd(entryCount) {
  const archive = Buffer.alloc(ZIP64_EOCD_SIZE + ZIP64_LOCATOR_SIZE + EOCD_SIZE);
  const locatorOffset = ZIP64_EOCD_SIZE;
  const eocdOffset = locatorOffset + ZIP64_LOCATOR_SIZE;

  archive.writeUInt32LE(0x06064b50, 0);
  archive.writeBigUInt64LE(44n, 4);
  archive.writeUInt16LE(45, 12);
  archive.writeUInt16LE(45, 14);
  archive.writeBigUInt64LE(BigInt(entryCount), 24);
  archive.writeBigUInt64LE(BigInt(entryCount), 32);

  archive.writeUInt32LE(0x07064b50, locatorOffset);
  archive.writeBigUInt64LE(0n, locatorOffset + 8);
  archive.writeUInt32LE(1, locatorOffset + 16);

  archive.writeUInt32LE(0x06054b50, eocdOffset);
  archive.writeUInt16LE(0xffff, eocdOffset + 8);
  archive.writeUInt16LE(0xffff, eocdOffset + 10);
  archive.writeUInt32LE(0xffffffff, eocdOffset + 12);
  archive.writeUInt32LE(0xffffffff, eocdOffset + 16);
  return archive;
}

function makeFourGigabyteEntryDeclaration() {
  const name = Buffer.from('project.json', 'ascii');
  const localOffset = 0;
  const dataOffset = LOCAL_HEADER_SIZE + name.length;
  const centralOffset = dataOffset + 1;
  const eocdOffset = centralOffset + CENTRAL_HEADER_SIZE + name.length;
  const archive = Buffer.alloc(eocdOffset + EOCD_SIZE);

  archive.writeUInt32LE(0x04034b50, localOffset);
  archive.writeUInt16LE(20, localOffset + 4);
  archive.writeUInt32LE(1, localOffset + 18);
  archive.writeUInt32LE(0xffffffff, localOffset + 22);
  archive.writeUInt16LE(name.length, localOffset + 26);
  name.copy(archive, localOffset + LOCAL_HEADER_SIZE);
  archive[dataOffset] = 0;

  archive.writeUInt32LE(0x02014b50, centralOffset);
  archive.writeUInt16LE(20, centralOffset + 4);
  archive.writeUInt16LE(20, centralOffset + 6);
  archive.writeUInt32LE(1, centralOffset + 20);
  archive.writeUInt32LE(0xffffffff, centralOffset + 24);
  archive.writeUInt16LE(name.length, centralOffset + 28);
  archive.writeUInt32LE(localOffset, centralOffset + 42);
  name.copy(archive, centralOffset + CENTRAL_HEADER_SIZE);

  archive.writeUInt32LE(0x06054b50, eocdOffset);
  archive.writeUInt16LE(1, eocdOffset + 8);
  archive.writeUInt16LE(1, eocdOffset + 10);
  archive.writeUInt32LE(CENTRAL_HEADER_SIZE + name.length, eocdOffset + 12);
  archive.writeUInt32LE(centralOffset, eocdOffset + 16);
  return archive;
}

function withObservedAdmZip(run) {
  const admZipPath = require.resolve('adm-zip');
  const servicePath = require.resolve('../src/services/dramaImportService');
  const RealAdmZip = require(admZipPath);
  const admZipModule = require.cache[admZipPath];
  const originalExport = admZipModule.exports;
  const observation = {
    constructorOptions: [],
    entryCounts: [],
    getEntriesCalls: 0,
  };

  function ObservedAdmZip(input, options) {
    observation.constructorOptions.push(options);
    const zip = new RealAdmZip(input, options);
    const getEntryCount = zip.getEntryCount.bind(zip);
    zip.getEntryCount = () => {
      const count = getEntryCount();
      observation.entryCounts.push(count);
      return count;
    };
    zip.getEntries = () => {
      observation.getEntriesCalls += 1;
      throw new Error('ZIP entries were materialized before the count gate');
    };
    return zip;
  }

  admZipModule.exports = ObservedAdmZip;
  delete require.cache[servicePath];
  try {
    return run(require(servicePath), observation);
  } finally {
    delete require.cache[servicePath];
    admZipModule.exports = originalExport;
  }
}

function assertRejectedBeforeMaterialization(archive, expectedCount) {
  withObservedAdmZip((dramaImportService, observation) => {
    assert.throws(
      () => dramaImportService.parseZip(archive),
      (error) => error?.code === 'ENTRY_LIMIT_EXCEEDED'
    );
    assert.deepEqual(observation.entryCounts, [expectedCount]);
    assert.equal(observation.getEntriesCalls, 0);
    assert.equal(observation.constructorOptions.length, 1);
    assert.equal(observation.constructorOptions[0]?.readEntries, false);
  });
}

test('rejects a valid 5001-entry ZIP before materializing central-directory entries', () => {
  assertRejectedBeforeMaterialization(makeStoredZip(5001), 5001);
});

test('rejects forged classic and ZIP64 high entry declarations before materialization', async (t) => {
  await t.test('classic EOCD declaration', () => {
    assertRejectedBeforeMaterialization(makeForgedEocd(5001), 5001);
  });
  await t.test('ZIP64 EOCD declaration', () => {
    assertRejectedBeforeMaterialization(makeForgedZip64Eocd(5001), 5001);
  });
});

test('rejects a forged four-gigabyte entry declaration without allocating its payload', () => {
  const { parseZip } = require('../src/services/dramaImportService');
  assert.throws(
    () => parseZip(makeFourGigabyteEntryDeclaration()),
    (error) => error?.code === 'ENTRY_SIZE_LIMIT' || error?.code === 'INVALID_ARCHIVE'
  );
});
