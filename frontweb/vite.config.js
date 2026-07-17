import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { defineConfig } from 'vite'

const backendProxyTarget = process.env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:5679'

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
    host: '0.0.0.0',
    port: 3013,
    proxy: {
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
  }
})
