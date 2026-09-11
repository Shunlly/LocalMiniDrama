// 项目导入 ZIP 解析编排：读取归档、延迟解压与 project.json 装配
const fs = require('fs');
const AdmZip = require('adm-zip');
const {
  importError,
  normalizeImportLimits,
  validateImportComplexity,
  validateZipEntryName,
} = require('./dramaImportValidation');
const {
  assertZipEntryCount,
  indexZipEntries,
  parseImportedProjectJsonData,
  takeProjectJsonEntry,
} = require('./dramaImportZip');

/**
 * 解析 ZIP Buffer，返回 project.json 内容和媒体文件 Map
 * @returns {{ data: object, files: Map<string,Buffer> }}
 */
function readArchiveBuffer(source, limits) {
  if (Buffer.isBuffer(source)) {
    if (source.length > limits.maxArchiveBytes) throw importError('ARCHIVE_TOO_LARGE', '压缩包不安全：上传文件超过大小限制');
    return source;
  }
  if (typeof source !== 'string' || !source) throw importError('INVALID_ARCHIVE', '压缩包不正确：缺少归档数据');
  let fd;
  try {
    const before = fs.lstatSync(source);
    if (before.isSymbolicLink() || !before.isFile()) throw importError('INVALID_ARCHIVE', '压缩包不安全：上传文件不是普通文件');
    if (before.size > limits.maxArchiveBytes) throw importError('ARCHIVE_TOO_LARGE', '压缩包不安全：上传文件超过大小限制');
    fd = fs.openSync(source, 'r');
    const opened = fs.fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw importError('ARCHIVE_CHANGED', '压缩包不安全：上传文件在读取时发生变化');
    }
    const buffer = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytes = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (bytes <= 0) throw importError('INVALID_ARCHIVE', '压缩包不正确：上传文件已截断');
      offset += bytes;
    }
    return buffer;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

class LazyZipFiles {
  constructor(entries, limits) {
    this.entries = entries;
    this.limits = limits;
    this.materializedBytes = 0;
    this.materializationBudget = limits.maxMaterializedBytes;
  }

  setMaterializationBudget(bytes) {
    this.materializationBudget = Math.max(0, Math.min(this.limits.maxMaterializedBytes, Number(bytes)));
  }

  read(name) {
    if (!name) return null;
    const safeName = validateZipEntryName(String(name), this.limits);
    const entry = this.entries.get(safeName);
    if (!entry) return null;
    let data;
    try { data = entry.getData(); }
    catch (error) { throw importError('INVALID_ARCHIVE', '压缩包损坏：条目无法安全解压', error); }
    if (!Buffer.isBuffer(data) || data.length !== Number(entry.header.size) || data.length > this.limits.maxEntryBytes) {
      throw importError('INVALID_ARCHIVE', '压缩包损坏：条目解压大小不一致');
    }
    return data;
  }

  reserveMaterialized(bytes) {
    this.materializedBytes += Number(bytes);
    if (!Number.isSafeInteger(this.materializedBytes) || this.materializedBytes > this.materializationBudget) {
      throw importError('MATERIALIZED_SIZE_LIMIT', '压缩包不安全：导入媒体超过磁盘写入预算');
    }
  }
}

function parseZip(zipSource, options = {}) {
  const limits = normalizeImportLimits(options.limits || options);
  const zipBuffer = readArchiveBuffer(zipSource, limits);
  let zip;
  try {
    zip = new AdmZip(zipBuffer, { readEntries: false });
  } catch (e) {
    throw importError('INVALID_ARCHIVE', '压缩包损坏，无法解析', e);
  }

  assertZipEntryCount(zip.getEntryCount(), limits);
  const { filesByName, totalUncompressedBytes } = indexZipEntries(zip.getEntries(), limits);
  const projectEntry = takeProjectJsonEntry(filesByName, limits);

  let projectData;
  try {
    projectData = projectEntry.getData();
  } catch (e) {
    throw importError('INVALID_PROJECT_JSON', '项目清单格式错误，无法解析', e);
  }
  const data = parseImportedProjectJsonData(projectData, projectEntry.header.size);

  const complexity = validateImportComplexity(data, limits);

  filesByName.delete('project.json');
  return {
    data,
    files: new LazyZipFiles(filesByName, limits),
    limits,
    archiveBytes: zipBuffer.length,
    totalUncompressedBytes,
    complexity,
  };
}

module.exports = {
  parseZip,
};
