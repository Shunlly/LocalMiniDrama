const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const roots = process.argv.slice(2)
const startDirs = roots.length ? roots : ['src', 'test', 'scripts']
const skipDirs = new Set(['node_modules', 'dist', 'coverage'])

function walk(dir, files) {
  if (!fs.existsSync(dir)) return
  const stat = fs.statSync(dir)
  if (stat.isFile()) {
    if (dir.endsWith('.js') || dir.endsWith('.cjs') || dir.endsWith('.mjs')) files.push(dir)
    return
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue
    walk(path.join(dir, entry.name), files)
  }
}

const files = []
for (const dir of startDirs) walk(path.resolve(process.cwd(), dir), files)

let failed = false
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  if (result.status !== 0) failed = true
}

if (failed) process.exit(1)
console.log(`Checked ${files.length} JavaScript files.`)
