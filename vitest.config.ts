import { fileURLToPath } from 'node:url'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'tests/unit/**/*.test.ts',
            'tests/integration/**/*.test.ts',
            'tests/architecture/**/*.test.ts',
          ],
          passWithNoTests: false,
          restoreMocks: true,
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['tests/components/**/*.test.ts'],
          environment: 'nuxt',
          environmentOptions: {
            nuxt: {
              rootDir: fileURLToPath(new URL('.', import.meta.url)),
              domEnvironment: 'happy-dom',
            },
          },
        },
      }),
    ],
  },
})
