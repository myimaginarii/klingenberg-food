import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  validateAboutPage,
  validateAward,
  validateHomePage,
  validateTakeawayPage,
} from '@/lib/content/validate/pages'
import type { Problem } from '@/lib/content/validate/problems'
import { validateSiteContent } from '@/lib/content/validate/index'

/**
 * The page documents, the rules that span two files, and the command itself.
 *
 * The CLI is exercised the only way that proves anything: by running it, over a copy
 * of the real content in a temporary directory. That copy is what gets broken — the
 * tracked files under `content/site/` are read and never written, and the last test
 * here holds them to that byte for byte.
 */

const ROOT = process.cwd()
const HOME = 'content/site/pages/home.json'

const messages = (problems: readonly Problem[]) =>
  problems.map((problem) => `${problem.where}: ${problem.message}`).join('\n')

const home = (over: Record<string, unknown> = {}) => ({
  hero: { heading: 'Burgeren der vandt Fyn', intro: 'Vi laver burgere.', photo: null },
  award: { photo: null },
  featured: { dishIds: ['odin', 'frigg'], note: 'Alle burgere kan bestilles som menu.' },
  aboutExcerpt: { heading: 'Mad fra hallen', text: 'Vi er et lokalt spisested.', photo: null },
  ...over,
})

describe('the page documents', () => {
  it('accepts a Forside with any number of featured dishes, including none', () => {
    expect(validateHomePage(home(), HOME)).toEqual([])
    expect(validateHomePage(home({ featured: { dishIds: [] } }), HOME)).toEqual([])
    expect(
      validateHomePage(home({ featured: { dishIds: ['odin', 'frigg', 'ragnar', 'thor'] } }), HOME),
    ).toEqual([])
  })

  it('refuses the same dish featured twice — the cards are keyed by the id', () => {
    expect(messages(validateHomePage(home({ featured: { dishIds: ['odin', 'odin'] } }), HOME))).toMatch(
      /dishIds → 2: "odin" står mere end ét sted\. Forsiden viser hver ret én gang\./,
    )
  })

  it('refuses a Forside missing an object a loader reaches straight into', () => {
    const withoutHero = Object.fromEntries(Object.entries(home()).filter(([key]) => key !== 'hero'))
    expect(messages(validateHomePage(withoutHero, HOME))).toMatch(
      /home\.json → hero: Skal være et objekt — \{ "heading", "intro", "photo" \}/,
    )
  })

  it('leaves prose alone: length, punctuation and Danish letters are the restaurant’s', () => {
    const longSentence = 'Æblekage, flødeskum og kanel — og så en pause. '.repeat(20)
    expect(validateHomePage(home({ hero: { heading: 'Å!', intro: longSentence } }), HOME)).toEqual([])
  })

  it('requires the one label without which the takeaway button would be blank', () => {
    const where = 'content/site/pages/takeaway.json'
    expect(validateTakeawayPage({ ctaLabel: 'Ring og hør mere' }, where)).toEqual([])
    expect(messages(validateTakeawayPage({ heading: 'Mad ud af huset' }, where))).toMatch(
      /ctaLabel: Skal udfyldes\./,
    )
  })

  it('refuses two takeaway sections sharing an id, which is also an element id', () => {
    const where = 'content/site/pages/takeaway.json'
    const problems = validateTakeawayPage(
      {
        ctaLabel: 'Ring',
        sections: [
          { id: 'selskaber', heading: 'A', body: 'a' },
          { id: 'selskaber', heading: 'B', body: 'b' },
        ],
      },
      where,
    )

    expect(messages(problems)).toMatch(
      /"selskaber" står mere end ét sted\. Id’et bliver til afsnittets adresse på siden/,
    )
  })

  it('refuses an Om os story that is not a list of texts', () => {
    const where = 'content/site/pages/about.json'
    expect(validateAboutPage({ story: ['Et afsnit.'], team: {}, method: {} }, where)).toEqual([])
    expect(messages(validateAboutPage({ story: 'Et afsnit.', team: {}, method: {} }, where))).toMatch(
      /story: Skal være en liste/,
    )
  })

  /**
   * The award's wording is the confirmed competition result and will be read-only in
   * Pages CMS. Phase 3 keeps its two fields from going empty and analyses nothing.
   */
  it('requires both halves of the award band and reads neither', () => {
    const where = 'content/site/award.json'
    expect(validateAward({ title: 'Fyns bedste burger 2026', text: 'Vi vandt Fyn & Øer.' }, where)).toEqual([])
    expect(messages(validateAward({ title: 'Fyns bedste burger 2026' }, where))).toMatch(
      /award\.json → text: Skal udfyldes\./,
    )
  })
})

describe('the content of this repository', () => {
  it('passes validation exactly as it stands', () => {
    expect(validateSiteContent()).toEqual([])
  })
})

/** A copy of the real content, in a temporary directory, for the command to chew on. */
const fixtures: string[] = []

function fixture(edit: (files: { read: (path: string) => unknown; write: (path: string, value: unknown) => void }) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'check-content-'))
  fixtures.push(root)

  mkdirSync(join(root, 'content'), { recursive: true })
  cpSync(join(ROOT, 'content', 'site'), join(root, 'content', 'site'), { recursive: true })
  mkdirSync(join(root, 'generated'), { recursive: true })
  cpSync(join(ROOT, 'generated', 'images.json'), join(root, 'generated', 'images.json'))

  edit({
    read: (path) => JSON.parse(readFileSync(join(root, path), 'utf8')),
    write: (path, value) => writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`),
  })

  return root
}

/** Run the command the way CI and a person both run it, and report what it said. */
function run(cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-content.mjs')], {
      cwd,
      encoding: 'utf8',
      // Both streams are captured rather than inherited: the command's own refusals are
      // what is being asserted, not something to print into the test run's output.
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true })
})

describe('npm run check:content', () => {
  it('says so, and exits zero, over the content as it stands', () => {
    const result = run(fixture(() => {}))

    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/Indholdet i content\/site\/ er i orden/)
  })

  it('exits non-zero and names the file, the item and the field — with no stack trace', () => {
    const root = fixture(({ read, write }) => {
      const menu = read('content/site/menu.json') as {
        categories: { name: string; dishes: { name: string; price: string }[] }[]
      }
      menu.categories[0]!.dishes[0]!.price = '89 kr.'
      write('content/site/menu.json', menu)
    })

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/content\/site\/menu\.json → Burgere → Odin → price/)
    expect(result.stderr).toMatch(/Prisen skrives i kroner/)
    expect(result.stderr).toMatch(/f\.eks\. "89", "89,50"/)
    // A stack frame is for whoever wrote the checker; this audience wrote the menu.
    expect(result.stderr).not.toMatch(/\n\s+at .*\(/)
  })

  it('reports every problem in one run rather than stopping at the first', () => {
    const root = fixture(({ read, write }) => {
      const contact = read('content/site/contact.json') as Record<string, unknown>
      contact.email = 'ikke-en-adresse'
      contact.primaryPhone = 'ring til os'
      write('content/site/contact.json', contact)
    })

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/2 fejl/)
    expect(result.stderr).toMatch(/primaryPhone/)
    expect(result.stderr).toMatch(/email/)
  })

  /** The one rule that spans two files: the Forside names dishes the menu must have. */
  it('catches a featured dish that is not on the menu', () => {
    const root = fixture(({ read, write }) => {
      const page = read('content/site/pages/home.json') as { featured: { dishIds: string[] } }
      page.featured.dishIds = ['odin', 'loke', 'ragnar']
      write('content/site/pages/home.json', page)
    })

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/content\/site\/pages\/home\.json → featured → dishIds → 2/)
    expect(result.stderr).toMatch(/Der findes ingen ret med id'et "loke" i menuen/)
  })

  it('reports an unreadable file rather than crashing on it', () => {
    const root = fixture(() => {})
    writeFileSync(join(root, 'content', 'site', 'award.json'), '{ "title": "Uden slutklamme"')

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/content\/site\/award\.json/)
    expect(result.stderr).toMatch(/ikke gyldig JSON/)
  })

  it('never writes to the tracked content: every file is byte for byte what it was', () => {
    const before = new Map<string, string>()
    const files = [
      'menu.json',
      'weekly-special.json',
      'monthly-burger.json',
      'hours.json',
      'contact.json',
      'award.json',
      'announcement.json',
      'pages/home.json',
      'pages/about.json',
      'pages/takeaway.json',
    ]
    for (const file of files) {
      before.set(file, readFileSync(join(ROOT, 'content', 'site', file), 'utf8'))
    }

    run(fixture(({ read, write }) => {
      write('content/site/menu.json', { ...(read('content/site/menu.json') as object), categories: [] })
    }))

    for (const file of files) {
      expect(readFileSync(join(ROOT, 'content', 'site', file), 'utf8')).toBe(before.get(file))
    }
  })
})
