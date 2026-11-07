import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  main: {
    define: Object.fromEntries(['HESORA_LICENSE_PUBLIC_KEY', 'HESORA_ACTIVATION_URL', 'HESORA_UPDATE_URL']
      .flatMap((key) => process.env[key] ? [[`process.env.${key}`, JSON.stringify(process.env[key])]] : [])),
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    build: { assetsInlineLimit: 0 },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
