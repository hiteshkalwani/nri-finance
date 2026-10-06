import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

const envDir = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => {
  // Same lookup Vite uses to embed import.meta.env.VITE_* into the bundle (files + process.env).
  const env = loadEnv(mode, envDir, 'VITE_')
  return {
    envDir,
    plugins: [
      vue(),
      vuetify({ autoImport: true }),
      {
        // Records the public Supabase URL this build embedded, so the deploy's CSP allows exactly that origin.
        name: 'emit-public-env',
        apply: 'build',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: '.public-env.json',
            source: JSON.stringify({ VITE_SUPABASE_URL: env.VITE_SUPABASE_URL ?? '' }),
          })
        },
      },
    ],
    server: {
      port: 5173,
      proxy: { '/api': 'http://localhost:8787' },
      // Pre-scan every page so Vite finds all auto-imported Vuetify components at startup,
      // instead of re-optimizing and reloading the page the first time a new page is opened.
      warmup: { clientFiles: ['./src/**/*.vue'] },
    },
    test: { environment: 'jsdom', server: { deps: { inline: [/vuetify/] } } },
  }
})
