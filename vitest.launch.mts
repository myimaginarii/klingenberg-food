import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * The launch-tooling drill — phase 14A (technical plan §5, §10b).
 *
 * `tests/launch/*.test.mjs` run the three production launch commands —
 * `scripts/launch/migrate.mjs`, `load-content.mjs` and `bootstrap-owner.mjs` —
 * against the real local stack in their `--local-harness` mode: the same code
 * the production run executes, with the target guard inverted to loopback-only
 * rather than weakened. They are run by `npm run launch:drill`, separately from
 * the integration suite for the same reason as the backup drill: the content
 * suite empties and reloads the menu tables and resets the stack, and the
 * bootstrap suite makes the local application Owner-less for a few seconds.
 *
 * Credentials resolve exactly as for the other suites: the environment first,
 * `.env.local` second. Every suite refuses every host but loopback before it
 * moves anything.
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
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/launch/**/*.test.mjs'],
    env: { TZ: 'Europe/Copenhagen' },
    fileParallelism: false,
    // Two stack resets and a dozen psql round trips through the postgres:17 image.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
})
