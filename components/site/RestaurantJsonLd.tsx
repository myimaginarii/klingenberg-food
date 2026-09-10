import { socialImage } from '@/content/site/images'
import { loadContact } from '@/lib/content/load/contact'
import { loadOpeningHours } from '@/lib/content/load/hours'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import { restaurantJsonLd } from '@/lib/seo/restaurant'

/**
 * The site's `Restaurant` structured-data block — technical plan §11.
 *
 * Rendered on the two pages that are *about the restaurant itself*: the Forside, which
 * is the business's canonical page, and Find os, which is where a local search for the
 * address or the opening hours lands. Both carry the same `@id`, so they describe one
 * business rather than two.
 *
 * It is one component rather than two call sites for a reason: the block is a machine's
 * copy of what the pages print, and two copies of a copy drift. Everything in it comes
 * from the tracked content — `content/site/contact.json` for the address, the telephone
 * number, the e-mail address and the Facebook page, `content/site/hours.json` for the
 * weekly schedule and any published one-off change — through the pure builder in
 * `lib/seo/restaurant.ts`, which is where the "nothing invented" list is written down.
 *
 * The serializer escapes what HTML would care about, so the JSON is an ordinary React
 * text child and no `dangerouslySetInnerHTML` is involved (§8 forbids it).
 */

/**
 * The confirmed competition result as one line, for `award`.
 *
 * The award band on the Forside and on Om os prints the same two facts in the approved
 * copy's own words (`content/site/award.json`: "Fyns bedste burger 2026 og nr. 4 i
 * Danmark", above the sentence that names the competition), and this is that, joined —
 * regional win first, national placing second, so neither can be read as having won
 * Denmark. The band's third sentence — the name the restaurant was listed under in the
 * competition — is deliberately left out: in an `award` field it would read as a second
 * trading name, which the copy pass of 2026-09-08 settled it is not. It is the machine
 * summary of that result rather than a copy of it, which is why it is stated here with
 * the structured data rather than in the content.
 */
const AWARD = 'Danmarks Bedste Burger 2026: vinder af Fyn & Øer og nr. 4 i Danmark'

export function RestaurantJsonLd() {
  const hours = loadOpeningHours()
  const json = serializeJsonLd(
    restaurantJsonLd({
      contact: loadContact(),
      schedule: hours.schedule,
      overrides: hours.overrides,
      // The same photograph the share card names, so a machine reading the page and a
      // messaging app rendering its link are looking at one asset.
      image: socialImage('home-hero'),
      award: AWARD,
    }),
  )

  return <script type="application/ld+json">{json}</script>
}
