import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(dirname, './client/src'),
      '@shared': path.resolve(dirname, './shared')
    }
  },
  test: {
    include: ['server/**/*.test.ts', 'client/**/*.test.ts'],
    environment: 'node'
  }
})
