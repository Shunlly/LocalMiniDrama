import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const srcRoot = path.resolve(import.meta.dirname, '../src')

function resolveAlias(rest) {
  const base = path.join(srcRoot, rest)
  const candidates = [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return pathToFileURL(candidate).href
      }
    } catch (_) {}
  }
  return pathToFileURL(`${base}.js`).href
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return {
      shortCircuit: true,
      url: resolveAlias(specifier.slice(2)),
    }
  }
  return nextResolve(specifier, context)
}
