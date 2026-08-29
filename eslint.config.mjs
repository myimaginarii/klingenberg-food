import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

/**
 * Secrets from technical plan §10e that must never be prefixed NEXT_PUBLIC_ and must
 * only ever be read through `lib/env/server.ts` (which imports `server-only`, so a
 * client import becomes a build error). `scripts/check-source-policy.mjs` performs the
 * same check across non-JS files; this rule catches it in the editor.
 */
const SERVER_ONLY_ENV = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SENTRY_DSN',
  'RESEND_API_KEY',
]

const secretPattern = `/^(${SERVER_ONLY_ENV.join('|')})$/`

const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**', 'supabase/.temp/**'],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `MemberExpression[object.object.name='process'][object.property.name='env'][property.name=${secretPattern}]`,
          message:
            'Read server secrets through lib/env/server.ts, which imports "server-only". Never read process.env for a secret directly.',
        },
        {
          selector: `MemberExpression[object.object.name='process'][object.property.name='env'][computed=true][property.value=${secretPattern}]`,
          message:
            'Read server secrets through lib/env/server.ts, which imports "server-only". Never read process.env for a secret directly.',
        },
      ],
    },
  },

  {
    // The single door to server secrets is allowed to open it.
    files: ['lib/env/server.ts', 'scripts/**/*.mjs'],
    rules: { 'no-restricted-syntax': 'off' },
  },
]

export default eslintConfig
