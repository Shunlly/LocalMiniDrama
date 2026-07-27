import fs from 'node:fs'
import path from 'node:path'

import { parse } from 'acorn'

const SOURCE_ROOTS = Object.freeze(['scripts', 'test'])
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs'])

// These roots contain authored cleanup consumers. Browser profiles and app source
// are outside the policy; generated or vendored directories nested here are not.
const EXCLUDED_DIRECTORIES = new Set([
  '.cache',
  '.vite',
  'artifacts',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
])
const EXCLUDED_SOURCES = new Set(['scripts/fixture-cleanup.cjs'])
const FS_MODULES = new Map([
  ['fs', 'fs'],
  ['node:fs', 'fs'],
  ['fs/promises', 'fsPromises'],
  ['node:fs/promises', 'fsPromises'],
])
const REMOVE_METHODS = new Set(['rm', 'rmSync'])

function compareText(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/')
}

function walkSourceDirectory(frontwebRoot, directory, files) {
  if (!fs.existsSync(directory)) return

  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name))

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        walkSourceDirectory(frontwebRoot, path.join(directory, entry.name), files)
      }
      continue
    }

    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue
    const absolutePath = path.join(directory, entry.name)
    const relativePath = normalizePath(path.relative(frontwebRoot, absolutePath))
    if (!EXCLUDED_SOURCES.has(relativePath)) files.push(relativePath)
  }
}

export function discoverCleanupSources(frontwebRoot) {
  const files = []
  for (const sourceRoot of SOURCE_ROOTS) {
    walkSourceDirectory(frontwebRoot, path.join(frontwebRoot, sourceRoot), files)
  }
  return files.sort(compareText)
}

function childNodes(node) {
  const children = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === 'string') children.push(item)
      }
    } else if (value && typeof value.type === 'string') {
      children.push(value)
    }
  }
  return children
}

function walkAst(root, visitor) {
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()
    visitor(node)
    const children = childNodes(node)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index])
    }
  }
}

function moduleReference(node) {
  if (
    node?.type !== 'CallExpression'
    || node.callee.type !== 'Identifier'
    || node.callee.name !== 'require'
    || node.arguments.length !== 1
    || node.arguments[0].type !== 'Literal'
    || typeof node.arguments[0].value !== 'string'
  ) {
    return null
  }
  return FS_MODULES.get(node.arguments[0].value) || null
}

function addReference(bindings, name, references) {
  if (!name || references.size === 0) return false
  const current = bindings.get(name) || new Set()
  let changed = false
  for (const reference of references) {
    if (!current.has(reference)) {
      current.add(reference)
      changed = true
    }
  }
  if (changed) bindings.set(name, current)
  return changed
}

function literalValue(node, initializers, seen = new Set()) {
  if (!node) return undefined
  if (node.type === 'Literal') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
  if (node.type === 'Identifier') {
    if (seen.has(node.name)) return undefined
    const candidates = initializers.get(node.name)
    if (!candidates || candidates.length !== 1) return undefined
    const nextSeen = new Set(seen)
    nextSeen.add(node.name)
    return literalValue(candidates[0], initializers, nextSeen)
  }
  if (node.type === 'UnaryExpression') {
    const argument = literalValue(node.argument, initializers, seen)
    if (node.operator === '!') return !argument
    if (node.operator === 'void') return undefined
  }
  return undefined
}

function propertyName(node, computed, initializers) {
  if (!computed && node.type === 'Identifier') return node.name
  const value = literalValue(node, initializers)
  return typeof value === 'string' ? value : null
}

function memberReferences(baseReferences, property) {
  const references = new Set()
  for (const baseReference of baseReferences) {
    if (baseReference === 'fs' && property === 'promises') references.add('fsPromises')
    if (baseReference === 'fs' && REMOVE_METHODS.has(property)) references.add(property)
    if (baseReference === 'fsPromises' && property === 'rm') references.add('rm')
  }
  return references
}

function resolveReferences(node, bindings, initializers) {
  if (!node) return new Set()
  if (node.type === 'ChainExpression') {
    return resolveReferences(node.expression, bindings, initializers)
  }
  if (node.type === 'Identifier') {
    return new Set(bindings.get(node.name) || [])
  }

  const requiredModule = moduleReference(node)
  if (requiredModule) return new Set([requiredModule])

  if (node.type === 'MemberExpression') {
    const property = propertyName(node.property, node.computed, initializers)
    if (!property) return new Set()
    return memberReferences(
      resolveReferences(node.object, bindings, initializers),
      property,
    )
  }

  if (
    node.type === 'CallExpression'
    && node.callee.type === 'MemberExpression'
    && propertyName(node.callee.property, node.callee.computed, initializers) === 'bind'
  ) {
    return resolveReferences(node.callee.object, bindings, initializers)
  }

  return new Set()
}

function bindPattern(pattern, references, bindings, initializers) {
  if (!pattern || references.size === 0) return false
  if (pattern.type === 'Identifier') {
    return addReference(bindings, pattern.name, references)
  }
  if (pattern.type === 'AssignmentPattern') {
    return bindPattern(pattern.left, references, bindings, initializers)
  }
  if (pattern.type !== 'ObjectPattern') return false

  let changed = false
  for (const property of pattern.properties) {
    if (property.type !== 'Property') continue
    const key = propertyName(property.key, property.computed, initializers)
    if (!key) continue
    const propertyReferences = memberReferences(references, key)
    changed = bindPattern(
      property.value,
      propertyReferences,
      bindings,
      initializers,
    ) || changed
  }
  return changed
}

function collectBindings(ast) {
  const bindings = new Map()
  const initializers = new Map()
  const assignments = []

  walkAst(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      const moduleKind = FS_MODULES.get(node.source.value)
      if (!moduleKind) return
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier') {
          const importedName = specifier.imported.name || specifier.imported.value
          const references = memberReferences(new Set([moduleKind]), importedName)
          addReference(bindings, specifier.local.name, references)
        } else {
          addReference(bindings, specifier.local.name, new Set([moduleKind]))
        }
      }
      return
    }

    if (node.type === 'VariableDeclarator' && node.init) {
      assignments.push({ pattern: node.id, value: node.init })
      if (node.id.type === 'Identifier') {
        const candidates = initializers.get(node.id.name) || []
        candidates.push(node.init)
        initializers.set(node.id.name, candidates)
      }
      return
    }

    if (node.type === 'AssignmentExpression' && node.operator === '=') {
      assignments.push({ pattern: node.left, value: node.right })
    }
  })

  for (let pass = 0; pass <= assignments.length; pass += 1) {
    let changed = false
    for (const { pattern, value } of assignments) {
      const references = resolveReferences(value, bindings, initializers)
      changed = bindPattern(pattern, references, bindings, initializers) || changed
    }
    if (!changed) break
  }

  return { bindings, initializers }
}

function expressionCanBeTrue(node, initializers, seen) {
  const literal = literalValue(node, initializers, seen)
  if (literal !== undefined) return literal === true
  if (!node) return false
  if (node.type === 'LogicalExpression' || node.type === 'ConditionalExpression') {
    return childNodes(node).some((child) => expressionCanBeTrue(child, initializers, seen))
  }
  return false
}

function containsRecursiveTrue(node, initializers, seen = new Set()) {
  if (!node) return false
  if (node.type === 'Identifier') {
    if (seen.has(node.name)) return false
    const candidates = initializers.get(node.name) || []
    const nextSeen = new Set(seen)
    nextSeen.add(node.name)
    return candidates.some((candidate) => containsRecursiveTrue(candidate, initializers, nextSeen))
  }
  if (node.type === 'ChainExpression') {
    return containsRecursiveTrue(node.expression, initializers, seen)
  }
  if (node.type === 'ObjectExpression') {
    return node.properties.some((property) => {
      if (property.type === 'SpreadElement') {
        return containsRecursiveTrue(property.argument, initializers, seen)
      }
      const key = propertyName(property.key, property.computed, initializers)
      return key === 'recursive' && expressionCanBeTrue(property.value, initializers, seen)
    })
  }
  if (
    node.type === 'CallExpression'
    && node.callee.type === 'MemberExpression'
    && node.callee.object.type === 'Identifier'
    && node.callee.object.name === 'Object'
    && ['assign', 'freeze'].includes(propertyName(node.callee.property, node.callee.computed, initializers))
  ) {
    return node.arguments.some((argument) => containsRecursiveTrue(argument, initializers, seen))
  }
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
    return childNodes(node).some((child) => containsRecursiveTrue(child, initializers, seen))
  }
  return false
}

function parseSource(source, relativePath) {
  const extension = path.extname(relativePath)
  return parse(source, {
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
    allowReturnOutsideFunction: extension === '.cjs',
    ecmaVersion: 'latest',
    locations: true,
    sourceType: extension === '.cjs' ? 'script' : 'module',
  })
}

function findDirectRecursiveRemovals(source, relativePath) {
  const ast = parseSource(source, relativePath)
  const { bindings, initializers } = collectBindings(ast)
  const violations = []

  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression' || node.arguments.length < 2) return
    const methods = resolveReferences(node.callee, bindings, initializers)
    const method = [...methods].find((reference) => REMOVE_METHODS.has(reference))
    if (!method || !containsRecursiveTrue(node.arguments[1], initializers)) return
    violations.push({
      file: relativePath,
      line: node.loc.start.line,
      column: node.loc.start.column + 1,
      method,
    })
  })

  return violations
}

export function auditCleanupSources(frontwebRoot) {
  const files = discoverCleanupSources(frontwebRoot)
  const violations = files.flatMap((relativePath) => {
    const absolutePath = path.join(frontwebRoot, ...relativePath.split('/'))
    return findDirectRecursiveRemovals(
      fs.readFileSync(absolutePath, 'utf8'),
      relativePath,
    )
  })
  violations.sort((left, right) => (
    compareText(left.file, right.file)
    || left.line - right.line
    || left.column - right.column
    || compareText(left.method, right.method)
  ))
  return { files, violations }
}
