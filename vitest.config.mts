import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * Unit-test configuration.
 *
 * The suites live in `tests/unit` and cover the pure layers the static site is built
 * from: the time and opening-hours engines (`lib/hours`, `lib/time`), the menu view
 * (`lib/menu`), the image model (`lib/images`), the SEO composition (`lib/seo`), the
 * tracked content itself (`content/site`) and the repository's own source policy.
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
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/unit/**/*.test.mjs',
    ],
    // Time-dependent logic is central to this site (technical plan §7); tests must
    // never inherit the machine's timezone.
    env: { TZ: 'Europe/Copenhagen' },
  },
})
