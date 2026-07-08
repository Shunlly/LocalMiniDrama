const fs = require('fs');
const path = require('path');

const LEGACY_SET_IMMEDIATE_ALLOWLIST = {};

function normalizeRel(filePath) {
  return filePath.replace(/\\/g, '/');
}

function walkJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

function countSetImmediateUsages(rootDir = path.resolve(__dirname, '..', '..')) {
  const srcDir = path.join(rootDir, 'src');
  const counts = {};
  for (const file of walkJsFiles(srcDir)) {
    const rel = normalizeRel(path.relative(rootDir, file));
    const content = fs.readFileSync(file, 'utf8');
    const matches = content.match(/\bsetImmediate\s*\(/g);
    if (matches && matches.length) counts[rel] = matches.length;
  }
  return counts;
}

function auditLegacyAsyncEntrypoints(rootDir = path.resolve(__dirname, '..', '..')) {
  const counts = countSetImmediateUsages(rootDir);
  const issues = [];
  for (const [file, count] of Object.entries(counts)) {
    issues.push({ file, count, allowed: 0, message: 'raw setImmediate usage must use legacyAsyncSchedulerService' });
  }
  return {
    passed: issues.length === 0,
    counts,
    allowlist: LEGACY_SET_IMMEDIATE_ALLOWLIST,
    issues,
  };
}

module.exports = {
  LEGACY_SET_IMMEDIATE_ALLOWLIST,
  countSetImmediateUsages,
  auditLegacyAsyncEntrypoints,
};
