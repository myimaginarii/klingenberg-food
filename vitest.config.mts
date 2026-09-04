import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * Unit-test configuration.
 *
 * The suites live in `tests/unit` and cover the pure layers: the time engines
 * (`lib/hours`, `lib/menu/availability`), the draft overlay and schemas
 * (`lib/drafts`, `lib/schemas`), the publish registry (`lib/publishing`) and the
 * repository's own source policy.
 *
 * `.tsx` suites are included as well. A Server Component with a visibility rule — a
 * section that must render nothing rather than a placeholder — is worth asserting as
 * markup, and `react-dom/server` renders one in this environment with no test renderer
 * and no DOM. Anything needing a real DOM belongs in the Playwright suites instead.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),

      /**
       * `server-only` throws on import outside a React Server Component, which is
       * exactly what it is for: it makes reaching the read layer or the publish
       * machinery from a Client Component a build error (technical plan §8). Vitest is
       * neither, so it resolves to the package's own `empty.js` — the same file the
       * `react-server` condition selects — rather than to the module that throws.
       *
       * This weakens nothing. The guarantee is enforced by `next build`, and
       * `tests/unit/policy/public-javascript.test.ts` asserts over the real source tree
       * that no client component reaches these modules in the first place.
       */
      'server-only': fileURLToPath(
        new URL('./node_modules/server-only/empty.js', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      // The backup tooling is plain Node (scripts/backup); its suites are too.
      'tests/unit/**/*.test.mjs',
      'lib/**/*.test.ts',
    ],
    // Time-dependent logic is central to this system (technical plan §7); tests must
    // never inherit the machine's timezone.
    env: { TZ: 'Europe/Copenhagen' },
  },
})
