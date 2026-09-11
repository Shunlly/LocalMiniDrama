// 项目导入 ZIP 解析：条目类型、重名、压缩方式、大小限制与清单读取
const { importError, validateZipEntryName } = require('./dramaImportValidation');

function assertRegularZipEntry(entry) {
  const attributes = Number(entry.attr || 0) >>> 0;
  const unixMode = (attributes >>> 16) & 0xffff;
  const fileType = unixMode & 0xf000;
  if (!entry.isDirectory && fileType !== 0 && fileType !== 0x8000) {
    throw importError('UNSAFE_ARCHIVE_ENTRY', '压缩包不安全：不允许符号链接或特殊文件');
  }
}

function assertZipEntryCount(entryCount, limits) {
  if (!Number.isSafeInteger(entryCount) || entryCount < 1 || entryCount > limits.maxEntries) {
    throw importError('ENTRY_LIMIT_EXCEEDED', '压缩包不安全：条目数量超过限制');
  }
}

function zipEntryCollisionKey(name) {
  return name.normalize('NFC').toLowerCase();
}

function rememberZipEntryName(name, collisionNames) {
  const collisionKey = zipEntryCollisionKey(name);
  if (collisionNames.has(collisionKey)) {
    throw importError('DUPLICATE_ARCHIVE_PATH', '压缩包不安全：存在重复条目路径');
  }
  collisionNames.add(collisionKey);
}

function assertZipFileEntryLimits(entry, limits) {
  const size = Number(entry.header.size);
  const compressedSize = Number(entry.header.compressedSize);
  const method = Number(entry.header.method);
  if ((Number(entry.header.flags) & 0x0001) !== 0 || ![0, 8].includes(method)) {
    throw importError('UNSUPPORTED_ARCHIVE', '压缩包不安全：不支持加密或未知压缩算法');
  }
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(compressedSize) || size < 0 || compressedSize < 0 || size > limits.maxEntryBytes) {
    throw importError('ENTRY_SIZE_LIMIT', '压缩包不安全：单个条目超过大小限制');
  }
  if (size > 0 && compressedSize === 0) throw importError('INVALID_ARCHIVE', '压缩包不安全：压缩条目大小无效');
  if (compressedSize > 0 && size / compressedSize > limits.maxCompressionRatio) {
    throw importError('COMPRESSION_RATIO_LIMIT', '压缩包不安全：条目压缩率超过限制');
  }
  return size;
}

function accumulateZipUncompressedBytes(totalUncompressedBytes, size, limits) {
  const next = totalUncompressedBytes + size;
  if (!Number.isSafeInteger(next) || next > limits.maxTotalUncompressedBytes) {
    throw importError('TOTAL_SIZE_LIMIT', '压缩包不安全：解压总量超过限制');
  }
  return next;
}

function indexZipEntries(entries, limits) {
  const filesByName = new Map();
  const collisionNames = new Set();
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    assertRegularZipEntry(entry);
    const name = validateZipEntryName(entry.entryName, limits, entry.isDirectory);
    rememberZipEntryName(name, collisionNames);
    if (entry.isDirectory) continue;
    const size = assertZipFileEntryLimits(entry, limits);
    totalUncompressedBytes = accumulateZipUncompressedBytes(totalUncompressedBytes, size, limits);
    filesByName.set(name, entry);
  }
  return { filesByName, totalUncompressedBytes };
}

function takeProjectJsonEntry(filesByName, limits) {
  const projectEntry = filesByName.get('project.json');
  if (!projectEntry) {
    throw importError('PROJECT_JSON_MISSING', '压缩包不正确：缺少项目清单');
  }
  if (Number(projectEntry.header.size) > limits.maxProjectJsonBytes) {
    throw importError('PROJECT_JSON_TOO_LARGE', '压缩包不安全：项目清单超过大小限制');
  }
  return projectEntry;
}

function parseImportedProjectJsonData(projectData, declaredSize) {
  let data;
  try {
    if (projectData.length !== Number(declaredSize)) throw new Error('项目包大小与清单不一致，请重新导出后导入');
    data = JSON.parse(projectData.toString('utf8'));
  } catch (e) {
    throw importError('INVALID_PROJECT_JSON', '项目清单格式错误，无法解析', e);
  }

  if (!data.drama || !data.drama.title) {
    throw new Error('项目文件格式不正确：缺少剧名');
  }
  return data;
}

module.exports = {
  assertRegularZipEntry,
  assertZipEntryCount,
  indexZipEntries,
  parseImportedProjectJsonData,
  takeProjectJsonEntry,
};
