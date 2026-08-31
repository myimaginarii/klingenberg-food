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
 * WHAT PHASE 8C-3B CHANGED, AND WHAT IT DID NOT
 *
 * 8C-2 and 8C-3A asserted here that **nothing above the generator had been wired to it**.
 * 8C-3B is the phase that wires it, so the boundary narrows rather than lifting: three
 * named files may now reach the announcement, and every other file on the one-off path
 * still may not.
 *
 *   * `lib/hours/override-admin.ts` — the removal wrapper. It names `owns_announcement`
 *     and carries §7e item 6's one confirmation bit, and it reaches no announcement module.
 *   * `app/(admin)/admin/aabningstider/override-publish-actions.ts` — the hours-first
 *     publish, which attempts the optional message **after** the override is live.
 *   * `app/(admin)/admin/aabningstider/override-remove-actions.ts` — which asks
 *     `isOwnedByOverride()` who owns the live message before it words the removal.
 *
 * The **import graph** as a whole — which files may reach the coordinator, what the
 * browser may submit, and that ownership is never read out of a message — is asserted in
 * `tests/unit/announcements/generated-boundary.test.ts`, which is 8C-3B's own boundary
 * suite. What stays here is the half this file has always owned: that the one-off card's
 * *hours* path cannot reach an announcement or the recurring week, that the generator is
 * pure, and that a save tells the public cache nothing.
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

/**
 * The three files 8C-3B allows to know an announcement exists, named one at a time.
 *
 * An allow-list of **files**, not of a folder, so a fourth is a line somebody has to add
 * here rather than a file that quietly appears next to the other three.
 */
const MAY_REACH_ANNOUNCEMENT = [
  'lib/hours/override-admin.ts',
  'app/(admin)/admin/aabningstider/override-publish-actions.ts',
  'app/(admin)/admin/aabningstider/override-remove-actions.ts',
]

/** Everything on the one-off path that still may not. */
const HOURS_ONLY_FILES = OVERRIDE_PATH_FILES.filter(
  (path) => !MAY_REACH_ANNOUNCEMENT.includes(path),
)

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
   * The rule that did not change: everything on the one-off path except the three named
   * files reaches no announcement at all — not the table, not a domain module, not a
   * lifecycle RPC, not the snapshot columns, not the ownership pointer.
   *
   * That is most of the path, and deliberately: 1t's card, its form vocabulary, its
   * notices, its ordinary Gem and the admin read underneath them all still have no way to
   * touch `public.announcement`. Only the two Server Actions that §7e items 6 and 8
   * actually name, and the removal wrapper they call, may.
   */
  it.each(HOURS_ONLY_FILES)('%s reaches for no announcement', (path) => {
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
      'replaced_at',
    ]) {
      expect(source.toLowerCase(), `${path} does not name ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      )
    }
  })

  /*
   * And the three that may are held to *what* they may reach, one file at a time.
   *
   * None of them may write an announcement column, name a lifecycle RPC, or compose a
   * message: each reaches exactly one door — the coordinator, the ownership predicate, or
   * a status string — and everything authoritative is decided behind it.
   */
  it.each(MAY_REACH_ANNOUNCEMENT)('%s reaches one door and no further', (path) => {
    const source = code(read(path))

    for (const forbidden of [
      "from('announcement')",
      'replace_announcement',
      'restore_announcement',
      'set_announcement_visible',
      'publish_announcement',
      'replaced_at',
      'generateOpeningHoursAnnouncement',
      'withEditedMessage',
      'Ændrede åbningstider',
    ]) {
      expect(source, `${path} names ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('the removal wrapper still writes no announcement of its own', () => {
    // It carries §7e item 6's confirmation bit to `remove_opening_hours_override()`, and
    // the transition itself is the database's — one transaction, so the two halves cannot
    // come apart. This module names no announcement column and calls no announcement RPC.
    const source = code(read('lib/hours/override-admin.ts'))

    expect(source).toContain('remove_opening_hours_override')
    expect(source).not.toContain('@/lib/announcements/')
    expect(source).not.toContain('source_override_id')
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

  /*
   * The two cards share a screen and no code: a staff member's authority over one date
   * must not become authority over the week.
   *
   * The probe is the *reach* rather than the string, because 8C-3B put the literal
   * `'opening_hours'` legitimately on this path — it is the announcement's `source` value,
   * one half of the ownership pair, and has nothing to do with the weekly table.
   */
  it.each(OVERRIDE_PATH_FILES)('%s cannot reach the recurring weekly schedule', (path) => {
    const source = code(read(path))

    for (const forbidden of [
      "from('opening_hours')",
      'publish_opening_hours(',
      'saveOpeningHoursDraft',
      'publishOpeningHours',
      'readAdminOpeningHours',
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
 * The generator stays pure, and stays reached through two doors
 * ---------------------------------------------------------------------------
 *
 * 8C-2 asserted that nothing called the generator; 8C-3A gave it one caller; 8C-3B gives
 * it a second, and stops there.
 *
 *   * `lib/announcements/generated-operation.ts` — the server-side coordinator, which
 *     re-reads the published rows and composes the authoritative payload.
 *   * `lib/announcements/generated-suggestion.ts` — the pure module the **screen** and the
 *     **browser** share, so 1t's *"Retter du tiderne, opdateres forslaget"* is answered by
 *     one implementation in both runtimes rather than by two that agree today.
 *
 * No component, Server Action, route or page calls the generator directly. That is what
 * keeps "the wording is composed in one place" a property of the import graph.
 */
const COORDINATOR_MODULE = 'lib/announcements/generated-operation.ts'
const SUGGESTION_MODULE = 'lib/announcements/generated-suggestion.ts'

describe('the generator has two callers, and no screen is either — 8C-3B', () => {
  const files = applicationFiles()

  it('there are files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('no Server Action, route, page or component imports the generator directly', () => {
    for (const { path, source: file } of files) {
      // Comments stripped, as everywhere else in this file: several of these modules name
      // the generator in prose precisely in order to record that the *server* re-runs it.
      const source = code(file)

      // The closing quote matters: `@/lib/announcements/generated-operation` and
      // `-suggestion` both start with the same characters, and the rule here is about the
      // *pure generator* itself.
      expect(source, `${path} imports the generator`).not.toContain(`${GENERATOR_IMPORT}'`)
      expect(source, `${path} calls the generator`).not.toContain(
        'generateOpeningHoursAnnouncement',
      )
    }
  })

  it('the coordinator and the suggestion module are its only callers in lib/', () => {
    const callers = [...walk(join(ROOT, 'lib'))]
      .map((absolute) => relative(ROOT, absolute).split(sep).join('/'))
      .filter((path) => /\.ts$/.test(path) && path !== GENERATOR_MODULE)
      .filter((path) => {
        const source = code(readFileSync(join(ROOT, path), 'utf8'))

        return source.includes(`${GENERATOR_IMPORT}'`) || source.includes("from './generated'")
      })
      .sort()

    expect(callers).toEqual([COORDINATOR_MODULE, SUGGESTION_MODULE].sort())
  })

  it('the suggestion module is pure — it is the one that runs in a browser', () => {
    const source = code(read(SUGGESTION_MODULE))

    // It is imported by a `'use client'` component, so anything here that reached the
    // server would be a build error rather than a subtle bug — and stating it keeps the
    // reason visible.
    expect(source).not.toContain('server-only')
    expect(source).not.toContain('@supabase')
    expect(source).not.toContain('createSupabaseServerClient')
    expect(source).not.toContain('Date.now()')
  })

  it('the client control composes no wording of its own', () => {
    const control = code(
      read('components/admin/hours/GeneratedAnnouncementField.tsx'),
    )

    // Every Danish sentence about *hours* comes from the domain. What is written in the
    // component is the frame's own helper copy, which is about the control rather than
    // about any particular date.
    expect(control).not.toContain('Ændrede åbningstider')
    expect(control).not.toContain('Lukket ')
    expect(control).toContain('suggestOverrideAnnouncement')
  })
})
