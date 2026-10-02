import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [vue(), vuetify({ autoImport: true })],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  test: { environment: 'jsdom' },
})
