import { parseExpiryInstant } from '@/lib/announcements/expiry'
import { ANNOUNCEMENT_LINK_PAGES, isConsistentAnnouncementLink } from '@/lib/announcements/link'

import { flag, httpsUrl, isBlank, object, oneOf, text } from './fields'
import { add, at, shown, type Problem } from './problems'

/**
 * What a usable announcement is — `announcement.json`.
 *
 * THE TIME RULE, STATED FIRST BECAUSE IT IS THE EASY ONE TO GET WRONG.
 *
 * An expiry is checked for being *a readable instant*, never for being *in the
 * future*. A notice that was correct when it was written must not start failing the
 * build tomorrow simply because the clock moved: a build is run on a schedule and on
 * every push, and content that decays into a build failure is content that breaks a
 * deployment nobody touched. Whether an announcement is still shown is already
 * decided, at render time and again in the browser, by `isAnnouncementExpired` — an
 * expired notice is *hidden*, which is the correct outcome and not an error. Keeping
 * an editor from choosing a date that has already passed is a job for the Pages CMS
 * form, at the moment of writing, where it can be a helpful hint instead of a build
 * failure.
 *
 * THE REST. An inactive file is valid whatever else it holds — that is the state the
 * site has been in since launch, and the message fields sit unread on disk. An active
 * one needs the two things the bar is made of, a message and an expiry, and its link
 * has to be one the resolver will actually render: `resolveAnnouncementLink` answers
 * `null` for a link it cannot trust, which is the right thing at render time (plain
 * text rather than a bad anchor) and exactly the wrong thing to discover later. So the
 * link is held here to the same rules the resolver applies — the site's own six
 * routes, an `https:` address, and the two of them not both filled in.
 */

const LINK_TYPES = ['none', 'page', 'url'] as const

const LINK_TYPE_NOTE =
  '"none" er intet link, "page" er en side her på sitet, "url" er en adresse et andet sted.'

export function validateAnnouncement(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  const active = flag(problems, at(where, 'active'), document.active, { required: true }) === true

  text(problems, at(where, 'message'), document.message, { required: active })
  validateExpiry(problems, at(where, 'expiresAt'), document.expiresAt, active)
  validateLink(problems, at(where, 'link'), document.link)

  return problems
}

function validateExpiry(
  problems: Problem[],
  where: string,
  value: unknown,
  active: boolean,
): void {
  if (isBlank(value)) {
    if (active) {
      add(
        problems,
        where,
        'En aktiv besked skal have et udløbstidspunkt — f.eks. "2026-12-25T00:00:00+01:00". ' +
          'En besked der aldrig udløber, bliver stående for evigt.',
      )
    }
    return
  }

  // The same parser the bar and the client guard use. It is asked whether the value is
  // readable — never whether it has passed; see the note at the top of this file.
  if (parseExpiryInstant(value as string) === null) {
    add(
      problems,
      where,
      'Skal være en dato med klokkeslæt — f.eks. "2026-12-25T00:00:00+01:00". ' +
        `Fik: ${shown(value)}.`,
    )
  }
}

function validateLink(problems: Problem[], where: string, value: unknown): void {
  if (isBlank(value)) return

  const link = object(
    problems,
    where,
    value,
    '{ "type": "none" }, { "type": "page", "page": "/menu" } eller { "type": "url", "url": ' +
      '"https://www.facebook.com/carlnielsencafeen", "label": "Læs mere" }',
  )
  if (link === null) return

  const type = oneOf(problems, at(where, 'type'), link.type, LINK_TYPES, LINK_TYPE_NOTE)
  if (type === null) return

  const page = isBlank(link.page) ? null : (link.page as string)
  const url = isBlank(link.url) ? null : (link.url as string)

  // The rule *between* the three fields is the resolver's own, so it is asked rather
  // than restated: a half-filled link is what makes the bar silently drop its anchor.
  const consistent = isConsistentAnnouncementLink({
    link_type: type,
    link_page: page,
    link_url: url,
    link_label: null,
  })

  if (!consistent) {
    const wanted = {
      none: 'hverken "page" eller "url"',
      page: '"page" og ikke "url"',
      url: '"url" og ikke "page"',
    }[type]
    add(problems, where, `Linket passer ikke sammen. "type": "${type}" udfyldes med ${wanted}.`)
    return
  }

  if (type === 'page') {
    oneOf(
      problems,
      at(where, 'page'),
      page,
      ANNOUNCEMENT_LINK_PAGES,
      'Det skal være en af sitets egne sider.',
    )
  }

  if (type === 'url') {
    httpsUrl(problems, at(where, 'url'), url)
  }

  // An internal page falls back to the route's own Danish name; an outside address has
  // no such name, so the resolver renders no link at all without a label.
  text(problems, at(where, 'label'), link.label, { required: type === 'url' })
}
