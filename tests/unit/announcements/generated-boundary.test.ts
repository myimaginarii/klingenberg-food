import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The boundary phase 8C-3B is asked to keep — §23 of the brief — asserted over the
 * repository's own source.
 *
 * 8C-1 built the replacement mechanism, 8C-2 the pure generator, 8C-3A the coordinator,
 * and each of those phases was held to a boundary that said *"and nothing reaches it
 * yet"*. 8C-3B is the phase that reaches it, so the boundary changes shape rather than
 * disappearing. It is now narrow rather than empty:
 *
 * **Allowed — exactly one path.**
 *
 *     the opening-hours Server Actions and the screen they belong to
 *       → `generateOpeningHoursAnnouncement()`   (the pure generator)
 *       → `applyGeneratedAnnouncement()`         (the coordinator)
 *
 * **Forbidden — everything else.**
 *
 *   * `/admin/besked`, phase 7's ordinary announcement editor, calling the generator or
 *     the coordinator, or naming `source='opening_hours'`, `source_override_id`,
 *     `previous` or `replaced_at`. It writes a **manual** announcement through
 *     `publish_announcement()` and the visibility switch, exactly as phase 7 shipped it,
 *     and it may not create opening-hours ownership by any route.
 *   * Any *other* Server Action importing the generated coordination.
 *   * The **browser** composing an authoritative field — an expiry, a link, a source, an
 *     owning override, `previous` or `replaced_at`. The one field a person may set is the
 *     message.
 *   * Ownership decided from the **message text**. The suggested wording is editable, so
 *     it is evidence of nothing; ownership is `announcement.source_override_id` compared
 *     to an override id, and nothing else.
 *
 * And the harness is gone. `tests/e2e/opening-hours-announcement.spec.ts` drives the same
 * scenarios through `/admin/aabningstider`, which is what made deleting it possible.
 */

const ROOT = process.cwd()

function normalise(path: string): string {
  return path.split(sep).join('/')
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

/** Every source file under `app/` and `components/`, by repository-relative path. */
function screenFiles(): { path: string; source: string }[] {
  return [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]
    .map((absolute) => normalise(relative(ROOT, absolute)))
    .filter((path) => /\.(ts|tsx)$/.test(path))
    .map((path) => ({ path, source: readFileSync(join(ROOT, path), 'utf8') }))
}

/**
 * The prose in these files names the machinery in order to say what does and does not
 * reach it. Every assertion below is about the **code**.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

// ---------------------------------------------------------------------------
// Phase 7's editor is still phase 7's
// ---------------------------------------------------------------------------

describe('the ordinary announcement editor creates no opening-hours ownership', () => {
  const files = [
    ...readdirSync(join(ROOT, 'app/(admin)/admin/besked')).map((name) => ({
      name: `app/(admin)/admin/besked/${name}`,
      code: codeOf(readFileSync(join(ROOT, 'app/(admin)/admin/besked', name), 'utf8')),
    })),
    ...readdirSync(join(ROOT, 'components/admin/announcement')).map((name) => ({
      name: `components/admin/announcement/${name}`,
      code: codeOf(readFileSync(join(ROOT, 'components/admin/announcement', name), 'utf8')),
    })),
  ]

  it.each([
    ['the generator', '@/lib/announcements/generated'],
    ['the coordinator', '@/lib/announcements/generated-operation'],
    ['the suggestion module', '@/lib/announcements/generated-suggestion'],
    ['the replacement domain module', '@/lib/announcements/replacement'],
    ['the snapshot module', '@/lib/announcements/snapshot'],
    ['the replacement RPC', 'replace_announcement'],
    ['the restore RPC', 'restore_announcement'],
    ['the coordinator RPC', 'apply_generated_announcement'],
    ['the previous column', 'previous'],
    ['the replaced_at column', 'replaced_at'],
    ['the ownership pointer', 'source_override_id'],
    ['the generated source value', 'opening_hours'],
  ])('does not reach for %s', (_what, needle) => {
    for (const file of files) {
      expect(file.code, `${file.name} mentions ${needle}`).not.toContain(needle)
    }
  })

  it.each([['Erstat'], ['Behold eksisterende'], ['den nye besked']])(
    'renders no control or wording for “%s”',
    (needle) => {
      for (const file of files) {
        expect(file.code, `${file.name} contains “${needle}”`).not.toContain(needle)
      }
    },
  )
})

// ---------------------------------------------------------------------------
// Exactly one path in
// ---------------------------------------------------------------------------

describe('only the opening-hours workflow reaches the generated announcement', () => {
  const files = screenFiles().map(({ path, source }) => ({ path, code: codeOf(source) }))

  it('there are files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  /*
   * The allow-list is a list of **files**, not of directories, so adding a second caller
   * is a decision somebody has to write down here rather than a file that quietly
   * appears in a folder that was already permitted.
   */
  const MAY_COORDINATE = [
    'app/(admin)/admin/aabningstider/announcement-actions.ts',
    'app/(admin)/admin/aabningstider/announcement-routes.ts',
    'app/(admin)/admin/aabningstider/override-publish-actions.ts',
    'app/(admin)/admin/aabningstider/page.tsx',
  ]

  it('the coordinator is imported by those four files and no others', () => {
    const importers = files
      .filter(({ code }) => code.includes('@/lib/announcements/generated-operation'))
      .map(({ path }) => path)
      .sort()

    expect(importers).toEqual([...MAY_COORDINATE].sort())
  })

  it('the replacement and restore operations are reached only through them', () => {
    const importers = files
      .filter(({ code }) => code.includes('@/lib/announcements/replacement'))
      .map(({ path }) => path)
      .sort()

    // `announcement-actions.ts` calls `restoreAnnouncement()` for the Fortryd strip;
    // `announcement-routes.ts` imports its refusal wording. Nothing else may.
    expect(importers).toEqual([
      'app/(admin)/admin/aabningstider/announcement-actions.ts',
      'app/(admin)/admin/aabningstider/announcement-routes.ts',
    ])
  })

  it('the pure generator is reached through the suggestion module, not directly', () => {
    // The screen composes no wording of its own: it asks `suggestOverrideAnnouncement()`,
    // which is the one module the browser and the server share.
    const direct = files
      .filter(({ code }) => /@\/lib\/announcements\/generated'/.test(code))
      .map(({ path }) => path)

    expect(direct).toEqual([])
  })

  it('no screen composes a generated message by hand', () => {
    for (const { path, source } of screenFiles()) {
      expect(source, `${path} composes a generated announcement`).not.toContain(
        'Ændrede åbningstider',
      )
    }
  })
})

// ---------------------------------------------------------------------------
// The browser composes the message, and nothing else
// ---------------------------------------------------------------------------

describe('the browser cannot compose an authoritative field', () => {
  const forms = readFileSync(
    join(ROOT, 'app/(admin)/admin/aabningstider/override-forms.ts'),
    'utf8',
  )

  it('the announcement form has exactly three fields', () => {
    const block = forms.slice(
      forms.indexOf('export const OVERRIDE_ANNOUNCEMENT_FORM'),
      forms.indexOf('} as const', forms.indexOf('export const OVERRIDE_ANNOUNCEMENT_FORM')),
    )

    const names = [...block.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]).sort()

    // Whether it was asked for, the wording, and the version token it was asked against.
    expect(names).toEqual(['message', 'version', 'wanted'])
  })

  it('the conflict sheet submits a row id, two tokens, the wording and one bit', () => {
    const block = forms.slice(
      forms.indexOf('export const OVERRIDE_CONFLICT_FORM'),
      forms.indexOf('} as const', forms.indexOf('export const OVERRIDE_CONFLICT_FORM')),
    )

    const names = [...block.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]).sort()

    expect(names).toEqual(['confirm', 'message', 'override', 'overrideVersion', 'version'])
  })

  it.each([
    ['an expiry', 'expires_at'],
    ['a page link', 'link_page'],
    ['an external link', 'link_url'],
    ['a link label', 'link_label'],
    ['a source', "source:"],
    ['an owning override', 'source_override_id'],
    ['a displaced snapshot', 'previous'],
    ['a replacement stamp', 'replaced_at'],
  ])('the client component carries no field for %s', (_what, needle) => {
    const field = codeOf(
      readFileSync(join(ROOT, 'components/admin/hours/GeneratedAnnouncementField.tsx'), 'utf8'),
    )

    expect(field, `the 1t control mentions ${needle}`).not.toContain(needle)
  })

  it('the conflict sheet renders no input the server does not re-derive', () => {
    const sheet = readFileSync(
      join(ROOT, 'components/admin/hours/AnnouncementConflictSheet.tsx'),
      'utf8',
    )

    const inputs = [...sheet.matchAll(/name=\{fieldNames\.(\w+)\}/g)].map((match) => match[1])

    expect([...new Set(inputs)].sort()).toEqual([
      'confirm',
      'message',
      'override',
      'overrideVersion',
      'version',
    ])
  })
})

// ---------------------------------------------------------------------------
// Ownership is a pointer, never a sentence
// ---------------------------------------------------------------------------

describe('ownership is decided from ids', () => {
  const files = screenFiles().map(({ path, source }) => ({ path, code: codeOf(source) }))

  it('every screen that asks who owns the announcement asks isOwnedByOverride', () => {
    const askers = files
      .filter(({ code }) => code.includes('ownsAnnouncement'))
      .map(({ path, code }) => ({ path, uses: code.includes('isOwnedByOverride') }))

    expect(askers.length).toBeGreaterThan(0)

    for (const asker of askers) {
      expect(asker.uses, `${asker.path} decides ownership without isOwnedByOverride`).toBe(true)
    }
  })

  it('no file decides ownership by comparing a message', () => {
    for (const { path, code } of files) {
      // A comparison of `message` against the generated wording would be exactly the
      // "parse the text" rule §7e item 6 forbids.
      expect(code, `${path} compares a message to decide ownership`).not.toMatch(
        /message\s*[=!]==?\s*['"`]Ændrede/,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// The harness is gone
// ---------------------------------------------------------------------------

describe('the temporary 8C-1 replacement harness has been deleted', () => {
  it('the address does not exist', () => {
    expect(existsSync(join(ROOT, 'app/(admin)/admin/intern'))).toBe(false)
  })

  it.each([
    ['the environment flag', 'ANNOUNCEMENT_REPLACEMENT_HARNESS'],
    ['the address', 'intern/besked-erstatning'],
  ])('no source file, test or configuration mentions %s', (_what, needle) => {
    const roots = ['app', 'components', 'lib', 'tests', 'scripts', 'supabase/migrations']

    const files = roots
      .filter((dir) => existsSync(join(ROOT, dir)))
      .flatMap((dir) => [...walk(join(ROOT, dir))])
      .map((absolute) => normalise(relative(ROOT, absolute)))
      .filter((path) => /\.(ts|tsx|mjs|sql)$/.test(path))
      .filter((path) => path !== 'tests/unit/announcements/generated-boundary.test.ts')

    for (const path of files) {
      expect(readFileSync(join(ROOT, path), 'utf8'), `${path} mentions ${needle}`).not.toContain(
        needle,
      )
    }
  })

  it('the Playwright configuration sets no harness environment', () => {
    const config = readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8')

    expect(config).not.toContain('ANNOUNCEMENT_REPLACEMENT_HARNESS')
    expect(config).not.toContain('besked-erstatning')
  })
})
