import { parseExpiryInstant } from '@/lib/announcements/expiry'

import { array, date, flag, isBlank, isSlug, object, photo, text } from './fields'
import { add, at, shown, type Problem } from './problems'

/**
 * What a usable news article is — one file in `content/site/news/`.
 *
 * There are none yet, and that is a valid state: an empty directory is an empty list,
 * an empty list page and no sitemap entries. Everything below is about the first
 * article somebody writes.
 *
 * **The file name is the address.** `<slug>.json` is served at `/nyheder/<slug>/` and
 * is also the article's id, so it is held to the site's one slug shape — the same the
 * database used to enforce and the same `lib/news/slug.ts` produces from a title.
 *
 * **A draft is checked, but not required to be finished.** `published: true` is what
 * makes an article exist; anything else is a draft that renders nothing. A draft still
 * has to hold the right *kinds* of value — a date that is a date, a photograph that
 * exists — because a draft is a thing somebody is going to publish, and finding the
 * mistake then means finding it in a hurry.
 *
 * **The body is a list of paragraphs, and every one of them is text.** An article is
 * written as `["Første afsnit.", "Andet afsnit."]` — one string per paragraph — and the
 * loader turns that into the blocks the renderer draws. There is no markup in either
 * direction, so there is nothing to sanitise and no field that reaches the page as
 * anything but words. That is also why this file no longer holds a link rule: an
 * article has no link field for one to be about.
 */
export function validateNewsArticle(slug: string, file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  if (!isSlug(slug)) {
    add(
      problems,
      where,
      'Filnavnet er artiklens adresse på sitet, så det skal være små bogstaver (a-z), tal og ' +
        'enkelte bindestreger — f.eks. "ny-burger-i-oktober.json". Ingen mellemrum, æ, ø, å ' +
        `eller store bogstaver. Fik: ${shown(`${slug}.json`)}.`,
    )
  }

  const document = object(problems, where, file)
  if (document === null) return problems

  const published = flag(problems, at(where, 'published'), document.published) === true

  text(problems, at(where, 'title'), document.title, { required: published })
  text(problems, at(where, 'category'), document.category)
  photo(problems, at(where, 'photo'), document.photo)

  const publishedAt = date(problems, at(where, 'publishedAt'), document.publishedAt, {
    required: published,
  })

  validateUpdatedAt(problems, at(where, 'updatedAt'), document.updatedAt, publishedAt)
  validateBody(problems, at(where, 'body'), document.body, published)

  return problems
}

/**
 * `updatedAt` is optional and defaults to `publishedAt`. When it is stated it may be a
 * plain date or a full instant, because three public surfaces print it — the article's
 * `dateModified`, its `og` modified time and the sitemap's `lastModified`.
 *
 * The ordering is compared as **calendar dates** rather than as instants. An article
 * updated at 00:30 Copenhagen time on its own publication day is an instant *before*
 * UTC midnight that day, and comparing moments would call that a mistake. The question
 * being asked is "was it changed before it existed", which is a question about days.
 */
function validateUpdatedAt(
  problems: Problem[],
  where: string,
  value: unknown,
  publishedAt: string | null,
): void {
  if (isBlank(value)) return

  if (typeof value !== 'string' || parseExpiryInstant(value) === null) {
    add(
      problems,
      where,
      'Skal være en dato — f.eks. "2026-10-03" eller "2026-10-03T08:00:00+02:00". ' +
        `Fik: ${shown(value)}.`,
    )
    return
  }

  if (publishedAt !== null && value.slice(0, 10) < publishedAt) {
    add(
      problems,
      where,
      `Artiklen er rettet ${value.slice(0, 10)}, men udgivet ${publishedAt}. En artikel kan ` +
        'ikke være rettet før den blev udgivet.',
    )
  }
}

/**
 * The article's text — a list of paragraphs.
 *
 * A **published** article has to say something: an empty list is a page with a
 * headline and a blank column, which is not a state the design has. A **draft** may be
 * an empty body, a missing body or a body somebody has started, because a draft is
 * something being written. What holds either way is that a paragraph is a piece of
 * text with something in it: a blank line in the list is a gap the renderer would draw
 * as an empty paragraph, and it is easier to say so here than to notice it on a page.
 */
function validateBody(
  problems: Problem[],
  where: string,
  value: unknown,
  published: boolean,
): void {
  if (isBlank(value)) {
    if (published) {
      add(
        problems,
        where,
        'En udgivet artikel skal have en tekst. Brødteksten skrives som en liste af afsnit — ' +
          '[ "Første afsnit.", "Andet afsnit." ].',
      )
    }
    return
  }

  const paragraphs = array(problems, where, value, '[ "Første afsnit.", "Andet afsnit." ]')
  if (paragraphs === null) return

  if (published && paragraphs.length === 0) {
    add(problems, where, 'En udgivet artikel skal have mindst ét afsnit.')
    return
  }

  paragraphs.forEach((paragraph, index) => {
    text(problems, at(where, `afsnit ${index + 1}`), paragraph, { required: true })
  })
}
