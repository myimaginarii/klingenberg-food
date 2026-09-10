import { httpsUrl, isBlank, object, text } from './fields'
import { add, at, shown, type Problem } from './problems'

/**
 * What a usable set of contact facts is — `contact.json`.
 *
 * Every phone link, the map, the directions button, the footer's address line and the
 * `Restaurant` JSON-LD are built from this one file, so a field that is quietly wrong
 * is wrong in six places at once. The address itself will be read-only in Pages CMS —
 * it is a fact about a building, not something to edit — but it is checked here anyway,
 * because "read-only in the editor" is a convenience and this is the guardrail.
 *
 * WHAT IS DELIBERATELY NOT DONE. There is no RFC 5322 e-mail parser here and there
 * will not be one: the address is typed by one person, read by a human being, and
 * placed in a `mailto:` link. What is worth catching is a missing `@`, a stray space
 * and a domain with no dot — a typo, in other words — and that is all this looks for.
 */

/** A typo filter, not a specification: something, an @, something, a dot, something. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** A Danish postal code. Four digits, and the site's own is 5792. */
const POSTAL_CODE = /^\d{4}$/

/**
 * A Danish phone number, however it is spaced: eight digits, optionally with the
 * country code in front. Both of the restaurant's numbers are written "+45 63 90 83 00".
 *
 * Stated as a rule about Denmark on purpose. If the restaurant ever needs to print a
 * foreign number this refusal is where to widen it — which is a better place to
 * discover the decision than a `tel:` link that dials nothing. Eight digits is also
 * what makes `telHref` safe: it is asked for the digits, and this guarantees they exist.
 */
const DANISH_PHONE = /^(?:\+45)?\d{8}$/

/** The hosts a Facebook link may be on. Nothing else is the restaurant's page. */
const FACEBOOK_HOSTS = ['facebook.com', 'www.facebook.com']

export function validateContact(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  for (const field of ['venueName', 'addressLine1', 'city'] as const) {
    text(problems, at(where, field), document[field], { required: true })
  }

  matches(problems, at(where, 'postalCode'), document.postalCode, POSTAL_CODE, {
    required: true,
    hint: 'Skal være fire cifre i anførselstegn — f.eks. "5792".',
  })

  matches(problems, at(where, 'email'), document.email, EMAIL, {
    required: true,
    hint:
      'Skal se ud som en adresse — navn, et snabel-a og et domæne, f.eks. ' +
      '"kontakt@eksempel.test". Ingen mellemrum.',
  })

  for (const field of ['primaryPhone', 'secondaryPhone'] as const) {
    matches(problems, at(where, field), document[field], DANISH_PHONE, {
      required: field === 'primaryPhone',
      hint:
        'Skal være et dansk telefonnummer på otte cifre — f.eks. "+45 63 90 83 00" eller ' +
        '"63 90 83 00".',
      // A number is dialled, not read: the spaces and hyphens a person writes it with
      // are not part of it, and `telHref` strips them the same way.
      strip: /[\s-]/g,
    })
  }

  validateFacebook(problems, at(where, 'facebookUrl'), document.facebookUrl)

  return problems
}

/**
 * A short, written fact held to a shape — a postal code, an e-mail address, a phone
 * number. Three fields, one function: each is text first, then a pattern, then the one
 * sentence that says what the pattern wanted.
 */
function matches(
  problems: Problem[],
  where: string,
  value: unknown,
  pattern: RegExp,
  options: { required: boolean; hint: string; strip?: RegExp },
): void {
  if (isBlank(value) && !options.required) return

  const written = text(problems, where, value, { required: options.required })
  if (written === null) return

  const bare = options.strip === undefined ? written.trim() : written.replace(options.strip, '')
  if (!pattern.test(bare)) add(problems, where, `${options.hint} Fik: ${shown(value)}.`)
}

/**
 * The Facebook page.
 *
 * `https:` is the site's own external-link rule (`isAllowedExternalUrl`), and the host
 * check is this field's: the footer and the JSON-LD present this link as the
 * restaurant's Facebook page, so an address somewhere else would be presenting
 * somebody else's site under that name.
 */
function validateFacebook(problems: Problem[], where: string, value: unknown): void {
  if (isBlank(value)) return

  const before = problems.length
  httpsUrl(problems, where, value)
  if (problems.length !== before) return

  const host = new URL(value as string).hostname
  if (!FACEBOOK_HOSTS.includes(host)) {
    add(
      problems,
      where,
      `Skal pege på ${FACEBOOK_HOSTS.join(' eller ')} — f.eks. ` +
        `"https://www.facebook.com/carlnielsencafeen". Fik en adresse på "${host}".`,
    )
  }
}
