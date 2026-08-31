import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  HARNESS_FLAG,
  HARNESS_PATH,
  HARNESS_VARIANTS,
  harnessEnabled,
  harnessReplacement,
  isHarnessVariant,
} from '@/app/(admin)/admin/intern/besked-erstatning/harness'
import { parseAnnouncementReplacement } from '@/lib/announcements/replacement'

/**
 * The boundary phase 8C-1 is asked to keep — §14 and §17 of the brief — asserted over
 * the repository's own source.
 *
 * 8C-1 is **infrastructure for 8C-3**. It builds the replacement and restore mechanism
 * and adds no ordinary workflow that reaches it:
 *
 *   * `/admin/besked` stays phase 7's editor — content through Ret → Forhåndsvis →
 *     Offentliggør, visibility through the immediate switch, and nothing else. No
 *     "Erstat", no "Behold eksisterende", no source selector, no conflict sheet.
 *   * The opening-hours screen gains no announcement control. "Vis også som besked
 *     øverst på hjemmesiden" and its suggested message are 8C-2; 1ae's sheet is 8C-3.
 *   * Nothing generates an opening-hours message.
 *
 * The one thing 8C-1 does add outside `lib/` is the integration harness, and this suite
 * holds it to the three properties that make it safe: it is behind a flag, it is guarded
 * like every other admin address, and **nothing links to it**.
 *
 * `tests/e2e/announcement-replacement.spec.ts` asserts the same boundary from the
 * rendered screens. This asserts it from the files, which is the half that survives a
 * screen nobody happened to open.
 */

const ROOT = process.cwd()
const HARNESS_DIR = 'app/(admin)/admin/intern/besked-erstatning'

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

// ---------------------------------------------------------------------------
// No ordinary replacement workflow
// ---------------------------------------------------------------------------

describe('the announcement editor is phase 7’s, unchanged', () => {
  const editor = readdirSync(join(ROOT, 'app/(admin)/admin/besked')).map((name) => ({
    name,
    source: readFileSync(join(ROOT, 'app/(admin)/admin/besked', name), 'utf8'),
  }))

  const components = readdirSync(join(ROOT, 'components/admin/announcement')).map((name) => ({
    name,
    source: readFileSync(join(ROOT, 'components/admin/announcement', name), 'utf8'),
  }))

  const code = [...editor, ...components].map(({ name, source }) => ({
    name,
    // The prose in these files names the replacement mechanism in order to say the
    // screen does not offer it. The assertion is about the code.
    code: source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
  }))

  it.each([
    ['the replacement domain module', '@/lib/announcements/replacement'],
    ['the snapshot module', '@/lib/announcements/snapshot'],
    ['the replacement RPC', 'replace_announcement'],
    ['the restore RPC', 'restore_announcement'],
    ['the previous column', 'previous'],
    ['the replaced_at column', 'replaced_at'],
  ])('does not reach for %s', (_what, needle) => {
    for (const file of code) {
      expect(file.code, `${file.name} mentions ${needle}`).not.toContain(needle)
    }
  })

  it.each([
    ['Erstat'],
    ['Behold eksisterende'],
    ['den nye besked'],
    ['opening_hours'],
  ])('renders no control or wording for “%s”', (needle) => {
    for (const file of code) {
      expect(file.code, `${file.name} contains “${needle}”`).not.toContain(needle)
    }
  })
})

describe('the opening-hours screen has no announcement control yet', () => {
  /*
   * Comments removed before the assertion, as above: phase 8B's own files name
   * `announcement_created` and 1t's "Vis også som besked" in prose, precisely in order
   * to record that they write neither. The assertion is about the code.
   */
  const files = screenFiles()
    .filter(({ path }) => path.includes('aabningstider') || path.includes('components/admin/hours/'))
    .map(({ path, source }) => ({
      path,
      code: source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
    }))

  it('there are files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each([
    ['the announcement table', "from('announcement')"],
    ['the replacement domain module', '@/lib/announcements/replacement'],
    ['the announcement lifecycle', '@/lib/announcements/lifecycle'],
    ['the announcement_created column', 'announcement_created'],
    ['1ae’s wording', 'Vis også som besked'],
  ])('does not reach for %s — that is 8C-2 and 8C-3', (_what, needle) => {
    for (const file of files) {
      expect(file.code, `${file.path} mentions ${needle}`).not.toContain(needle)
    }
  })
})

describe('no screen composes an opening-hours announcement', () => {
  it('the phrase 1t suggests appears in no application file', () => {
    // "Ændrede åbningstider søndag · 17:00–19:00" is 1t's own suggested message.
    //
    // 8C-2 built the generator that composes it — `lib/announcements/generated.ts`,
    // a pure module with no caller — so the assertion narrows to what it was always
    // about: a literal *in a screen* would mean the wording had escaped the domain
    // layer and started being assembled by hand. `screenFiles()` walks `app/` and
    // `components/` only, so the generator itself is out of scope by construction, and
    // `tests/unit/hours/override-source.test.ts` holds it to its own purity rules.
    for (const { path, source } of screenFiles()) {
      expect(source, `${path} composes a generated announcement`).not.toContain(
        'Ændrede åbningstider',
      )
    }
  })
})

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

describe('the integration harness is gated, guarded and unlinked', () => {
  const page = readFileSync(join(ROOT, HARNESS_DIR, 'page.tsx'), 'utf8')
  const actions = readFileSync(join(ROOT, HARNESS_DIR, 'actions.ts'), 'utf8')

  afterEach(() => {
    delete process.env[HARNESS_FLAG]
  })

  it('is off unless the flag is exactly "1"', () => {
    delete process.env[HARNESS_FLAG]
    expect(harnessEnabled()).toBe(false)

    process.env[HARNESS_FLAG] = ''
    expect(harnessEnabled()).toBe(false)

    process.env[HARNESS_FLAG] = 'true'
    expect(harnessEnabled()).toBe(false)

    process.env[HARNESS_FLAG] = '1'
    expect(harnessEnabled()).toBe(true)
  })

  it('answers 404 rather than rendering when the flag is off', () => {
    expect(page).toContain('if (!harnessEnabled()) notFound()')
  })

  it('refuses both actions when the flag is off — and asks who is calling first', () => {
    expect(actions).toContain('if (!harnessEnabled()) notFound()')

    // `requireStaff()` before the flag check, in both actions: the flag decides whether
    // the address exists, never who may use it.
    for (const action of ['harnessReplace', 'harnessRestore']) {
      const body = actions.slice(actions.indexOf(`export async function ${action}`))
      const guard = body.indexOf('await requireStaff()')
      const gate = body.indexOf('refuseUnlessEnabled()')

      expect(guard, `${action} calls requireStaff`).toBeGreaterThan(-1)
      expect(gate, `${action} checks the flag`).toBeGreaterThan(guard)
    }
  })

  it('expires the cache only after a result that reached the row', () => {
    const replaced = actions.indexOf("result.status !== 'replaced'")
    const restored = actions.indexOf("result.status !== 'restored'")
    const expiries = [...actions.matchAll(/expirePublicCacheTags\(/g)].map((m) => m.index ?? -1)

    expect(expiries).toHaveLength(2)
    expect(expiries[0]).toBeGreaterThan(replaced)
    expect(expiries[1]).toBeGreaterThan(restored)
  })

  it('is linked from nowhere — not the dashboard, not the navigation, not a screen', () => {
    for (const { path, source } of screenFiles()) {
      if (path.startsWith(HARNESS_DIR)) continue

      expect(source, `${path} links to the harness`).not.toContain(HARNESS_PATH)
      expect(source, `${path} links to the harness`).not.toContain('intern/besked-erstatning')
    }
  })

  it('lets the browser choose a closed variant key and nothing else', () => {
    expect(HARNESS_VARIANTS).toEqual(['b', 'd'])

    expect(isHarnessVariant('b')).toBe(true)
    expect(isHarnessVariant('erstat-alt')).toBe(false)
    expect(isHarnessVariant(null)).toBe(false)

    // The two hidden fields the forms carry, and no third.
    const fields = [...page.matchAll(/name=\{HARNESS_FORM\.(\w+)\}/g)].map((m) => m[1])
    expect([...new Set(fields)].sort()).toEqual(['variant', 'version'])
  })

  it('composes its payload on the server, and the payload is a valid replacement', () => {
    for (const variant of HARNESS_VARIANTS) {
      const payload = harnessReplacement(variant)

      expect(parseAnnouncementReplacement(payload)).not.toBeNull()
      expect(payload.source).toBe('opening_hours')
      expect(Date.parse(payload.expires_at)).toBeGreaterThan(Date.now())
    }
  })

  it('composes no opening-hours wording — 8C-1 generates nothing', () => {
    const harness = readFileSync(join(ROOT, HARNESS_DIR, 'harness.ts'), 'utf8')

    expect(harness).not.toContain('Ændrede åbningstider')
    expect(harness).not.toContain('åbningstider')
  })
})
