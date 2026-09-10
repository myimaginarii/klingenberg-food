import { describe, expect, it } from 'vitest'

import { validateAnnouncement } from '@/lib/content/validate/announcement'
import { validateNewsArticle } from '@/lib/content/validate/news'
import type { Problem } from '@/lib/content/validate/problems'

/**
 * The two documents that carry a link a guest can follow, and the one rule about time
 * this phase deliberately does not make.
 */

const ANNOUNCEMENT = 'content/site/announcement.json'

const messages = (problems: readonly Problem[]) =>
  problems.map((problem) => `${problem.where}: ${problem.message}`).join('\n')

const article = (over: Record<string, unknown> = {}) => ({
  title: 'Ny burger i oktober',
  published: true,
  publishedAt: '2026-10-01',
  body: ['Menu til 124 kr.'],
  ...over,
})

const news = (slug: string, file: unknown = article()) =>
  validateNewsArticle(slug, file, `content/site/news/${slug}.json`)

describe('a news article', () => {
  it('accepts a published article and a draft that is not finished yet', () => {
    expect(news('ny-burger-i-oktober')).toEqual([])
    expect(news('kladde', { published: false })).toEqual([])
    expect(news('kladde', { published: false, title: 'Uden dato endnu' })).toEqual([])
  })

  it('accepts an optional photograph, and refuses an unsafe one through the phase-2 rules', () => {
    expect(news('a', article({ photo: { file: '/photos/dish-odin.png', alt: 'Odin.' } }))).toEqual([])
    expect(news('a', article({ photo: null }))).toEqual([])

    const problems = news('a', article({ photo: { file: '../secret.png' } }))
    expect(problems[0]?.where).toBe('content/site/news/a.json → photo.file')
    expect(problems[0]?.message).toMatch(/Skal være en fil i public\/photos\//)
  })

  /** The slug grammar is `isNewsSlug`'s, covered in `tests/unit/news/slug.test.ts`. */
  it.each(['Ny Burger', 'nyhed æøå'])(
    'refuses the file name %j: the file name is the article’s address',
    (slug) => {
      expect(messages(news(slug))).toMatch(/Filnavnet er artiklens adresse/)
    },
  )

  it('refuses a publication date that is not a real day', () => {
    const problems = news('a', article({ publishedAt: '2026-02-31' }))

    expect(problems[0]?.where).toBe('content/site/news/a.json → publishedAt')
    expect(problems[0]?.message).toMatch(/rigtig dato/)
  })

  it('refuses an article corrected before it was published', () => {
    const problems = news('a', article({ updatedAt: '2026-09-30' }))

    expect(messages(problems)).toMatch(/rettet 2026-09-30, men udgivet 2026-10-01/)
  })

  it('accepts a correction later the same day, in any timezone offset', () => {
    expect(news('a', article({ updatedAt: '2026-10-01T00:30:00+02:00' }))).toEqual([])
    expect(news('a', article({ updatedAt: '2026-10-03T08:00:00.000Z' }))).toEqual([])
  })

  it('refuses a published article with no text', () => {
    expect(messages(news('a', article({ body: undefined })))).toMatch(
      /En udgivet artikel skal have en tekst/,
    )
    expect(messages(news('a', article({ body: [] })))).toMatch(/mindst ét afsnit/)
  })

  /**
   * The body an editor writes: one string per paragraph, and nothing else to decide.
   * A draft may be unfinished; a paragraph that is there has to say something, because
   * a blank line in the list is an empty `<p>` on the page.
   */
  it('takes the body as a plain list of paragraphs', () => {
    expect(news('a', article({ body: ['Første afsnit.', 'Andet afsnit.'] }))).toEqual([])
    expect(news('kladde', { published: false, body: [] })).toEqual([])
  })

  it('refuses a paragraph that is not text, and one that is blank', () => {
    expect(messages(news('a', article({ body: ['Fint.', 7] })))).toMatch(
      /body → afsnit 2: Skal være tekst i anførselstegn/,
    )
    expect(messages(news('a', article({ body: ['Fint.', '   '] })))).toMatch(
      /body → afsnit 2: Skal udfyldes/,
    )
  })

  it('refuses a body that is not a list at all', () => {
    expect(
      messages(news('a', article({ body: { blocks: [{ type: 'paragraph', text: 'Hej' }] } }))),
    ).toMatch(/Skal være en liste/)
  })
})

describe('the announcement bar', () => {
  it('accepts the inactive file the site has been in since launch', () => {
    expect(
      validateAnnouncement(
        { active: false, message: null, expiresAt: null, link: { type: 'none', page: null, url: null, label: null } },
        ANNOUNCEMENT,
      ),
    ).toEqual([])
  })

  /**
   * The rule this phase is most careful about: an expiry is checked for being
   * readable, never for being in the future. Tomorrow's clean build of a repository
   * nobody touched must not start failing because a notice from last year has passed.
   */
  it('accepts an active notice whose expiry passed long ago — expired is hidden, not invalid', () => {
    expect(
      validateAnnouncement(
        { active: true, message: 'Lukket juleaften', expiresAt: '2020-12-25T00:00' },
        ANNOUNCEMENT,
      ),
    ).toEqual([])
  })

  it('refuses an active notice with nothing to say, or nothing to say it until', () => {
    expect(
      messages(validateAnnouncement({ active: true, expiresAt: '2026-12-25T00:00' }, ANNOUNCEMENT)),
    ).toMatch(/message: Skal udfyldes\./)
    expect(messages(validateAnnouncement({ active: true, message: 'Hej' }, ANNOUNCEMENT))).toMatch(
      /skal have et udløbstidspunkt/,
    )
  })

  /**
   * The offset-bearing forms are the ones phase 4F exists to refuse, and the first of
   * them is not hypothetical: `2026-09-11T12:00:00Z` is the literal value the Pages CMS
   * datetime control wrote into `announcement.json` on the `content` branch, from a
   * browser two hours ahead of UTC, for a notice the restaurant had set to noon. Read
   * back as an instant it means 14:00 in Copenhagen — the bar outlived its own expiry
   * by two hours. The fix is to refuse the shape rather than to interpret it.
   */
  it.each([
    'i morgen',
    '2026-13-45',
    '25/12 2026',
    '2026-09-11T12:00:00Z', // the real broken value from the content branch
    '2026-09-11T12:00Z',
    '2026-09-11T12:00+02:00',
    '2026-12-25T00:00:00+01:00', // the old written form, now refused
    '2026-09-11T12:00:00', // seconds, even without an offset
    '2026-02-31T12:00', // February has no 31st
    '2026-02-29T12:00', // 2026 is not a leap year
    '2026-09-11T25:00', // no such hour
    '2026-09-11T12:60', // no such minute
    '2026-09-11 12:00', // a space instead of the T
    '2026-9-11T12:00', // an unpadded month
  ])('refuses the expiry %j', (expiresAt) => {
    const problems = validateAnnouncement(
      { active: true, message: 'Hej', expiresAt },
      ANNOUNCEMENT,
    )

    expect(problems[0]?.where).toBe('content/site/announcement.json → expiresAt')
    expect(problems[0]?.message).toMatch(/dato med klokkeslæt/)
  })

  it.each(['2026-09-11T12:00', '2026-12-11T12:00', '2028-02-29T00:00', '2026-01-01T23:59'])(
    'accepts the wall clock %j',
    (expiresAt) => {
      // 2028 is a leap year, so its 29th of February is a real day — and 2026-02-29 is
      // refused above. The pattern and the calendar together decide that; there is no
      // hand-written month table here.
      expect(
        validateAnnouncement({ active: true, message: 'Hej', expiresAt }, ANNOUNCEMENT),
      ).toEqual([])
    },
  )

  it('accepts a link to one of the site’s own routes, and refuses one to anywhere else', () => {
    const valid = validateAnnouncement(
      {
        active: true,
        message: 'Nye åbningstider',
        expiresAt: '2026-10-01T00:00',
        link: { type: 'page', page: '/find-os' },
      },
      ANNOUNCEMENT,
    )
    expect(valid).toEqual([])

    const problems = validateAnnouncement(
      {
        active: true,
        message: 'Nye åbningstider',
        expiresAt: '2026-10-01T00:00',
        link: { type: 'page', page: '/admin' },
      },
      ANNOUNCEMENT,
    )
    expect(problems[0]?.where).toBe('content/site/announcement.json → link → page')
    expect(problems[0]?.message).toMatch(/en af sitets egne sider/)
  })

  it.each(['http://example.test/', 'javascript:alert(1)', '//example.test/x'])(
    'refuses the outside address %j',
    (url) => {
      const problems = validateAnnouncement(
        {
          active: true,
          message: 'Læs mere',
          expiresAt: '2026-10-01T00:00',
          link: { type: 'url', url, label: 'Læs mere' },
        },
        ANNOUNCEMENT,
      )

      expect(problems[0]?.where).toBe('content/site/announcement.json → link → url')
      expect(problems[0]?.message).toMatch(/fuld https-adresse/)
    },
  )

  it('refuses an outside link with no words on it — the bar would render no link at all', () => {
    const problems = validateAnnouncement(
      {
        active: true,
        message: 'Læs mere',
        expiresAt: '2026-10-01T00:00',
        link: { type: 'url', url: 'https://www.facebook.com/carlnielsencafeen' },
      },
      ANNOUNCEMENT,
    )

    expect(messages(problems)).toMatch(/link → label: Skal udfyldes\./)
  })

  it('refuses a link whose three fields disagree', () => {
    expect(
      messages(
        validateAnnouncement(
          {
            active: true,
            message: 'Hej',
            expiresAt: '2026-10-01T00:00',
            link: { type: 'page', page: '/menu', url: 'https://www.facebook.com/carlnielsencafeen' },
          },
          ANNOUNCEMENT,
        ),
      ),
    ).toMatch(/Linket passer ikke sammen/)
  })
})
