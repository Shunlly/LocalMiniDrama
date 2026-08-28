/**
 * Element Plus 按需加载：把组件/反馈 API 指到独立入口，并把图标 barrel 拆成单图标模块。
 * 这样首屏只会带上真实用到的实现，而不会为了数字裁掉功能。
 */
import fs from 'node:fs'
import path from 'node:path'

export const ELEMENT_PLUS_ICONS_ENTRY = 'virtual:element-plus-icons-entry'
export const ELEMENT_PLUS_ICON_PREFIX = 'virtual:element-plus-icon/'

const ELEMENT_PLUS_BARREL_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*(['"])element-plus(?:\/es)?\2/g

const DIRECTIVE_RESOLVERS = Object.freeze({
  Loading: { importName: 'ElLoadingDirective', dir: 'loading' },
  Popover: { importName: 'ElPopoverDirective', dir: 'popover' },
  InfiniteScroll: { importName: 'ElInfiniteScroll', dir: 'infinite-scroll' },
})

export function buildElementPlusComponentMap(componentsRoot) {
  const map = new Map()
  for (const entry of fs.readdirSync(componentsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const indexPath = path.join(componentsRoot, entry.name, 'index.mjs')
    if (!fs.existsSync(indexPath)) continue
    const source = fs.readFileSync(indexPath, 'utf8')
    for (const block of source.matchAll(/export\s*\{([^}]+)\}/g)) {
      for (const spec of block[1].split(',')) {
        const text = spec.trim()
        if (!text) continue
        const parts = text.split(/\s+as\s+/).map((item) => item.trim())
        const exported = parts[parts.length - 1]
        if (!exported || exported === 'default') continue
        if (!map.has(exported)) map.set(exported, entry.name)
      }
    }
  }
  return map
}

export function getElementPlusStyleSideEffects(dir, componentsRoot) {
  const styleFile = path.join(componentsRoot, dir, 'style', 'css.mjs')
  if (!fs.existsSync(styleFile)) return undefined
  return [
    'element-plus/es/components/base/style/css',
    `element-plus/es/components/${dir}/style/css`,
  ]
}

export function createElementPlusResolvers(componentMap, componentsRoot) {
  return [
    {
      type: 'component',
      resolve(name) {
        if (/^ElIcon[A-Z]/.test(name)) {
          return {
            name: name.slice(6),
            from: '@element-plus/icons-vue',
          }
        }
        const dir = componentMap.get(name)
        if (!dir) return
        return {
          name,
          from: `element-plus/es/components/${dir}/index.mjs`,
          sideEffects: getElementPlusStyleSideEffects(dir, componentsRoot),
        }
      },
    },
    {
      type: 'directive',
      resolve(name) {
        const mapping = DIRECTIVE_RESOLVERS[name]
        if (!mapping) return
        return {
          name: mapping.importName,
          from: `element-plus/es/components/${mapping.dir}/index.mjs`,
          sideEffects: getElementPlusStyleSideEffects(mapping.dir, componentsRoot),
        }
      },
    },
  ]
}

export function rewriteElementPlusBarrelImports(code, componentMap, componentsRoot) {
  return code.replace(ELEMENT_PLUS_BARREL_IMPORT_RE, (full, specifiers, quote) => {
    const specs = specifiers.split(',').map((item) => item.trim()).filter(Boolean)
    if (!specs.length) return full
    const lines = []
    const styleDirs = new Set()
    for (const spec of specs) {
      const [imported, alias] = spec.split(/\s+as\s+/).map((item) => item.trim())
      const dir = componentMap.get(imported)
      if (!dir) {
        throw new Error(`未配置按需映射的 Element Plus 导出: ${imported}`)
      }
      const aliased = alias ? ` as ${alias}` : ''
      lines.push(`import { ${imported}${aliased} } from ${quote}element-plus/es/components/${dir}/index.mjs${quote}`)
      styleDirs.add(dir)
    }
    for (const dir of styleDirs) {
      if (getElementPlusStyleSideEffects(dir, componentsRoot)) {
        lines.push(`import ${quote}element-plus/es/components/${dir}/style/css${quote}`)
      }
    }
    return lines.join('\n')
  })
}

export function parseElementPlusIconModules(indexSource) {
  const exportBlockStart = indexSource.lastIndexOf('export {')
  if (exportBlockStart < 0) {
    throw new Error('无法解析 @element-plus/icons-vue 的导出列表')
  }
  const exportBlock = indexSource.slice(exportBlockStart)
  const implementations = indexSource.slice(0, exportBlockStart)
  const parts = implementations.split('// src/components/').slice(1)
  const bodiesBySnake = new Map()
  for (const part of parts) {
    const newline = part.indexOf('\n')
    const body = newline === -1 ? part : part.slice(newline + 1)
    const match = body.match(/([a-z0-9_]+)_default = _sfc_main/)
    if (!match) {
      throw new Error(`无法解析图标实现: ${part.slice(0, 80)}`)
    }
    bodiesBySnake.set(match[1], body.trim())
  }
  const modules = new Map()
  for (const [, snake, pascal] of exportBlock.matchAll(/([a-z0-9_]+)_default as ([A-Z][A-Za-z0-9]+)/g)) {
    const body = bodiesBySnake.get(snake)
    if (!body) throw new Error(`缺少图标实现: ${pascal}`)
    modules.set(pascal, `${body}\nexport default ${snake}_default;\n`)
  }
  if (!modules.size) throw new Error('@element-plus/icons-vue 未解析到任何图标')
  return modules
}

function normalizeId(id) {
  return String(id || '').replace(/\\/g, '/')
}

function isIconsPackageEntry(source) {
  const normalized = normalizeId(source)
  return (
    source === '@element-plus/icons-vue'
    || normalized.endsWith('/@element-plus/icons-vue/dist/index.js')
    || normalized.endsWith('/@element-plus/icons-vue/index.js')
  )
}

function isAppSourceId(id) {
  const normalized = normalizeId(id)
  if (normalized.includes('/node_modules/')) return false
  return normalized.includes('/src/') && /\.(?:js|mjs|cjs|ts|vue)(?:\?|$)/.test(normalized)
}

export function createElementPlusIconsPlugin(iconsIndexPath) {
  const iconModules = parseElementPlusIconModules(fs.readFileSync(iconsIndexPath, 'utf8'))
  const entryCode = [...iconModules.keys()]
    .sort()
    .map((name) => `export { default as ${name} } from '${ELEMENT_PLUS_ICON_PREFIX}${name}'`)
    .join('\n')

  return {
    name: 'element-plus-icons-ondemand',
    enforce: 'pre',
    resolveId(source) {
      if (isIconsPackageEntry(source)) return `\0${ELEMENT_PLUS_ICONS_ENTRY}`
      const normalized = normalizeId(source)
      if (normalized === ELEMENT_PLUS_ICON_PREFIX || normalized === `\0${ELEMENT_PLUS_ICON_PREFIX}`) return null
      if (normalized.startsWith(ELEMENT_PLUS_ICON_PREFIX)) return `\0${normalized}`
      if (normalized.startsWith(`\0${ELEMENT_PLUS_ICON_PREFIX}`)) return normalized
      return null
    },
    load(id) {
      const normalized = normalizeId(id)
      if (normalized === `\0${ELEMENT_PLUS_ICONS_ENTRY}`) return entryCode
      const prefix = `\0${ELEMENT_PLUS_ICON_PREFIX}`
      if (!normalized.startsWith(prefix)) return null
      const name = normalized.slice(prefix.length)
      const code = iconModules.get(name)
      if (!code) throw new Error(`未知的 Element Plus 图标: ${name}`)
      return code
    },
  }
}

export function createElementPlusImportPlugin(componentMap, componentsRoot) {
  return {
    name: 'element-plus-barrel-ondemand',
    enforce: 'post',
    transform(code, id) {
      if (!isAppSourceId(id) || !code.includes('element-plus')) return null
      const next = rewriteElementPlusBarrelImports(code, componentMap, componentsRoot)
      if (next === code) return null
      return { code: next, map: null }
    },
  }
}

export function createElementPlusOnDemandPlugins({ componentMap, componentsRoot, iconsIndexPath }) {
  return [
    createElementPlusIconsPlugin(iconsIndexPath),
    createElementPlusImportPlugin(componentMap, componentsRoot),
  ]
}
