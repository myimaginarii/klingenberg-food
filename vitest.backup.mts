import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * The restore-drill configuration — phase 13A (technical plan §10f, brief §15, §27).
 *
 * `tests/backup/drill.test.ts` is one long, ordered rehearsal against the real local
 * stack: reset to the seed, create representative content, take a recovery point
 * with the real backup command, destroy the data, restore with the real restore
 * command, prove what came back, reset again. It is run by `npm run backup:drill`,
 * separately from the integration suite, because it truncates the database the
 * other suites are reading and because a full drill is measured in minutes.
 *
 * Credentials resolve exactly as for the integration suite: the environment first,
 * `.env.local` second. The drill refuses every host but loopback before it moves
 * anything.
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
    include: ['tests/backup/**/*.test.ts'],
    env: { TZ: 'Europe/Copenhagen' },
    fileParallelism: false,
    // Two stack resets, three dumps and a full Storage round trip — minutes, not seconds.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
})
