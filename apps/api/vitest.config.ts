import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: ['test/**/*.int.test.ts'] } },
      { test: { name: 'int', include: ['test/**/*.int.test.ts'], setupFiles: ['./test/setup.ts'], testTimeout: 20_000 } },
    ],
  },
})
