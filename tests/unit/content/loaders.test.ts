import { describe, expect, it } from 'vitest'

import { announcementFrom } from '@/lib/content/load/announcement'
import { openingHoursFrom } from '@/lib/content/load/hours'
import { menuCategoriesFrom, tapasBoardFrom } from '@/lib/content/load/menu'
import { newsArticleFrom, type NewsFile } from '@/lib/content/load/news'
import { oreFromKroner } from '@/lib/content/load/price'
import { keepPriceTogether, prose } from '@/lib/content/load/text'

/**
 * The loader boundary — `lib/content/load/`: what a stored value *means*.
 *
 * Each conversion is a pure function of a file's contents, tested here as one, so the
 * rules an editor relies on are pinned without a fixture tree: a price is a kroner
 * string and never a float, a price stays on one line, a day is closed or open, an
 * inactive announcement is no announcement, and a draft article does not exist.
 */

const NO_BREAK_SPACE = String.fromCharCode(0xa0)

describe('oreFromKroner', () => {
  it('turns a kroner string into whole øre', () => {
    expect(oreFromKroner('89', 'test')).toBe(8900)
    expect(oreFromKroner('295', 'test')).toBe(29500)
    expect(oreFromKroner('5', 'test')).toBe(500)
    expect(oreFromKroner('0', 'test')).toBe(0)
  })

  it('accepts a comma or a point and one or two decimals, without floating-point arithmetic', () => {
    expect(oreFromKroner('12,50', 'test')).toBe(1250)
    expect(oreFromKroner('12.5', 'test')).toBe(1250)
    expect(oreFromKroner('0,1', 'test')).toBe(10)
    expect(oreFromKroner('19,99', 'test')).toBe(1999)
    expect(oreFromKroner(' 24 ', 'test')).toBe(2400)
  })

  /**
   * Three spellings of "this entry has no price": the field left out, written `null`
   * by hand, or cleared in a Pages CMS form, which writes `""` (phase 4B).
   */
  it('answers null for a priceless entry, however the field was emptied', () => {
    expect(oreFromKroner(null, 'test')).toBeNull()
    expect(oreFromKroner(undefined, 'test')).toBeNull()
    expect(oreFromKroner('', 'test')).toBeNull()
  })

  it.each(['89 kr.', '12,345', '-5', '1.2.3', 'gratis', ' '])('refuses %j, naming the entry', (value) => {
    expect(() => oreFromKroner(value, 'content/site/menu.json: dish "odin"')).toThrow(
      /content\/site\/menu\.json: dish "odin": a price is written in kroner/,
    )
  })

  it('refuses a number: a price is a string an editor wrote, never a float', () => {
    expect(() => oreFromKroner(89 as unknown as string, 'test')).toThrow(/written in kroner/)
  })
})

describe('keepPriceTogether', () => {
  it('joins a number to "kr." with a non-breaking space, every time it occurs', () => {
    expect(keepPriceTogether('Som menu: 124 kr., Ragnar 132 kr.')).toBe(
      `Som menu: 124${NO_BREAK_SPACE}kr., Ragnar 132${NO_BREAK_SPACE}kr.`,
    )
  })

  it('is applied to the Burgere intro alone: every other section intro is the text as written', () => {
    const categories = menuCategoriesFrom(
      {
        categories: [
          { id: 'burgere', name: 'Burgere', intro: 'Som menu: 124 kr., Ragnar 132 kr.', dishes: [] },
          {
            id: 'tapas',
            name: 'Tapas',
            intro: 'Til to personer 295 kr. · hver ekstra person 148 kr.',
            note: '+148 kr. pr. ekstra person',
            dishes: [],
          },
        ],
      },
      'test',
    )
    const [burgers, tapas] = categories
    expect(burgers?.intro).toBe(`Som menu: 124${NO_BREAK_SPACE}kr., Ragnar 132${NO_BREAK_SPACE}kr.`)
    expect(tapas?.intro).toBe('Til to personer 295 kr. · hver ekstra person 148 kr.')
    expect(tapas?.note).toBe('+148 kr. pr. ekstra person')
  })

  it('rewrites nothing else', () => {
    expect(keepPriceTogether('Til to personer')).toBe('Til to personer')
    expect(keepPriceTogether('ca. 100 kroner')).toBe('ca. 100 kroner')
    expect(keepPriceTogether('100 kr uden punktum')).toBe('100 kr uden punktum')
    expect(keepPriceTogether('kr. 100')).toBe('kr. 100')
    expect(keepPriceTogether('1.500 g · frost')).toBe('1.500 g · frost')
  })

  it('leaves a price that is already joined alone', () => {
    const joined = `295${NO_BREAK_SPACE}kr.`
    expect(keepPriceTogether(joined)).toBe(joined)
  })

  /**
   * A dish whose optional controls are all empty, in the spelling the *content
   * contract* allows rather than the one Pages CMS happens to write: every unused
   * optional field as `""` or `null`, and the photograph as an object with no file
   * selected. A measured CMS save leaves those keys out instead
   * (`tests/unit/content/cms-empty-values.test.ts` states what it really does), so this
   * is the tolerance half of the rule — hand-written JSON and an older save are both
   * still read as the dish they are, the same value and not a nearly-identical one.
   */
  it('reads a dish whose optional controls are all empty as a dish with none', () => {
    const bare = { id: 'thor', name: 'Thor', price: '89' }
    const saved = {
      ...bare,
      description: null,
      secondaryNote: null,
      soldOutOn: '',
      photo: { file: '', alt: '', focus: 'center' },
    }
    const load = (dish: unknown) =>
      menuCategoriesFrom(
        { categories: [{ id: 'burgere', name: 'Burgere', dishes: [dish] as never }] } as never,
        'test',
      )[0]?.dishes[0]

    expect(load(saved)).toEqual(load(bare))
    expect(load(saved)).toMatchObject({ priceOre: 8900, soldOutOn: null, image: null, featured: false })
  })

  /**
   * The other thing a Pages CMS save does to a section: an empty dish list is not
   * written at all. A section with no `dishes` key is the section that had
   * `"dishes": []` — the same `MenuCategory`, not one the loader has to be defended
   * from — and the dish-id uniqueness check has to survive reading it too.
   */
  it('reads a section with no dishes list as the section that had an empty one', () => {
    const load = (category: unknown) =>
      menuCategoriesFrom({ categories: [category] } as never, 'test')[0]

    const empty = load({ id: 'ugens-ret', name: 'Ugens ret', kind: 'weekly_special', dishes: [] })
    const absent = load({ id: 'ugens-ret', name: 'Ugens ret', kind: 'weekly_special' })

    expect(absent).toEqual(empty)
    expect(absent?.dishes).toEqual([])
  })

  it('still refuses a dish id used twice when one section has no dishes list', () => {
    expect(() =>
      menuCategoriesFrom(
        {
          categories: [
            { id: 'ugens-ret', name: 'Ugens ret', kind: 'weekly_special' },
            { id: 'burgere', name: 'Burgere', dishes: [{ id: 'odin', name: 'Odin' }] },
            { id: 'andre', name: 'Andre', dishes: [{ id: 'odin', name: 'Odin' }] },
          ],
        } as never,
        'test',
      ),
    ).toThrow(/the dish id "odin" is used more than once/)
  })

  it('reads an absent prose field as null and a present one exactly as written', () => {
    expect(prose(null)).toBeNull()
    expect(prose(undefined)).toBeNull()
    expect(prose('+148 kr. pr. ekstra person')).toBe('+148 kr. pr. ekstra person')
  })
})

/**
 * The tapas board is read from its own document (phase 4D), so its conversion is a
 * function of that file and nothing else: a kroner price becomes øre, an emptied
 * `choose` becomes `null` whichever way it was emptied, and the lists arrive in the
 * order they are written. No dish is involved at any point.
 */
describe('tapasBoardFrom', () => {
  const groups = [
    { id: 'base' as const, heading: 'Altid med', mode: 'fixed' as const, items: ['Oliven'] },
    {
      id: 'choose7' as const,
      heading: 'I vælger 7',
      mode: 'choose' as const,
      choose: 7,
      items: ['Brie', 'Chorizo'],
    },
  ]

  it('turns the written board into the one the renderer draws', () => {
    expect(
      tapasBoardFrom({ price: '295', secondaryNote: '+148 kr. pr. ekstra person', groups }, 'test'),
    ).toEqual({
      priceOre: 29500,
      secondaryNote: '+148 kr. pr. ekstra person',
      groups: [
        { id: 'base', heading: 'Altid med', mode: 'fixed', choose: null, items: ['Oliven'] },
        { id: 'choose7', heading: 'I vælger 7', mode: 'choose', choose: 7, items: ['Brie', 'Chorizo'] },
      ],
    })
  })

  it('reads a board whose optional controls were cleared as a board with none', () => {
    const cleared = tapasBoardFrom(
      { price: '', secondaryNote: null, groups: [{ ...groups[0]!, choose: '' }] },
      'test',
    )

    expect(cleared.priceOre).toBeNull()
    expect(cleared.secondaryNote).toBeNull()
    expect(cleared.groups[0]?.choose).toBeNull()
  })
})

describe('openingHoursFrom', () => {
  const closed = { closed: true, from: null, to: null }
  const open = { closed: false, from: '15:00', to: '20:00' }
  const week = { mon: closed, tue: closed, wed: open, thu: open, fri: open, sat: open, sun: open }

  it('turns the uniform per-day entries into the engine\'s closed-or-open days', () => {
    const hours = openingHoursFrom({ schedule: week, overrides: [] }, 'hours.json')
    expect(hours.schedule.mon).toEqual({ closed: true })
    expect(hours.schedule.wed).toEqual({ from: '15:00', to: '20:00' })
    expect(Object.keys(hours.schedule)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    expect(hours.overrides).toEqual([])
  })

  it('accepts a closed day written with only its flag', () => {
    const hours = openingHoursFrom({ schedule: { ...week, mon: { closed: true } } }, 'hours.json')
    expect(hours.schedule.mon).toEqual({ closed: true })
  })

  it('fills in the null halves of an override', () => {
    const hours = openingHoursFrom(
      {
        schedule: week,
        overrides: [{ date: '2026-12-24', kind: 'closed', status: 'published' }],
      },
      'hours.json',
    )
    expect(hours.overrides).toEqual([
      { date: '2026-12-24', kind: 'closed', opensAt: null, closesAt: null, status: 'published' },
    ])
  })

  /**
   * A closed special day has no hours, and there are two ways for it to say so: `null`
   * from a hand-written file, `""` from a Pages CMS time field nobody filled in.
   */
  it('reads an emptied time control as no time, exactly as null', () => {
    const hours = openingHoursFrom(
      {
        schedule: week,
        overrides: [
          { date: '2026-12-24', kind: 'closed', opensAt: '', closesAt: '', status: 'published' },
        ],
      },
      'hours.json',
    )
    expect(hours.overrides).toEqual([
      { date: '2026-12-24', kind: 'closed', opensAt: null, closesAt: null, status: 'published' },
    ])
  })

  it('refuses a missing weekday and an open day without both times, naming the day', () => {
    const sixDays = { mon: closed, tue: closed, wed: open, thu: open, fri: open, sat: open }
    expect(() => openingHoursFrom({ schedule: sixDays }, 'content/site/hours.json')).toThrow(
      /content\/site\/hours\.json: schedule\.sun is missing/,
    )
    expect(() =>
      openingHoursFrom({ schedule: { ...week, fri: { closed: false, from: '15:00' } } }, 'hours.json'),
    ).toThrow(/schedule\.fri: an open day needs both "from" and "to"/)
  })
})

describe('announcementFrom', () => {
  const where = 'content/site/announcement.json'

  it('reads an inactive document as no announcement at all, whatever else it says', () => {
    expect(announcementFrom({ active: false }, where)).toBeNull()
    expect(
      announcementFrom(
        { active: false, message: 'Lukket juleaften', expiresAt: '2026-12-25T00:00' },
        where,
      ),
    ).toBeNull()
  })

  it('refuses an active document without a message or an expiry, by name', () => {
    expect(() => announcementFrom({ active: true, message: 'Hej' }, where)).toThrow(
      /content\/site\/announcement\.json is active but has no message or no expiresAt/,
    )
  })

  it('hands the link to the existing resolver, so a page link keeps the site\'s own rules', () => {
    const announcement = announcementFrom(
      {
        active: true,
        message: 'Nye åbningstider fra 1. oktober',
        expiresAt: '2026-10-01T00:00',
        link: { type: 'page', page: '/find-os' },
      },
      where,
    )
    expect(announcement).toEqual({
      message: 'Nye åbningstider fra 1. oktober',
      // Midnight on 1 October is still summer time in Denmark, so the wall clock the
      // file holds resolves to 22:00Z the evening before.
      expiresAt: '2026-09-30T22:00:00.000Z',
      link: { href: '/find-os', label: 'Find os', external: false },
    })
  })

  /**
   * The resolver's consistency rule is written about `null`: a link of one kind with
   * the other kind's field still filled in is no link at all. A Pages CMS form clears
   * the controls it is not using to `""` rather than to `null`, so a perfectly ordinary
   * page link arrives with an empty `url` beside it — and used to resolve to nothing
   * (phase 4B).
   */
  it('reads a control the editor left empty as empty, not as the other kind of link', () => {
    expect(
      announcementFrom(
        {
          active: true,
          message: 'Nye åbningstider',
          expiresAt: '2026-10-01T00:00',
          link: { type: 'page', page: '/find-os', url: '', label: '' },
        },
        where,
      )?.link,
    ).toEqual({ href: '/find-os', label: 'Find os', external: false })

    expect(
      announcementFrom(
        {
          active: true,
          message: 'Læs mere',
          expiresAt: '2026-10-01T00:00',
          link: { type: 'url', url: 'https://www.facebook.com/carlnielsencafeen', page: '', label: 'Læs mere' },
        },
        where,
      )?.link,
    ).toEqual({
      href: 'https://www.facebook.com/carlnielsencafeen',
      label: 'Læs mere',
      external: true,
    })
  })

  it('drops a link the resolver refuses, and renders the message alone', () => {
    const announcement = announcementFrom(
      {
        active: true,
        message: 'Menu til 89 kr. i dag',
        expiresAt: '2026-10-01T00:00',
        link: { type: 'url', url: 'http://example.test/', label: 'Læs mere' },
      },
      where,
    )
    expect(announcement?.link).toBeNull()
    expect(announcement?.message).toBe('Menu til 89 kr. i dag')
  })

  /**
   * The phase 4F conversion — the only value this loader transforms.
   *
   * The file holds a Copenhagen wall clock and the loaded announcement holds an
   * absolute instant, so the same written time is a different moment in July than it is
   * in December. That is the whole reason the offset is *not* stored: the restaurant
   * writes "noon" once and means noon in both halves of the year.
   *
   * The DST rules themselves are not restated here. `copenhagenInstantOf` owns them and
   * `tests/unit/time/copenhagen.test.ts` pins them; these assertions only prove that
   * this loader goes through that function and hands on what it answered.
   */
  describe('the Copenhagen wall clock it is given', () => {
    const at = (expiresAt: string) =>
      announcementFrom({ active: true, message: 'Hej', expiresAt }, where)?.expiresAt

    it('resolves a summer wall clock on CEST, two hours ahead of UTC', () => {
      expect(at('2026-09-11T12:00')).toBe('2026-09-11T10:00:00.000Z')
    })

    it('resolves a winter wall clock on CET, one hour ahead of UTC', () => {
      expect(at('2026-12-11T12:00')).toBe('2026-12-11T11:00:00.000Z')
    })

    it('follows the same wall clock across both transitions of one year', () => {
      // Noon, written four times, meaning four different instants either side of the
      // last Sunday in March and the last Sunday in October.
      expect(at('2026-03-28T12:00')).toBe('2026-03-28T11:00:00.000Z') // CET
      expect(at('2026-03-30T12:00')).toBe('2026-03-30T10:00:00.000Z') // CEST
      expect(at('2026-10-24T12:00')).toBe('2026-10-24T10:00:00.000Z') // CEST
      expect(at('2026-10-26T12:00')).toBe('2026-10-26T11:00:00.000Z') // CET
    })

    it('uses the existing rule for a wall clock the spring-forward skips', () => {
      // 02:30 does not happen on 29 March 2026: the clocks jump 02:00 → 03:00.
      // `copenhagenInstantOf` moves forward by the length of the gap, so this is the
      // instant whose Copenhagen reading is 03:30 — 01:30Z.
      expect(at('2026-03-29T02:30')).toBe('2026-03-29T01:30:00.000Z')
    })

    it('uses the existing rule for a wall clock the autumn repeat gives twice', () => {
      // 02:30 happens twice on 25 October 2026: the clocks fall back 03:00 → 02:00.
      // `copenhagenInstantOf` takes the **first** occurrence, still on CEST — 00:30Z,
      // not the 01:30Z repeat.
      expect(at('2026-10-25T02:30')).toBe('2026-10-25T00:30:00.000Z')
    })

    /**
     * Phase 4E's Pages CMS wrote `2026-09-11T12:00:00Z` for a notice set to noon, from
     * a browser on CEST — which as an instant is 14:00 in Copenhagen. Validation
     * refuses that shape now (`tests/unit/content/validate/news-and-announcement.test.ts`);
     * this asserts the loader will not quietly resolve it either if it is handed one
     * directly, rather than truncating it to its first sixteen characters.
     */
    it.each(['2026-09-11T12:00:00Z', '2026-09-11T12:00+02:00', '2026-09-11T25:00'])(
      'refuses to resolve %j, by name',
      (expiresAt) => {
        expect(() =>
          announcementFrom({ active: true, message: 'Hej', expiresAt }, where),
        ).toThrow(/is not a Copenhagen wall clock/)
      },
    )
  })
})

describe('newsArticleFrom', () => {
  const file: NewsFile = {
    title: 'Ny burger i oktober',
    published: true,
    publishedAt: '2026-10-01',
    body: ['Menu til 124 kr.'],
  }

  it('reads a published file as the article at the address its file name gives', () => {
    const article = newsArticleFrom('ny-burger-i-oktober', file)
    expect(article).toMatchObject({
      id: 'ny-burger-i-oktober',
      slug: 'ny-burger-i-oktober',
      title: 'Ny burger i oktober',
      category: null,
      displayDate: '2026-10-01',
      updatedAt: '2026-10-01',
      image: null,
    })
    expect(article?.body.blocks[0]).toEqual({ type: 'paragraph', text: 'Menu til 124 kr.' })
  })

  it('keeps a stated updatedAt', () => {
    expect(newsArticleFrom('a', { ...file, updatedAt: '2026-10-03T08:00:00.000Z' })?.updatedAt).toBe(
      '2026-10-03T08:00:00.000Z',
    )
  })

  it('reads anything but "published": true as a draft that does not exist', () => {
    expect(newsArticleFrom('kladde', { ...file, published: false })).toBeNull()
    const unstated: NewsFile = { title: file.title, publishedAt: file.publishedAt, body: file.body }
    expect(newsArticleFrom('kladde', unstated)).toBeNull()
  })

  it('refuses a file name that is not a slug, and a published article without a title', () => {
    expect(() => newsArticleFrom('Ny Burger', file)).toThrow(/content\/site\/news\/Ny Burger\.json/)
    expect(() => newsArticleFrom('uden-titel', { ...file, title: '' })).toThrow(/has no title/)
  })

  /**
   * The article shape is proved on a fixture rather than on whatever happens to be in
   * `content/site/news/`, which is the restaurant's to fill. An article's photograph is
   * the same field every other surface uses — the same object, the same refusals — so a
   * news image needs nothing of its own.
   */
  it('takes the same optional photograph field as every other surface', () => {
    expect(newsArticleFrom('a', { ...file, photo: null })?.image).toBeNull()
    expect(newsArticleFrom('a', file)?.image).toBeNull()

    const illustrated = newsArticleFrom('a', {
      ...file,
      photo: { file: '/photos/dish-odin.png', alt: 'Odin på tallerkenen.', focus: 'upper' },
    })
    expect(illustrated?.image?.alt).toBe('Odin på tallerkenen.')
    expect(illustrated?.image?.focus).toBe('upper')
    expect(illustrated?.image?.src).toMatch(/^\/media\/dish-odin\/\d+\.webp$/)

    expect(() =>
      newsArticleFrom('a', { ...file, photo: { file: '../secret.png' } }),
    ).toThrow(/content\/site\/news\/a\.json/)
  })
})
