import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { defineConfig } from 'vite'

const require = createRequire(import.meta.url)
const { createRuntimeInstanceId } = require('../backend-node/src/utils/runtimeInstanceId.js')
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))
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
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
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
        },
      },
    },
  }
})
