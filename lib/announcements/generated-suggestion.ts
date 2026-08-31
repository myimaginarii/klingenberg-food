import { toOverrideDraft, type OverrideFormValues } from '@/lib/hours/override-form'
import type { WeeklySchedule } from '@/lib/hours/types'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

import {
  generateOpeningHoursAnnouncement,
  type GeneratedAnnouncementRefusal,
} from './generated'

/**
 * What 1t's card currently suggests, asked of the card's own four fields — design 1t;
 * technical plan §7e item 8. **Phase 8C-3B.**
 *
 * ONE FUNCTION, TWO RUNTIMES, AND THAT IS THE WHOLE REASON IT EXISTS
 *
 * 1t makes a promise about the suggested message: *"Skrevet ud fra dato og tider ovenfor.
 * Retter du tiderne, opdateres forslaget — indtil du selv har rettet i teksten."* Keeping
 * it means answering *"what would this card say?"* twice — once on the server, for the
 * HTML the screen is first drawn with, and again in the browser, every time somebody
 * changes the date, the kind or either time.
 *
 * Two answers to one question is two chances to disagree, so there is one implementation
 * and it is this one. It is **pure** — no query, no clock of its own, no React, no
 * `server-only` — which is what lets the same module run in both places. `GeneratedAnnouncementField`
 * imports it; so does the screen that renders that field.
 *
 * IT DECIDES NOTHING THE SERVER WILL NOT DECIDE AGAIN
 *
 * Everything here is a **suggestion**. When "Gem og offentliggør" is pressed, the Server
 * Action re-reads the published override and the published recurring week and asks
 * `generateOpeningHoursAnnouncement()` again for the message, the link, the expiry and the
 * source (`lib/announcements/generated-operation.ts`). So a browser that computed something
 * else — an old build, a tampered script, a clock an hour out — changes what a person is
 * *shown* and nothing about what is *stored*. This module is allowed to be wrong; it is not
 * allowed to be authoritative, and it is not.
 */

/**
 * Why there is nothing to suggest, or the suggestion itself.
 *
 * `incomplete` is the one refusal that is not the generator's: the card does not yet
 * describe a change this system could store at all — no date, no times against "Andre
 * tider", a date that has been. It is kept distinct from `no_effect` because they mean
 * opposite things to a person. *"You have not finished filling this in"* is not *"this
 * changes nothing worth telling guests about"*, and the screen says neither out loud
 * while somebody is still typing.
 *
 * The other three are `GeneratedAnnouncementRefusal`'s own, passed through unrenamed.
 */
export type OverrideSuggestion =
  | {
      readonly ok: true
      /** 1t's own suggested wording, from the generator. */
      readonly message: string
      /** The authoritative expiry, as an ISO instant. Shown, never submitted. */
      readonly expiresAt: string
    }
  | { readonly ok: false; readonly reason: GeneratedAnnouncementRefusal | 'incomplete' }

/**
 * The suggestion for one set of card values.
 *
 * `toOverrideDraft` is asked first, and it is the *same* function the save uses — so
 * "does this card describe a storable change" has one answer on this screen rather than a
 * strict one in the Server Action and a lenient one in the browser. Only what it accepts
 * reaches the generator.
 *
 * `now` is a parameter for the reason it is one in the generator: the caller's clock,
 * never this module's. The server passes its own; the browser passes the browser's, which
 * is why a wrong clock there can only mis-draw a suggestion and never mis-store one.
 */
export function suggestOverrideAnnouncement(
  values: OverrideFormValues,
  schedule: WeeklySchedule,
  now: Date,
): OverrideSuggestion {
  const parsed = toOverrideDraft(values, copenhagenDateOf(now))

  if (!parsed.ok) return { ok: false, reason: 'incomplete' }

  const generated = generateOpeningHoursAnnouncement({
    date: parsed.date,
    override: parsed.content,
    schedule,
    now,
  })

  if (!generated.ok) return { ok: false, reason: generated.reason }

  return {
    ok: true,
    message: generated.announcement.message,
    expiresAt: generated.announcement.expires_at,
  }
}
