const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const repoRoot = path.resolve(__dirname, '..')

function loadYaml() {
  const packageCandidates = [
    path.join(repoRoot, 'backend-node', 'package.json'),
    path.join(process.cwd(), 'package.json'),
  ]
  for (const packagePath of packageCandidates) {
    if (!fs.existsSync(packagePath)) continue
    try {
      return createRequire(packagePath)('js-yaml')
    } catch (_) {}
  }
  throw new Error('js-yaml is required to sanitize the runtime configuration')
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value, fallback = '', maxLength = 2048) {
  const normalized = String(value ?? '').trim()
  return (normalized || fallback).slice(0, maxLength)
}

function number(value, fallback, minimum = 0) {
  const normalized = Number(value)
  return Number.isFinite(normalized) && normalized >= minimum ? normalized : fallback
}

function boolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function safeRelativePath(value, fallback) {
  const normalized = text(value, fallback, 512).replace(/\\/g, '/')
  if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) return fallback
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.')
  if (!segments.length || segments.some((segment) => segment === '..')) return fallback
  return `./${segments.join('/')}`
}

function safeHttpUrl(value, fallback) {
  const normalized = text(value, fallback, 2048)
  try {
    const parsed = new URL(normalized)
    if (!['http:', 'https:'].includes(parsed.protocol)) return fallback
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return fallback
    return parsed.toString().replace(/\/$/, '')
  } catch (_) {
    return fallback
  }
}

function safeOrigins(value) {
  const origins = Array.isArray(value) ? value : []
  return [...new Set(origins.map((entry) => safeHttpUrl(entry, '')).filter(Boolean))].slice(0, 32)
}

function safeBasename(value, fallback) {
  const normalized = text(value, fallback, 255)
  return path.basename(normalized) === normalized ? normalized : fallback
}

function sanitizeRuntimeConfig(input = {}) {
  const source = asObject(input)
  const app = asObject(source.app)
  const server = asObject(source.server)
  const database = asObject(source.database)
  const storage = asObject(source.storage)
  const video = asObject(source.video)
  const ai = asObject(source.ai)
  const style = asObject(source.style)
  const vendorLock = asObject(source.vendor_lock)
  const imageProxy = asObject(source.image_proxy)

  return {
    app: {
      name: text(app.name, 'LocalMiniDrama API', 128),
      version: text(app.version, '0.0.0', 32),
      debug: false,
      language: text(app.language, 'zh', 16),
    },
    server: {
      port: number(server.port, 5679, 1),
      host: '127.0.0.1',
      cors_origins: safeOrigins(server.cors_origins),
      read_timeout: number(server.read_timeout, 600, 1),
      write_timeout: number(server.write_timeout, 600, 1),
    },
    database: {
      type: 'sqlite',
      path: safeRelativePath(database.path, './data/drama_generator.db'),
      max_idle: number(database.max_idle, 10, 0),
      max_open: number(database.max_open, 100, 1),
    },
    storage: {
      type: 'local',
      local_path: safeRelativePath(storage.local_path, './data/storage'),
      base_url: safeHttpUrl(storage.base_url, 'http://localhost:5679/static'),
      upload_disk_reserve_bytes: number(storage.upload_disk_reserve_bytes, 536870912, 0),
    },
    video: {
      generation_timeout_minutes: number(video.generation_timeout_minutes, 30, 1),
    },
    ai: {
      default_text_provider: text(ai.default_text_provider, 'openai', 64),
      default_image_provider: text(ai.default_image_provider, 'openai', 64),
      default_video_provider: text(ai.default_video_provider, 'openai', 64),
    },
    style: {
      default_style: text(style.default_style, '', 4096),
      default_role_style: text(style.default_role_style, '', 4096),
      default_scene_style: text(style.default_scene_style, '', 4096),
      default_prop_style: text(style.default_prop_style, '', 4096),
      default_image_ratio: text(style.default_image_ratio, '16:9', 16),
      default_video_ratio: text(style.default_video_ratio, '16:9', 16),
      default_prop_ratio: text(style.default_prop_ratio, '1:1', 16),
      default_image_size: text(style.default_image_size, '1024x1024', 32),
    },
    vendor_lock: {
      enabled: false,
      config_file: safeBasename(vendorLock.config_file, 'ai-configs.json'),
    },
    image_proxy: {
      expire_hours: number(imageProxy.expire_hours, 2, 1),
      use_for_video: boolean(imageProxy.use_for_video, false),
      upload_url: '',
      upload_timeout_seconds: number(imageProxy.upload_timeout_seconds, 180, 1),
      upload_max_attempts: number(imageProxy.upload_max_attempts, 2, 1),
    },
  }
}

function sanitizeRuntimeConfigFile(sourcePath, destinationPath) {
  const yaml = loadYaml()
  const parsed = yaml.load(fs.readFileSync(sourcePath, 'utf8'))
  const sanitized = sanitizeRuntimeConfig(parsed)
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  fs.writeFileSync(destinationPath, yaml.dump(sanitized, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }), { encoding: 'utf8', flag: 'w' })
  return sanitized
}

module.exports = { sanitizeRuntimeConfig, sanitizeRuntimeConfigFile }

if (require.main === module) {
  try {
    const [sourcePath, destinationPath] = process.argv.slice(2)
    if (!sourcePath || !destinationPath) {
      throw new Error('usage: node runtime-config-policy.cjs <source.yaml> <destination.yaml>')
    }
    sanitizeRuntimeConfigFile(path.resolve(sourcePath), path.resolve(destinationPath))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
