import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [vue(), vuetify({ autoImport: true })],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
    // Pre-scan every page so Vite finds all auto-imported Vuetify components at startup,
    // instead of re-optimizing and reloading the page the first time a new page is opened.
    warmup: { clientFiles: ['./src/**/*.vue'] },
  },
  test: { environment: 'jsdom' },
})
