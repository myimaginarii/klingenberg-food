import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { describeDishDeleted, describeDishDeletion } from '@/lib/menu/delete'

/**
 * What the confirmation asks, and what it warns about — technical plan §7e item 4;
 * design 1r.
 *
 * The deletion itself is one UPDATE, proved from real JWTs in
 * `supabase/tests/007_soft_delete.test.sql`. What is decided in TypeScript is smaller
 * and easier to get quietly wrong: **which sentence a person reads before they press
 * the button**. Three decisions live in it, and each one is a promise the phase brief
 * makes by name:
 *
 *   1. a dish that has never been published must not be described as disappearing from
 *      a hjemmeside it was never on;
 *   2. a dish the published Forside features must carry the Forside warning, and the
 *      warning must say that Forsiden itself is *not* changed;
 *   3. neither sentence may leak an id, a page key or any other implementation word
 *      into a screen somebody reads mid-shift.
 */

const ODIN = { dishName: 'Odin', isNewDraft: false, featuredOnHomepage: false }

describe('the question the confirmation asks', () => {
  it('uses the approved wording for a published dish', () => {
    const prompt = describeDishDeletion(ODIN)

    // 1r's own note, and the phase brief's example, word for word.
    expect(`${prompt.question} ${prompt.consequence}`).toBe(
      'Slet Odin? Den forsvinder fra hjemmesiden.',
    )
  })

  it('names the dish being deleted, so a confirmation is never ambiguous', () => {
    expect(describeDishDeletion({ ...ODIN, dishName: 'Glade Gris' }).question).toBe(
      'Slet Glade Gris?',
    )
  })

  it('does not promise a public consequence for a dish that was never published', () => {
    const prompt = describeDishDeletion({ ...ODIN, isNewDraft: true })

    expect(prompt.question).toBe('Slet Odin?')
    expect(prompt.consequence).toBe(
      'Den er ikke offentliggjort endnu, så den forsvinder kun herfra.',
    )
    expect(prompt.consequence).not.toContain('hjemmesiden')
  })

  it('labels the destructive control with the design’s own words', () => {
    expect(describeDishDeletion(ODIN).confirmLabel).toBe('Slet ret')
  })
})

describe('the Forside warning', () => {
  it('is absent for a dish the published Forside does not feature', () => {
    expect(describeDishDeletion(ODIN).homepageWarning).toBeNull()
  })

  it('appears, with the approved wording, for a dish the Forside features', () => {
    expect(describeDishDeletion({ ...ODIN, featuredOnHomepage: true }).homepageWarning).toBe(
      'Denne ret vises også på forsiden. Den forsvinder derfra, men forsiden bliver ikke ændret permanent.',
    )
  })

  it('promises that Forsiden is not changed — which is the whole permission story', () => {
    const warning = describeDishDeletion({ ...ODIN, featuredOnHomepage: true }).homepageWarning

    // The Owner-only document is left alone (§5). A warning that said the reference
    // would be removed would be describing a privilege Staff do not have.
    expect(warning).toContain('forsiden bliver ikke ændret permanent')
  })

  it('is absent for an unpublished dish, whatever a stale reference says', () => {
    // A dish nobody has published cannot be on the Forside a guest sees, so warning
    // about it would be telling somebody something untrue about their own screen.
    expect(
      describeDishDeletion({ ...ODIN, isNewDraft: true, featuredOnHomepage: true })
        .homepageWarning,
    ).toBeNull()
  })

  it('never exposes an implementation word to the person reading it', () => {
    const prompt = describeDishDeletion({ ...ODIN, featuredOnHomepage: true })
    const text = [prompt.question, prompt.consequence, prompt.homepageWarning].join(' ')

    for (const jargon of ['pages.home', 'featured_dish_ids', 'deleted_at', 'draft', 'uuid']) {
      expect(text.toLowerCase()).not.toContain(jargon.toLowerCase())
    }
  })
})

describe('the sentence the Fortryd strip carries', () => {
  it('is the brief’s wording for a published dish', () => {
    expect(describeDishDeleted({ dishName: 'Odin', isNewDraft: false })).toBe(
      '«Odin» er fjernet fra hjemmesiden.',
    )
  })

  it('says where an unpublished dish actually went', () => {
    expect(describeDishDeleted({ dishName: 'Odin', isNewDraft: true })).toBe(
      '«Odin» er fjernet fra listen.',
    )
  })
})

/**
 * The two promises the phase brief asks to be tested rather than trusted, asserted over
 * the source that would have to break them.
 *
 * Both are negatives — *this operation does not touch that* — and a negative is exactly
 * the kind of property that stops being true without anybody noticing. The database
 * suite proves them against a real row; these prove that no second path was quietly
 * added above it.
 */
describe('deleting a dish touches neither the draft nor the Forside document', () => {
  const domainModule = readFileSync(join(process.cwd(), 'lib/menu/delete.ts'), 'utf8')
  const action = readFileSync(
    join(process.cwd(), 'app/(admin)/admin/menu/delete-actions.ts'),
    'utf8',
  )
  const migration = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260829180000_soft_delete_dishes.sql'),
    'utf8',
  )

  /** The migration with its comments removed — what the database will actually run. */
  const statements = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .toLowerCase()

  /**
   * `set_dish_deleted`'s own body, from its signature to the end of its definition.
   *
   * Scoped rather than file-wide, because the file legitimately contains one other
   * thing: the fix to `tg_guard_sold_out_date`, whose error message necessarily names
   * `sold_out_on`. The promise being asserted is about the *deletion statement*, so
   * that is what is read — a file-wide grep would either miss the point or forbid the
   * neighbouring fix.
   */
  const deleteFunction = statements.slice(
    statements.indexOf('create or replace function public.set_dish_deleted('),
    statements.indexOf('comment on function public.set_dish_deleted'),
  )

  it('finds the deletion statement to read at all', () => {
    expect(deleteFunction).toContain('update public.dishes')
  })

  it.each([
    ['the pages table', 'public.pages'],
    ['the Forside document column', 'featured_dish_ids'],
    ['a privilege-elevation path', 'security definer'],
    ['a hard delete', 'delete from'],
    ['the draft column', 'draft'],
    ['the sold-out column', 'sold_out_on'],
    ['the unpublished flag', 'is_new_draft'],
    ['a price, a name or a category', 'price_ore'],
  ])('the deletion statement never mentions %s', (_what, needle) => {
    expect(deleteFunction).not.toContain(needle)
  })

  it('never removes a row anywhere in the migration', () => {
    expect(statements).not.toContain('delete from')
    expect(statements).not.toContain('drop table')
  })

  it('leaves the whole migration free of any reference to the Forside document', () => {
    expect(statements).not.toContain('public.pages')
    expect(statements).not.toContain('featured_dish_ids')
  })

  it.each([
    ['the pages read', '@/lib/content/pages'],
    ['a draft write', '@/lib/publishing/drafts'],
    ['the publish transaction', '@/lib/publishing/publish'],
    ['the service-role client', '@/lib/supabase/service'],
  ])('the domain module never reaches for %s', (_what, needle) => {
    expect(domainModule).not.toContain(needle)
  })

  it('borrows only the role matrix and the entity registry from publishing', () => {
    const imports = [...domainModule.matchAll(/from '@\/lib\/publishing\/([a-z-]+)'/g)].map(
      (match) => match[1],
    )

    expect(imports.sort()).toEqual(['authorize', 'entities'])
  })

  it('expires no cache tag itself — it returns them for the action to expire', () => {
    expect(domainModule).not.toContain('@/lib/cache/invalidate')
    expect(domainModule).not.toContain('updateTag')
  })

  it('expires the cache only from the action, and only after the transaction', () => {
    const rpcCall = action.indexOf('setDishDeleted(')
    const expire = action.indexOf('expirePublicCacheTags(')

    expect(rpcCall).toBeGreaterThan(-1)
    expect(expire).toBeGreaterThan(rpcCall)
  })
})
