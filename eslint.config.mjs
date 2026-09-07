import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

/**
 * The static site has no server, no database and no secrets, so the rule that used to
 * live here — "never read a server secret from `process.env` outside `lib/env/server.ts`"
 * — no longer has anything to guard. `scripts/check-source-policy.mjs` is what now
 * asserts that no secret name appears in the tree at all.
 */
const eslintConfig = [
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**'],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,
]

export default eslintConfig
