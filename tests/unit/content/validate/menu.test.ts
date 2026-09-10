import { describe, expect, it } from 'vitest'

import { validateMenu, validateMonthlyBurger, validateWeeklySpecial } from '@/lib/content/validate/menu'
import type { Problem } from '@/lib/content/validate/problems'

/**
 * The menu's rules — `lib/content/validate/menu.ts`.
 *
 * Two things are being proved, and the second matters as much as the first: that a
 * mistake is caught and named in Danish, and that a **legitimate edit is not**. The
 * restaurant is meant to add and remove dishes, add and remove whole sections, change
 * every price and reorder the card; a validator that quietly froze today's menu would
 * be worse than no validator at all. So each group below has at least one case that
 * must pass.
 *
 * WHAT IS NOT RE-TESTED HERE. A price is whatever `oreFromKroner` accepts, a
 * photograph whatever `photoSourceFrom` accepts, a slug whatever `isNewsSlug` accepts
 * — and each of those grammars has its own test file. What is proved below is the
 * *integration*: that the field is put through the right parser, and that its refusal
 * comes back as a Danish sentence under the way into that field.
 */

const WHERE = 'content/site/menu.json'

/** The smallest menu that is genuinely usable: one section, one dish. */
const dish = (over: Record<string, unknown> = {}) => ({ id: 'odin', name: 'Odin', price: '89', ...over })
const category = (over: Record<string, unknown> = {}) => ({
  id: 'burgere',
  name: 'Burgere',
  dishes: [dish()],
  ...over,
})
const menu = (over: Record<string, unknown> = {}) => ({ categories: [category()], ...over })

const check = (file: unknown): Problem[] => validateMenu(file, WHERE)
const messages = (problems: readonly Problem[]) =>
  problems.map((problem) => `${problem.where}: ${problem.message}`).join('\n')

/** The same menu with one dish replaced — the shape most cases below need. */
const withDish = (over: Record<string, unknown>) =>
  check(menu({ categories: [category({ dishes: [dish(over)] })] }))

describe('a menu the restaurant is allowed to have', () => {
  it('accepts the smallest usable menu', () => {
    expect(check(menu())).toEqual([])
  })

  it('accepts a section with no dishes, and a menu with no weekly-special section', () => {
    expect(check(menu({ categories: [category({ dishes: [] })] }))).toEqual([])
  })

  it('accepts a section being removed, added or reordered — nothing here counts them', () => {
    const four = [
      category({ id: 'a', name: 'A' }),
      category({ id: 'b', name: 'B', dishes: [dish({ id: 'b1' })] }),
      category({ id: 'c', name: 'C', dishes: [] }),
      category({ id: 'd', name: 'D', kind: 'weekly_special', dishes: [] }),
    ]
    expect(check({ categories: four })).toEqual([])
    expect(check({ categories: four.slice(0, 2) })).toEqual([])
  })

  it('accepts a label nobody has approved: the badge draws an unknown label in the neutral tone', () => {
    expect(withDish({ labels: ['Pulled pork', 'Fars nye ret'] })).toEqual([])
  })

  it('accepts a price however it is written', () => {
    for (const price of ['89', '89,50', '89.50', '0', '1250']) expect(withDish({ price })).toEqual([])
  })
})

describe('a menu that would break a page', () => {
  it('refuses two sections with the same id — one anchor cannot serve both', () => {
    const problems = check({
      categories: [category(), category({ name: 'Burgere igen', dishes: [dish({ id: 'thor' })] })],
    })

    expect(messages(problems)).toMatch(
      /Burgere igen → id: "burgere" står mere end ét sted\. Id’et er sektionens adresse/,
    )
  })

  it('refuses two dishes with the same id anywhere in the menu', () => {
    const problems = check({
      categories: [category(), category({ id: 'andre', name: 'Andre retter', dishes: [dish()] })],
    })

    expect(messages(problems)).toMatch(
      /Andre retter → Odin → id: "odin" står mere end ét sted\. Id’et er rettens faste identitet/,
    )
  })

  it('refuses an id that is not a slug, naming the field', () => {
    const problems = check(menu({ categories: [category({ id: 'Ugens Ret' })] }))

    expect(problems[0]?.where).toBe('content/site/menu.json → Burgere → id')
    expect(problems[0]?.message).toMatch(/kun bestå af små bogstaver/)
  })

  /** The grammar itself is `oreFromKroner`'s; this proves the field goes through it. */
  it('refuses a price the menu parser cannot read, naming the dish', () => {
    for (const price of [89, '89 kr.', '']) {
      const problems = withDish({ price })

      expect(problems[0]?.where).toBe('content/site/menu.json → Burgere → Odin → price')
      expect(problems[0]?.message).toMatch(/Prisen skrives i kroner .* f\.eks\. "89", "89,50"/)
    }
  })

  it('refuses a dish with no name, and a section with no heading', () => {
    expect(messages(check(menu({ categories: [category({ dishes: [dish({ name: '' })] })] })))).toMatch(
      /Burgere → ret 1 → name: Skal udfyldes\./,
    )
    expect(messages(check(menu({ categories: [category({ name: null })] })))).toMatch(
      /sektion 1 → name: Skal udfyldes\./,
    )
  })

  /**
   * Labels are not a closed vocabulary — see the note in `validateLabels`. What is
   * refused is a label that is not text and the same chip printed twice on one card.
   */
  it('refuses a label that is not a text, and the same label twice on one dish', () => {
    expect(messages(withDish({ labels: [7] }))).toMatch(/labels → 1: Skal være tekst/)
    expect(messages(withDish({ labels: ['Ny', 'Ny'] }))).toMatch(
      /labels → 2: "Ny" står mere end ét sted/,
    )
  })

  it('refuses a sold-out date that is not a real day in the calendar', () => {
    const problems = withDish({ soldOutOn: '2026-02-31' })

    expect(problems[0]?.where).toBe('content/site/menu.json → Burgere → Odin → soldOutOn')
    expect(problems[0]?.message).toMatch(/rigtig dato skrevet som "2026-12-24"/)
  })

  it('refuses a section type outside the two the renderer switches on', () => {
    expect(messages(check(menu({ categories: [category({ kind: 'tapas' })] })))).toMatch(
      /kind: Skal være "dishes" eller "weekly_special"/,
    )
  })

  it('refuses a second weekly-special section: Ugens ret is one document, not two cards', () => {
    const problems = check({
      categories: [
        category({ id: 'uge-1', name: 'Uge 1', kind: 'weekly_special', dishes: [] }),
        category({ id: 'uge-2', name: 'Uge 2', kind: 'weekly_special', dishes: [] }),
      ],
    })

    expect(messages(problems)).toMatch(/Kun én sektion kan have "kind": "weekly_special"/)
  })

  /**
   * Two of the three bodies `MenuCategorySection` can draw replace the section's dish
   * list rather than adding to it, so a dish put in one of those sections is a dish
   * nobody will ever see. Neither restriction is fixed here: lifting one means
   * changing the renderer, which phase 3 does not do.
   */
  it('refuses a dish put in a section whose body replaces the dish list', () => {
    const weekly = check({
      categories: [category({ id: 'ugens-ret', name: 'Ugens ret', kind: 'weekly_special' })],
    })
    expect(messages(weekly)).toMatch(/retterne her ville ikke blive vist nogen steder/)

    const board = { groups: [{ id: 'base', heading: 'Altid med', mode: 'fixed', items: ['Brød'] }] }
    const beside = check(
      menu({
        categories: [
          category({ dishes: [dish({ tapas: board }), dish({ id: 'pommes', name: 'Pommes' })] }),
        ],
      }),
    )
    expect(messages(beside)).toMatch(/Et tapasbord fylder hele sektionen/)

    const two = check(
      menu({
        categories: [
          category({
            dishes: [dish({ tapas: board }), dish({ id: 'tapas-2', tapas: board })],
          }),
        ],
      }),
    )
    expect(messages(two)).toMatch(/Et tapasbord fylder hele sektionen/)
  })
})

describe('the tapas board', () => {
  const board = (groups: unknown[]) => withDish({ tapas: { groups } })

  it('accepts the shape the renderer draws', () => {
    expect(
      board([
        { id: 'base', heading: 'Altid med på bordet', mode: 'fixed', items: ['Hjemmebagt brød'] },
        { id: 'choose7', heading: 'I vælger 7', mode: 'choose', choose: 7, items: ['Chorizo', 'Brie'] },
      ]),
    ).toEqual([])
  })

  it('refuses a group id outside the three the type names', () => {
    expect(messages(board([{ id: 'ost', heading: 'Ost', mode: 'fixed', items: ['Brie'] }]))).toMatch(
      /id: Skal være "base", "choose7" eller "dressing"/,
    )
  })

  it('refuses a choose-list that does not say how many, and a fixed list that does', () => {
    expect(
      messages(board([{ id: 'choose7', heading: 'I vælger', mode: 'choose', items: ['Brie'] }])),
    ).toMatch(/skal sige hvor mange der vælges/)
    expect(
      messages(board([{ id: 'base', heading: 'Altid med', mode: 'fixed', choose: 3, items: ['Brie'] }])),
    ).toMatch(/Fjern "choose"/)
  })

  it('refuses the same item twice in one list — the renderer keys each line by its text', () => {
    expect(
      messages(board([{ id: 'base', heading: 'Altid med', mode: 'fixed', items: ['Brie', 'Brie'] }])),
    ).toMatch(/items → 2: "Brie" står mere end ét sted/)
  })
})

describe('the photograph on a dish', () => {
  const withPhoto = (photo: unknown) => withDish({ photo })

  it('accepts a photograph that is in public/photos/, and no photograph at all', () => {
    expect(withPhoto({ file: '/photos/dish-odin.png', alt: '', focus: 'upper' })).toEqual([])
    expect(withPhoto(null)).toEqual([])
    expect(withPhoto({ file: null })).toEqual([])
  })

  /**
   * Phase 2's gate is reused rather than reimplemented, and its grammar is covered in
   * `tests/unit/images/photos.test.ts`. What is proved here is that a dish's `photo`
   * goes through that gate, and that both of its two refusals — an unusable name, and
   * a name of a file that is not there — arrive under the field that caused them.
   */
  it('refuses an unsafe photograph through the phase-2 rules', () => {
    for (const file of ['../secret.png', '/photos/foo.svg']) {
      const problems = withPhoto({ file })

      expect(problems[0]?.where).toBe('content/site/menu.json → Burgere → Odin → photo.file')
      expect(problems[0]?.message).toMatch(/Skal være en fil i public\/photos\//)
    }
  })

  it('refuses a photograph that is not in the folder, and says so differently', () => {
    const problems = withPhoto({ file: '/photos/dish-loke.png' })

    expect(problems[0]?.where).toBe('content/site/menu.json → Burgere → Odin → photo.file')
    expect(problems[0]?.message).toMatch(/ligger ikke i public\/photos\//)
  })

  it('refuses a crop outside the vocabulary the frames carry', () => {
    const problems = withPhoto({ file: '/photos/dish-odin.png', focus: 'top-left' })

    expect(problems[0]?.where).toBe('content/site/menu.json → Burgere → Odin → photo.focus')
    expect(problems[0]?.message).toMatch(/Skal være "center" eller "upper"/)
  })
})

describe('ugens ret and månedens burger', () => {
  const weekly = 'content/site/weekly-special.json'
  const monthly = 'content/site/monthly-burger.json'

  it('accepts the empty state both files are in today', () => {
    expect(validateWeeklySpecial({ active: false, name: null, days: [] }, weekly)).toEqual([])
    expect(validateMonthlyBurger({ active: false, name: null }, monthly)).toEqual([])
  })

  it('refuses an active week or month with nothing in it', () => {
    expect(messages(validateWeeklySpecial({ active: true }, weekly))).toMatch(
      /weekly-special\.json → name: Skal udfyldes\./,
    )
    expect(messages(validateMonthlyBurger({ active: true }, monthly))).toMatch(
      /monthly-burger\.json → name: Skal udfyldes\./,
    )
  })

  it('refuses a weekday the days line would silently drop', () => {
    expect(messages(validateWeeklySpecial({ active: false, days: ['wed', 'lørdag'] }, weekly))).toMatch(
      /days → 2: Skal være "mon", "tue"/,
    )
  })

  it('refuses a week number the "Uge 42" line could not print', () => {
    expect(messages(validateWeeklySpecial({ active: false, isoWeek: 99 }, weekly))).toMatch(
      /isoWeek: Skal være et helt tal mellem 1 og 53/,
    )
  })

  it('refuses a window that ends before it starts — it would never open', () => {
    const problems = validateMonthlyBurger(
      { active: true, name: 'Loke', startsOn: '2026-10-01', endsOn: '2026-09-01' },
      monthly,
    )

    expect(messages(problems)).toMatch(/ligger før startdatoen/)
  })
})
