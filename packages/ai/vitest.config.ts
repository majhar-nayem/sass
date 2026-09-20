import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { setupFiles: ['./src/__tests__/setup.ts'], hookTimeout: 40000, testTimeout: 40000 },
})
