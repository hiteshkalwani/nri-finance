import { fileURLToPath } from 'node:url'
process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)))
