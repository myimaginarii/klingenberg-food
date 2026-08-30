#!/usr/bin/env node
/**
 * Clear Next.js's on-disk **data cache** — development only.
 *
 * WHY THIS EXISTS
 *
 * Public pages read through `lib/content/source.ts`, which wraps every loader in
 * `unstable_cache` with a tag and a five-minute safety net (technical plan §6, §7a).
 * That cache is persisted to `.next/cache/fetch-cache`, and it survives everything a
 * developer normally does — including `supabase db reset`.
 *
 * A reset re-runs the migrations and the seed, and every row gets a **new** uuid from
 * `gen_random_uuid()`. Nothing invalidates the data cache when that happens: no publish
 * ran, so no tag was expired. The result is a site that serves the previous database's
 * content — and, worse, the previous database's ids, so a link into the administration
 * lands on a dish that no longer exists. Every phase-5 report noticed this; this script
 * is the fix, wired into `npm run db:reset` so a reset cannot leave it behind.
 *
 * WHAT IT DELIBERATELY DOES NOT DELETE
 *
 * Only `.next/cache/fetch-cache` goes. Not `.next`, which would throw away the compiled
 * application for a problem that is entirely about content; and not `.next/cache`, which
 * also holds the bundler's own build cache — around 70 MB of work that has nothing to do
 * with the database and costs a full rebuild to recreate.
 *
 * It changes **no production behaviour**. Nothing imports this file; it is a command a
 * person (or `npm run db:reset`) runs against this working copy, and the deployed site
 * has no `.next/cache` a developer could reach in the first place.
 */
import { rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CACHE_DIR = join(process.cwd(), '.next', 'cache', 'fetch-cache')

if (!existsSync(CACHE_DIR)) {
  console.log('  No Next data cache to clear (.next/cache/fetch-cache is not there).')
  process.exit(0)
}

rmSync(CACHE_DIR, { recursive: true, force: true })
console.log('  Cleared the Next data cache (.next/cache/fetch-cache).')
