import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * Integration-test configuration — phase 10A.
 *
 * The suites in `tests/integration` run against the **real local Supabase stack**
 * (`npm run db:start`, seeded identities from `npm run db:users`), because their
 * subject is exactly what neither a unit fake nor pgTAP can reach: the storage
 * HTTP surface — signed-token scope, bucket limits, public derivative reads — and
 * the upload pipeline end to end. They are run by `npm run test:integration`,
 * separately from the unit suite, for the same reason pgTAP is separate: they need
 * Docker.
 *
 * Credentials resolve like the application's own: from the environment, falling
 * back to `.env.local` (which `next dev` and `npm run db:users` already use).
 * Nothing here is a secret in any real sense — they are the CLI's fixed local demo
 * keys — but they are still never hard-coded, so the tests hit whatever stack the
 * developer actually has.
 */
const envFile = fileURLToPath(new URL('./.env.local', import.meta.url))
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2]
    }
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // Same reasoning as vitest.config.mts: Vitest is not a React Server
      // Component, so `server-only` resolves to the package's own empty module.
      'server-only': fileURLToPath(
        new URL('./node_modules/server-only/empty.js', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // One file at a time. Every suite here shares ONE real stack — the Auth
    // server, the storage buckets and, since the 13B closure, the rate-limit
    // counters, which two suites (`rate-limit`, `sign-in-throttle`) empty through
    // the test door as part of their stories. Run in parallel, one suite's clean-up
    // erases another's fixture mid-assertion (seen once in the closure's chain).
    fileParallelism: false,
    env: { TZ: 'Europe/Copenhagen' },
    // The pipeline uploads, processes and cleans up against real services; give a
    // slow first container pull room to breathe rather than flaking.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
