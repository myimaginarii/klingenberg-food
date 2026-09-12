import { describe, expect, it } from 'vitest'

import { BURGER_MENU_SECTION_ID } from '@/lib/content/types'
import {
  validateMenu,
  validateMonthlyBurger,
  validateTapas,
  validateWeeklySpecial,
} from '@/lib/content/validate/menu'
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

/**
 * The reserved section, as a menu that is about *other* sections still has to carry one.
 *
 * `category()` above already has the reserved id, because the section this suite reaches
 * for first happens to be Burgere. This is the same section with nothing in it, for the
 * cases that are building a menu out of other sections and only need the requirement
 * satisfied — it carries no dishes, so it never collides with theirs.
 */
const RESERVED = category({ id: BURGER_MENU_SECTION_ID, dishes: [] })

const check = (file: unknown): Problem[] => validateMenu(file, WHERE)
const messages = (problems: readonly Problem[]) =>
  problems.map((problem) => `${problem.where}: ${problem.message}`).join('\n')

/** A section as Pages CMS writes one with no dishes in it: without the key at all. */
const withoutDishes = ({ dishes, ...section }: Record<string, unknown>) => {
  void dishes
  return section
}

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

  /**
   * The two spellings of "this section has no dishes".
   *
   * `"dishes": []` is what somebody editing the JSON writes. **No `dishes` key at all**
   * is what Pages CMS writes, because it leaves an empty list out of the file — so the
   * first ordinary menu save turned Ugens ret and Tapasbordet, the two sections that
   * are never allowed to hold dishes, into sections with no `dishes` key. The build
   * refused the restaurant's own save; this is the case that must not come back.
   */
  it('accepts a section whose dishes list is left out entirely, exactly as an empty one', () => {
    const empty = category({ dishes: [] })
    const absent = withoutDishes(empty)

    expect(check(menu({ categories: [absent] }))).toEqual([])
    expect(check(menu({ categories: [absent] }))).toEqual(check(menu({ categories: [empty] })))
  })

  /**
   * And the same for the two sections it actually happened to. A section whose body is
   * another document may hold no dishes — leaving the list out is how it says so, and
   * it must not read as "a dish nobody would ever see" either.
   */
  it('accepts a section that draws another document and leaves its dishes list out', () => {
    for (const [kind, id, name] of [
      ['weekly_special', 'ugens-ret', 'Ugens ret'],
      ['tapas', 'tapas', 'Tapas'],
    ]) {
      const section = withoutDishes(category({ id, name, kind }))
      expect(messages(check({ categories: [RESERVED, section] })), `${kind}`).toBe('')
    }
  })

  it('accepts a section being removed, added or reordered — nothing here counts them', () => {
    const four = [
      RESERVED,
      category({ id: 'a', name: 'A', dishes: [dish({ id: 'a1' })] }),
      category({ id: 'b', name: 'B', dishes: [dish({ id: 'b1' })] }),
      category({ id: 'c', name: 'C', dishes: [] }),
      category({ id: 'd', name: 'D', kind: 'weekly_special', dishes: [] }),
    ]
    expect(check({ categories: four })).toEqual([])
    expect(check({ categories: four.slice(0, 2) })).toEqual([])
  })

  /**
   * Adding, removing and reordering dishes is the edit the restaurant makes most often,
   * and nothing about it is counted or fixed here — not how many a section has, not
   * which order they are in, and not which of them the Forside shows.
   */
  it('accepts dishes being added, removed and reordered, featured ones included', () => {
    const odin = dish({ featured: true })
    const frigg = dish({ id: 'frigg', name: 'Frigg', featured: true })
    const thor = dish({ id: 'thor', name: 'Thor' })

    expect(check(menu({ categories: [category({ dishes: [odin, frigg, thor] })] }))).toEqual([])
    expect(check(menu({ categories: [category({ dishes: [thor, odin, frigg] })] }))).toEqual([])
    expect(check(menu({ categories: [category({ dishes: [frigg] })] }))).toEqual([])
    expect(check(menu({ categories: [category({ dishes: [] })] }))).toEqual([])
  })

  it('accepts a section that says it holds ordinary dishes, and one that says nothing', () => {
    expect(check(menu({ categories: [category({ kind: 'dishes' })] }))).toEqual([])
    expect(check(menu({ categories: [category()] }))).toEqual([])
  })

  it('accepts a label nobody has approved: the badge draws an unknown label in the neutral tone', () => {
    expect(withDish({ labels: ['Pulled pork', 'Fars nye ret'] })).toEqual([])
  })

  it('accepts a price however it is written', () => {
    for (const price of ['89', '89,50', '89.50', '0', '1250']) expect(withDish({ price })).toEqual([])
  })
})

describe('a menu that would break a page', () => {
  /**
   * Leaving the list out is the one thing that means "no dishes". Everything else that
   * is not a list is still a mistake, and has to be named as one — including `""`,
   * which is what an emptied *text* control writes and which no list control writes.
   * The loader reads an absent list as `[]` and would put anything else through
   * `.map`, so validator and loader agree on exactly one extra spelling and no more.
   */
  it('refuses a dishes value that is written but is not a list', () => {
    for (const dishes of ['', 'Odin', 0, 5, true, {}, { odin: dish() }]) {
      expect(messages(check(menu({ categories: [category({ dishes })] }))), JSON.stringify(dishes))
        .toMatch(/Burgere → dishes: Skal være en liste/)
    }
  })

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
    for (const price of [89, '89 kr.', '12,345', '-5']) {
      const problems = withDish({ price })

      expect(problems[0]?.where).toBe('content/site/menu.json → Burgere → Odin → price')
      expect(problems[0]?.message).toMatch(/Prisen skrives i kroner .* f\.eks\. "89", "89,50"/)
    }
  })

  /**
   * A dish with no price is an ordinary dish — several sections price nothing per item
   * — and there are two ways to say so. `null` is what somebody writing the JSON types;
   * `""` is what a Pages CMS price field holds after it has been cleared (phase 4B).
   * Both are accepted here and both load as no price.
   */
  it('accepts a dish with no price, written as null, as "" or left out', () => {
    expect(withDish({ price: null })).toEqual([])
    expect(withDish({ price: '' })).toEqual([])
    expect(check(menu({ categories: [category({ dishes: [{ id: 'odin', name: 'Odin' }] })] }))).toEqual([])
  })

  /**
   * "Vis på forsiden" — the flag that puts a dish in the Forside's band (phase 4B).
   * Missing and `false` are the same answer; anything that is not a true/false switch
   * is refused, because the renderer reads it as one.
   */
  it('takes the Forside flag as a true/false switch, absent meaning off', () => {
    expect(withDish({ featured: true })).toEqual([])
    expect(withDish({ featured: false })).toEqual([])
    expect(messages(withDish({ featured: 'ja' }))).toMatch(
      /Odin → featured: Skal være true eller false/,
    )
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

  it('refuses a section type outside the three the renderer switches on', () => {
    expect(messages(check(menu({ categories: [category({ kind: 'dessert' })] })))).toMatch(
      /kind: Skal være "dishes", "weekly_special" eller "tapas"/,
    )
  })

  it('refuses a second section of a kind that draws one document', () => {
    const twice = (kind: string) =>
      check({
        categories: [
          category({ id: 'et', name: 'Et', kind, dishes: [] }),
          category({ id: 'to', name: 'To', kind, dishes: [] }),
        ],
      })

    expect(messages(twice('weekly_special'))).toMatch(
      /Kun én sektion kan have "kind": "weekly_special"\. Den viser Ugens ret/,
    )
    expect(messages(twice('tapas'))).toMatch(
      /Kun én sektion kan have "kind": "tapas"\. Den viser tapasbordet, som er ét dokument \(content\/site\/tapas\.json\)/,
    )
  })

  /**
   * Two of the three bodies `MenuCategorySection` can draw replace the section's dish
   * list rather than adding to it, so a dish put in one of those sections is a dish
   * nobody will ever see. Neither restriction is fixed here: lifting one means
   * changing the renderer.
   */
  it('refuses a dish put in a section whose body replaces the dish list', () => {
    const weekly = check({
      categories: [category({ id: 'ugens-ret', name: 'Ugens ret', kind: 'weekly_special' })],
    })
    expect(messages(weekly)).toMatch(
      /Denne sektion viser Ugens ret \(content\/site\/weekly-special\.json\) i stedet for en liste af retter/,
    )

    const board = check({
      categories: [category({ id: 'tapas', name: 'Tapas', kind: 'tapas' })],
    })
    expect(messages(board)).toMatch(
      /Denne sektion viser tapasbordet \(content\/site\/tapas\.json\) i stedet for en liste af retter/,
    )
  })

  /**
   * The board moved out of the dish in phase 4D. A leftover `tapas` field is content
   * nobody would ever see again, so it is named rather than quietly dropped — and the
   * sentence says where the board lives now.
   */
  it('refuses a leftover tapas field on a dish, and names the document it moved to', () => {
    const problems = withDish({ tapas: { groups: [] } })

    expect(problems[0]?.where).toBe('content/site/menu.json → Burgere → Odin → tapas')
    expect(problems[0]?.message).toMatch(
      /ikke længere et felt på en ret.*content\/site\/tapas\.json.*"kind": "tapas"/s,
    )
  })
})

/**
 * The one section id the application really requires — `BURGER_MENU_SECTION_ID`.
 *
 * Månedens burger is drawn at the end of that section (`MenuCategorySection`) and its
 * introduction is the one piece of menu prose whose prices are joined to "kr."
 * (`lib/content/load/menu.ts`). Both find the section by its id, and Pages CMS hands the
 * restaurant that id field — it has to, or no new section could ever be made. So a save
 * that renamed `burgere` would stay structurally valid and quietly take Månedens burger
 * off the menu. This is where that stops, rather than in a CMS `readonly` flag: the
 * validator is the boundary every write path goes through, a hand-edited file included.
 *
 * Both directions are proved. What is held is the id and the body it draws; what is
 * emphatically not held is the section's heading, its place on the card, anything inside
 * it, or any other section's id.
 */
describe('the reserved burger section', () => {
  /** The reserved section with something about it changed, as the only section. */
  const reserved = (over: Record<string, unknown> = {}) => check(menu({ categories: [category(over)] }))

  /** Two ordinary sections the reserved one can be moved around. */
  const others = () => [
    category({ id: 'drikkevarer', name: 'Drikkevarer', dishes: [dish({ id: 'cola', name: 'Cola' })] }),
    category({ id: 'dessert', name: 'Dessert', dishes: [] }),
  ]

  it('lets the restaurant reword the heading a guest reads, keeping the id', () => {
    expect(reserved({ name: 'Vores burgere' })).toEqual([])
    expect(reserved({ name: 'Burgere & sandwich' })).toEqual([])
  })

  it('lets the section stand anywhere on the card', () => {
    const [drinks, dessert] = others()

    expect(check({ categories: [category(), drinks!, dessert!] })).toEqual([])
    expect(check({ categories: [drinks!, category(), dessert!] })).toEqual([])
    expect(check({ categories: [drinks!, dessert!, category()] })).toEqual([])
  })

  it('lets its prose, its dishes, their prices and their Forside marks be edited freely', () => {
    expect(
      reserved({
        intro: 'En helt anden indledning, til 95 kr.',
        note: 'Glutenfri bolle kan vælges til.',
        dishes: [
          dish({
            id: 'ny-burger',
            name: 'Ny burger',
            price: '129,50',
            description: 'Noget der aldrig har stået her.',
            labels: ['Ny'],
            featured: true,
          }),
        ],
      }),
    ).toEqual([])

    expect(reserved({ dishes: [] })).toEqual([])
    expect(reserved({ kind: 'dishes' })).toEqual([])
  })

  it('leaves every other section’s id the restaurant’s own', () => {
    const renamed = [
      category({ id: 'desserter', name: 'Dessert', dishes: [] }),
      category({ id: 'noget-nyt', name: 'Noget nyt', dishes: [dish({ id: 'nyt', name: 'Nyt' })] }),
    ]

    expect(check({ categories: [category(), ...renamed] })).toEqual([])
  })

  it('refuses the technical id being renamed, and says it is the id that may not change', () => {
    const problems = check(menu({ categories: [category({ id: 'burgers' })] }))

    expect(problems[0]?.where).toBe('content/site/menu.json → categories')
    expect(problems[0]?.message).toMatch(
      /Menuen skal have et afsnit, hvis korte navn til systemet er "burgere"/,
    )
    expect(problems[0]?.message).toMatch(/må ikke laves om, og afsnittet må ikke slettes/)
  })

  it('refuses the section being deleted, with the same sentence', () => {
    const problems = check({ categories: others() })

    expect(problems[0]?.where).toBe('content/site/menu.json → categories')
    expect(problems[0]?.message).toMatch(
      /Menuen skal have et afsnit, hvis korte navn til systemet er "burgere"/,
    )
  })

  /**
   * `MonthlyBurgerCard` is drawn inside the ordinary dish list and nowhere else, so a
   * reserved section that draws Ugens ret or the tapas board instead is a section the
   * burger has no place in — the same loss as deleting it, spelled differently.
   */
  it('refuses the reserved section drawing another document instead of ordinary dishes', () => {
    for (const kind of ['weekly_special', 'tapas']) {
      const problems = check({ categories: [withoutDishes(category({ kind }))] })

      expect(messages(problems), kind).toMatch(
        /Afsnittet med det korte navn "burgere" skal være et afsnit med almindelige retter/,
      )
      expect(messages(problems), kind).toMatch(/Månedens burger ville forsvinde fra menuen/)
    }
  })

  /**
   * Two of them needs nothing of its own: the id is a section's address, and the rule
   * that says an address cannot be shared already names the second section.
   */
  it('refuses a second section carrying the id, through the rule that ids are addresses', () => {
    const problems = check({
      categories: [category(), category({ name: 'Burgere igen', dishes: [dish({ id: 'thor' })] })],
    })

    expect(messages(problems)).toMatch(
      /Burgere igen → id: "burgere" står mere end ét sted\. Id’et er sektionens adresse/,
    )
  })
})

describe('the tapas board', () => {
  const TAPAS = 'content/site/tapas.json'
  const board = (groups: unknown[], over: Record<string, unknown> = {}) =>
    validateTapas({ price: '295', groups, ...over }, TAPAS)

  it('accepts the confirmed board, and one with no price', () => {
    const groups = [
      { id: 'base', heading: 'Altid med på bordet', mode: 'fixed', items: ['Hjemmebagt brød'] },
    ]
    expect(board(groups, { secondaryNote: '+148 kr. pr. ekstra person' })).toEqual([])
    expect(board(groups, { price: null })).toEqual([])
    expect(board(groups, { price: '' })).toEqual([])
  })

  it('refuses a price the menu parser cannot read, and a note that is not text', () => {
    expect(
      messages(board([{ id: 'base', heading: 'Altid med', mode: 'fixed', items: ['Brie'] }], { price: '295 kr.' })),
    ).toMatch(/tapas\.json → price: Prisen skrives i kroner/)
    expect(
      messages(
        board([{ id: 'base', heading: 'Altid med', mode: 'fixed', items: ['Brie'] }], { secondaryNote: 7 }),
      ),
    ).toMatch(/tapas\.json → secondaryNote: Skal være tekst/)
  })

  it('refuses a board that is not an object, and one with no lists', () => {
    expect(messages(validateTapas('nej', TAPAS))).toMatch(/tapas\.json: Skal være/)
    expect(messages(board([]))).toMatch(/Et tapasbord skal have mindst én liste/)
  })

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
