import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  main: {
    define: Object.fromEntries(['HESORA_LICENSE_PUBLIC_KEY', 'HESORA_ACTIVATION_URL', 'HESORA_UPDATE_URL']
      .flatMap((key) => process.env[key] ? [[`process.env.${key}`, JSON.stringify(process.env[key])]] : [])),
    // @peculiar/x509 系（LAN 主机证书）是纯 ESM 包，externalize 后 require() 会
    // ERR_REQUIRE_ESM——主进程产物为 CJS，必须 bundle 进来（Task 9 打包冒烟教训）。
    plugins: [externalizeDepsPlugin({ exclude: ['@peculiar/x509', '@peculiar/asn1-schema', '@peculiar/asn1-x509', 'pvtsutils', 'pvutils', 'asn1js'] })]
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
