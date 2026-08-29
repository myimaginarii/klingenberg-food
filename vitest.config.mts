import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * Unit-test configuration. Phase 0 ships no tests — `npm test` runs with
 * `--passWithNoTests` so CI exercises the real runner instead of a placeholder.
 *
 * The first suites arrive in phase 2 (`lib/hours`, `lib/menu/availability`), which is
 * why the include pattern already points at `tests/unit` and co-located `lib` tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'lib/**/*.test.ts'],
    // Time-dependent logic is central to this system (technical plan §7); tests must
    // never inherit the machine's timezone.
    env: { TZ: 'Europe/Copenhagen' },
  },
})
