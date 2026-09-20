import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { setupFiles: ['./src/__tests__/setup.ts'], hookTimeout: 30000, testTimeout: 30000 },
})
