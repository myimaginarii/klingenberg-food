import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The phase-8 boundary, asserted over the source rather than promised — §0j, §0m, §7e, §8.
 *
 * Phase 8B builds 1t's lower card and **not** the generated announcement it sits beside in
 * the frame. That boundary is the sort of thing that decays quietly: an import added for a
 * good reason, a helper reused, a column named "just to read it". So it is checked here,
 * over the real files, the way `tests/unit/announcements/expiry-guard-source.test.ts`
 * checks the expiry guard's own promises.
 *
 * Four promises:
 *
 *   1. **Nothing in the one-off override's path can reach an announcement.** Not the
 *      table, not `source`, not `previous`, not `replaced_at`, and not
 *      `announcement_created` — §4's column for exactly the message phase 8C generates.
 *   2. **Nothing in it can reach the recurring weekly schedule.** The two cards share a
 *      screen and no code: a staff member's authority over one date must not become
 *      authority over the week.
 *   3. **Gem expires no cache tag.** A pending change is invisible, so the save has no
 *      business telling the public cache anything. Only the publish and the removal do,
 *      and only after their own transaction.
 *   4. **The card's domain module is pure.** No Supabase, no `server-only`, no clock — so
 *      the date rule cannot pick up the machine's timezone by accident.
 *
 * WHAT PHASE 8C-2 MOVED, AND WHAT IT DID NOT
 *
 * 8C-2 adds `lib/announcements/generated.ts` — a **pure** domain module that composes
 * 1t's suggested message and its expiry from an override, the recurring week and an
 * instant the caller supplies. That module is allowed to name announcement types; it is
 * the one place in this repository that is. So the last describe block below states the
 * narrowed boundary rather than the withdrawn one: the generator exists, it is pure, and
 * **nothing above it has been wired to it**. No Server Action calls it, no screen imports
 * it, 1t draws no "Vis også som besked øverst på hjemmesiden" checkbox, and the four files
 * above still name no announcement at all. Those are 8C-3's, and they are asserted here
 * so that arriving at them is a deliberate edit to this file rather than a quiet drift.
 */

const ROOT = process.cwd()

/** Everything phase 8B added or owns on the one-off side. */
const OVERRIDE_PATH_FILES = [
  'lib/hours/override-form.ts',
  'lib/hours/override-admin.ts',
  'lib/content/hours-overrides-admin.ts',
  'components/admin/hours/OverrideEditor.tsx',
  'components/admin/hours/OverrideNotices.tsx',
  ...readdirSync(join(ROOT, 'app', '(admin)', 'admin', 'aabningstider'))
    .filter((entry) => entry.startsWith('override-'))
    .map((entry) => `app/(admin)/admin/aabningstider/${entry}`),
]

function read(path: string): string {
  const absolute = join(ROOT, ...path.split('/'))

  expect(statSync(absolute).isFile(), `${path} exists`).toBe(true)

  return readFileSync(absolute, 'utf8')
}

/**
 * The file with its comments removed.
 *
 * Every one of these files *documents* the boundary it keeps, naming the announcement and
 * phase 8C in as many words — which is the point of the comments and would be the end of
 * this test if it read them. Only code is checked.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('the phase-8C boundary, in the code rather than in a promise', () => {
  /*
   * 8C-3A narrowed this by exactly one word, and the narrowing is worth stating.
   *
   * `lib/hours/override-admin.ts` now names one announcement-shaped thing:
   * `'owns_announcement'`, the status `remove_opening_hours_override()` returns when a
   * date still owns the generated message on the hjemmeside. That is the database
   * refusing a deletion, mapped into the removal wrapper's own vocabulary — not this
   * path reaching for an announcement. Everything that would be reaching is still
   * forbidden below: the table, the domain modules, the lifecycle RPCs, the snapshot
   * columns and the ownership pointer.
   *
   * `announcement_created` is asserted separately, and more strongly: 8C-3A dropped
   * the column, so it must appear in **no file in the repository**, not merely in
   * these four.
   */
  it.each(OVERRIDE_PATH_FILES)('%s reaches for no announcement', (path) => {
    const source = code(read(path))

    for (const forbidden of [
      "from('announcement')",
      '@/lib/announcements/',
      'replace_announcement',
      'restore_announcement',
      'apply_generated_announcement',
      'set_announcement_visible',
      'publish_announcement',
      'source_override_id',
      'previous',
      'replaced_at',
    ]) {
      expect(source.toLowerCase(), `${path} does not name ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      )
    }
  })

  it('the only announcement word in the override path is the removal refusal', () => {
    // One file, and every occurrence in it part of `owns_announcement`. If the word
    // appears anywhere else, or in any other shape, the rule above has stopped being
    // "no reaching" and started being "some reaching".
    const mentions = OVERRIDE_PATH_FILES.filter((path) => /announcement/i.test(code(read(path))))

    expect(mentions).toEqual(['lib/hours/override-admin.ts'])

    const stripped = code(read('lib/hours/override-admin.ts')).replaceAll(
      'owns_announcement',
      '',
    )

    expect(stripped).not.toMatch(/announcement/i)
  })

  it('announcement_created exists nowhere at all — 8C-3A dropped the column', () => {
    // Not "this path does not write it", which is what phase 8B asserted. The column is
    // gone: `announcement.source_override_id` is the single representation of
    // ownership, and a boolean beside it would be a second store of one fact. Migrations
    // are excluded because `20260831180000` is the statement that drops it and
    // `20260829120000` is the one that created it — a `drop column` has to be able to
    // name what it drops.
    for (const { path, source } of applicationFiles()) {
      expect(source, `${path} names announcement_created`).not.toContain('announcement_created')
    }

    for (const path of ['lib/hours/override-form.ts', 'lib/schemas/opening-hours.ts']) {
      expect(read(path), `${path} names announcement_created`).not.toContain(
        'announcement_created',
      )
    }
  })

  it.each(OVERRIDE_PATH_FILES)('%s cannot reach the recurring weekly schedule', (path) => {
    const source = code(read(path))

    for (const forbidden of [
      "'opening_hours'",
      '"opening_hours"',
      'publish_opening_hours(',
      'saveOpeningHoursDraft',
      'publishOpeningHours',
      'weeklyScheduleSchema',
      'toWeeklySchedule',
    ]) {
      expect(source, `${path} does not name ${forbidden}`).not.toContain(forbidden)
    }
  })
})

describe('what each write is allowed to tell the public cache', () => {
  it('Gem expires nothing at all', () => {
    const source = code(read('app/(admin)/admin/aabningstider/override-actions.ts'))

    // A pending change is invisible to a guest — `overrides_select_public` requires a
    // published row — so the save has nothing to invalidate and says nothing.
    expect(source).not.toContain('expirePublicCacheTags')
    expect(source).not.toContain('updateTag')
    expect(source).not.toContain('lib/cache')
  })

  it('the domain module returns tags and expires none itself', () => {
    const source = code(read('lib/hours/override-admin.ts'))

    // The same separation `lib/announcements/visibility.ts` keeps: the module answers, and
    // the Server Action decides what to do with the answer — which is what makes "the
    // cache is never told about a write that did not happen" checkable by reading one
    // short function.
    expect(source).not.toContain('expirePublicCacheTags')
    expect(source).not.toContain('updateTag')
  })

  it('the publish and the removal each expire only after their own result says so', () => {
    for (const path of [
      'app/(admin)/admin/aabningstider/override-publish-actions.ts',
      'app/(admin)/admin/aabningstider/override-remove-actions.ts',
    ]) {
      const source = code(read(path))

      expect(source, `${path} expires tags`).toContain('expirePublicCacheTags')
      // From the *result*, never from a constant list: a refusal, a conflict and the
      // removal of a merely-pending override all carry no tags.
      expect(source, `${path} expires the result's own tags`).toMatch(
        /expirePublicCacheTags\(result\.cacheTags\)/,
      )
    }
  })
})

describe('the card’s domain module is pure', () => {
  const source = read('lib/hours/override-form.ts')

  it('holds no database, no framework and no clock', () => {
    for (const forbidden of [
      'server-only',
      'supabase',
      'createSupabase',
      'react',
      'new Date(',
      'Date.now',
      'Intl.',
      'Europe/Copenhagen',
    ]) {
      expect(code(source), `it does not use ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('takes today as an argument, so the rule cannot read an ambient clock', () => {
    // §7e item 7's "today or later" is decided against a date the *caller* resolved with
    // `copenhagenDateOf(new Date())` on the server. A browser in another timezone cannot
    // move an override to another day, and neither can this module by accident.
    expect(source).toContain('today: IsoDate')
  })
})

// ---------------------------------------------------------------------------
// The narrowed 8C boundary: the generator exists, and nothing is wired to it
// ---------------------------------------------------------------------------

const GENERATOR_MODULE = 'lib/announcements/generated.ts'
const GENERATOR_IMPORT = '@/lib/announcements/generated'

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

/** Every application file: Server Actions, routes, pages and components. */
function applicationFiles(): { path: string; source: string }[] {
  return [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]
    .map((absolute) => relative(ROOT, absolute).split(sep).join('/'))
    .filter((path) => /\.(ts|tsx)$/.test(path))
    .map((path) => ({ path, source: readFileSync(join(ROOT, path), 'utf8') }))
}

describe('the generated announcement is domain logic and nothing more (8C-2)', () => {
  const generator = read(GENERATOR_MODULE)

  it('is pure — no database, no framework, no clock, no timezone of its own', () => {
    for (const forbidden of [
      'server-only',
      'supabase',
      'createSupabase',
      'react',
      'use server',
      'new Date(',
      'Date.now',
      'Intl.',
      'Europe/Copenhagen',
      'expirePublicCacheTags',
      'updateTag',
      'announcement_created',
    ]) {
      expect(code(generator), `the generator uses ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('takes its instant as an argument, so it cannot read an ambient clock', () => {
    expect(generator).toContain('now: Date')
  })

  it('calls neither half of 8C-1’s replacement mechanism', () => {
    for (const forbidden of [
      '@/lib/announcements/replacement',
      'replaceAnnouncement',
      'restoreAnnouncement',
      'replace_announcement',
      'restore_announcement',
    ]) {
      expect(code(generator), `the generator names ${forbidden}`).not.toContain(forbidden)
    }
  })
})

/*
 * ---------------------------------------------------------------------------
 * The 8C-3A boundary: one caller, and it is the domain coordinator
 * ---------------------------------------------------------------------------
 *
 * 8C-2 asserted that **nothing** called the generator. 8C-3A gives it exactly one
 * caller — `lib/announcements/generated-operation.ts`, the server-side coordinator —
 * and the narrowed rule is that it stays exactly one, and that no *screen* is it.
 *
 * The gated integration harness reaches the coordinator, which is the whole reason it
 * exists (`app/(admin)/admin/intern/besked-erstatning/harness.ts`), and it is exempted
 * by name rather than by pattern so that a second exemption has to be written down.
 */
const COORDINATOR_MODULE = 'lib/announcements/generated-operation.ts'
const HARNESS_DIR = 'app/(admin)/admin/intern/besked-erstatning'

describe('the generator has one caller, and no screen is it — 8C-3A', () => {
  const files = applicationFiles()

  it('there are files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('no Server Action, route, page or component imports the generator', () => {
    for (const { path, source } of files) {
      // The closing quote matters: `@/lib/announcements/generated-operation` — the
      // coordinator the harness reaches — starts with the same characters, and the
      // rule here is about the *pure generator*.
      expect(source, `${path} imports the generator`).not.toContain(`${GENERATOR_IMPORT}'`)
      expect(source, `${path} calls the generator`).not.toContain(
        'generateOpeningHoursAnnouncement',
      )
    }
  })

  it('the coordinator is the generator’s only caller in lib/', () => {
    const callers = [...walk(join(ROOT, 'lib'))]
      .map((absolute) => relative(ROOT, absolute).split(sep).join('/'))
      .filter((path) => /\.ts$/.test(path) && path !== GENERATOR_MODULE)
      .filter((path) => {
        const source = code(readFileSync(join(ROOT, path), 'utf8'))

        return source.includes(`${GENERATOR_IMPORT}'`) || source.includes("from './generated'")
      })

    expect(callers).toEqual([COORDINATOR_MODULE])
  })

  it('only the gated harness reaches the coordinator — no production screen does', () => {
    const importers = files
      .filter(({ source }) => code(source).includes('@/lib/announcements/generated-operation'))
      .map(({ path }) => path)

    for (const path of importers) {
      expect(path.startsWith(HARNESS_DIR), `${path} reaches the coordinator`).toBe(true)
    }
  })

  it('1t draws no announcement checkbox and no generated-message field yet', () => {
    // Comments stripped, as everywhere else in this file: several of these screens name
    // 1t's checkbox in prose precisely in order to record that they do not draw it.
    for (const { path, source: file } of files) {
      const source = code(file)

      for (const wording of [
        'Vis også som besked',
        'Foreslået besked',
        'Erstat med den nye besked',
        'Behold eksisterende',
      ]) {
        expect(source, `${path} renders “${wording}”`).not.toContain(wording)
      }
    }
  })

  it.each(OVERRIDE_PATH_FILES)(
    '%s still saves, publishes and removes without an announcement',
    (path) => {
      const source = code(read(path))

      // The blanket rule at the top of this file already forbids the word
      // "announcement" in these four paths. Stated again by name, because after 8C-2
      // these are the three specific operations 8C-3 will be tempted to reach from.
      for (const forbidden of [
        GENERATOR_IMPORT,
        'generateOpeningHoursAnnouncement',
        'replaceAnnouncement',
        'restoreAnnouncement',
      ]) {
        expect(source, `${path} names ${forbidden}`).not.toContain(forbidden)
      }
    },
  )
})
