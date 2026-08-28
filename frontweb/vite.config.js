import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import {
  buildElementPlusComponentMap,
  createElementPlusOnDemandPlugins,
  createElementPlusResolvers,
} from './scripts/elementPlusOnDemand.js'

const require = createRequire(import.meta.url)
const { createRuntimeInstanceId } = require('../backend-node/src/utils/runtimeInstanceId.js')
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))
const elementPlusComponentsRoot = fileURLToPath(new URL('./node_modules/element-plus/es/components/', import.meta.url))
const elementPlusIconsIndex = fileURLToPath(new URL('./node_modules/@element-plus/icons-vue/dist/index.js', import.meta.url))
const elementPlusComponentMap = buildElementPlusComponentMap(elementPlusComponentsRoot)
const frontendPackage = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
)

process.env.VITE_LOCALMINIDRAMA_VERSION = frontendPackage.version
process.env.VITE_LOCALMINIDRAMA_INSTANCE_ID = createRuntimeInstanceId({
  rootDirectory: workspaceRoot,
})

const backendProxyTarget = process.env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:5679'
const devServerHost = process.env.VITE_DEV_SERVER_HOST || '127.0.0.1'

export default defineConfig({
  plugins: [
    vue(),
    Components({
      directives: true,
      dts: false,
      resolvers: createElementPlusResolvers(elementPlusComponentMap, elementPlusComponentsRoot),
    }),
    ...createElementPlusOnDemandPlugins({
      componentMap: elementPlusComponentMap,
      componentsRoot: elementPlusComponentsRoot,
      iconsIndexPath: elementPlusIconsIndex,
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  optimizeDeps: {
    exclude: ['@element-plus/icons-vue'],
    include: [
      'vue',
      'vue-router',
      'pinia',
      'element-plus/es/components/config-provider/index.mjs',
      'element-plus/es/locale/lang/zh-cn.mjs',
    ],
    entries: [
      'index.html',
      'src/**/*.js',
      'src/**/*.vue',
    ],
  },
  server: {
    host: devServerHost,
    port: 3013,
    strictPort: true,
    proxy: {
      '/health': {
        target: backendProxyTarget,
        changeOrigin: true,
      },
      '/ready': {
        target: backendProxyTarget,
        changeOrigin: true,
      },
      '/api': {
        target: backendProxyTarget,
        changeOrigin: true,
        proxyTimeout: 600000,
        timeout: 600000
      },
      '/static': {
        target: backendProxyTarget,
        changeOrigin: true
      }
    }
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')
          if (/\/src\/utils\/(?:canvasHistory|canvasLayout|canvasSaveCoordinator|canvasUiState|freeCanvasAdapter|freeCanvasConfigState|freeCanvasMedia|freeCanvasState)\.js$/.test(normalizedId)) {
            return 'canvas-domain'
          }
          if (normalizedId.includes('/node_modules/vue/') || normalizedId.includes('/node_modules/@vue/')) {
            return 'vue'
          }
          // 画布库只给画布路由用，避免和页面业务挤在同一个异步块里。
          if (normalizedId.includes('/node_modules/@vue-flow/')) {
            return 'vue-flow'
          }
        },
      },
    },
  }
})
