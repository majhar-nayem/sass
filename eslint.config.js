import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * The boundaries below are architectural, not stylistic. See docs/05-COMPONENTS.md §2
 * and docs/07-SECURITY-OPS.md §2 — each rule encodes a decision that is expensive to
 * discover has been violated.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/generated/**', '**/*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // ui-blocks renders props. It knows nothing about tenants, auth or the database.
  {
    files: ['packages/ui-blocks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@awning/db', '@awning/db/*', '@awning/ai', '@awning/ai/*', '**/apps/**'],
              message:
                'ui-blocks receives props and a theme. It must not reach for the database, the AI layer, or an app. See docs/05-COMPONENTS.md §2.',
            },
          ],
        },
      ],
    },
  },

  // Test fixtures deliberately construct malformed specs. `any` is the point of them:
  // the whole suite exists to prove the validator rejects things the types forbid.
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', 'tests/**/*.{ts,mjs}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // App code gets a DB client through withOrgContext, never from a bare client.
  // That helper is the only place row-level security context is set.
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/ai/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@awning/db',
              importNames: ['prisma', 'rawPrisma'],
              message:
                'Use withOrgContext(orgId, tx => ...). A bare client bypasses RLS. See docs/07-SECURITY-OPS.md §2.',
            },
          ],
        },
      ],
    },
  },
)
