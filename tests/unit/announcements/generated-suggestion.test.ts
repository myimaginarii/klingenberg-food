import { describe, expect, it } from 'vitest'

import {
  ANNOUNCEMENT_OUTCOME,
  describeAnnouncementOutcome,
  generatedAnnouncementHref,
} from '@/app/(admin)/admin/aabningstider/announcement-routes'
import type { ApplyGeneratedAnnouncementResult } from '@/lib/announcements/generated-operation'
import { formatExpiryStamp, formatExpiryWeekdayStamp } from '@/lib/announcements/expiry-editor'
import { suggestOverrideAnnouncement } from '@/lib/announcements/generated-suggestion'
import { describeOverrideRemoval } from '@/lib/hours/override-form'
import { CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * The pure halves of phase 8C-3B — design 1t, 1ae; technical plan §7e items 6 and 8.
 *
 * Three small modules, and each one exists because something had to be decided in exactly
 * one place:
 *
 *   * {@link suggestOverrideAnnouncement} — *what would this card say?*, answered
 *     identically on the server and in the browser, because 1t promises the suggestion
 *     follows the fields above it and a second implementation would eventually disagree
 *     with the first.
 *   * {@link describeOverrideRemoval} — *what does "Fjern" do?*, including §7e item 6's
 *     new answer, so the sentence a person reads and the transition that runs are decided
 *     together.
 *   * {@link describeAnnouncementOutcome} — *what happened to the message?*, worded out of
 *     the domain's own refusal sentences rather than a second copy of them.
 *
 * The generator itself is tested in `./generated.test.ts` and the coordinator in
 * `supabase/tests/017`. Nothing here re-asserts either.
 */

/*
 * A Sunday, in the confirmed week: 17:00–20:00. 1t's own example date shape, so the
 * expected strings below are the frame's own.
 */
const SUNDAY = '2026-09-06'
const MONDAY = '2026-09-07'
const NOW = new Date('2026-09-01T10:00:00+02:00')

describe('what 1t’s card currently suggests', () => {
  it('composes the frame’s own sentence from the frame’s own values', () => {
    const result = suggestOverrideAnnouncement(
      { date: SUNDAY, kind: 'custom', from: '17:00', to: '19:00' },
      CONFIRMED_SCHEDULE,
      NOW,
    )

    expect(result).toEqual({
      ok: true,
      message: 'Ændrede åbningstider søndag · 17:00–19:00',
      // 1t draws 20:00 — the **later** of the normal closing and the special one (§0m),
      // not the override's own 19:00.
      expiresAt: new Date('2026-09-06T20:00:00+02:00').toISOString(),
    })
  })

  it('says nothing at all while the card is still being filled in', () => {
    // Not `no_effect`: "you have not finished" and "this changes nothing" are opposite
    // things to say to somebody mid-sentence, and the screen renders neither for this one.
    expect(
      suggestOverrideAnnouncement(
        { date: SUNDAY, kind: 'custom', from: '', to: '' },
        CONFIRMED_SCHEDULE,
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'incomplete' })

    expect(
      suggestOverrideAnnouncement(
        { date: '', kind: 'closed', from: '', to: '' },
        CONFIRMED_SCHEDULE,
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'incomplete' })
  })

  it('refuses a change that changes nothing a guest could notice', () => {
    // Monday is closed in the confirmed week, so closing it announces nothing.
    expect(
      suggestOverrideAnnouncement(
        { date: MONDAY, kind: 'closed', from: '', to: '' },
        CONFIRMED_SCHEDULE,
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'no_effect' })

    // And neither does restating the hours the week already has.
    expect(
      suggestOverrideAnnouncement(
        { date: SUNDAY, kind: 'custom', from: '17:00', to: '20:00' },
        CONFIRMED_SCHEDULE,
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'no_effect' })
  })

  it('refuses an announcement that would already have expired', () => {
    // **Today**, after the hours it would describe have finished. This is the only shape
    // `expired` can reach the screen in, and it is worth stating why: a date that has
    // *been* is refused one step earlier, by `toOverrideDraft`'s own §7e item 7 rule, so
    // it arrives as `incomplete` rather than as an expired announcement. The generator
    // still states `expired` for its own callers, and the coordinator can still return it
    // — the server re-asks with its own clock at publish time, and a card filled in at
    // 19:58 can be submitted at 20:01.
    expect(
      suggestOverrideAnnouncement(
        { date: SUNDAY, kind: 'custom', from: '17:00', to: '19:00' },
        CONFIRMED_SCHEDULE,
        new Date('2026-09-06T21:00:00+02:00'),
      ),
    ).toEqual({ ok: false, reason: 'expired' })
  })

  it('and a date that has been is refused a step earlier, as unfinished', () => {
    expect(
      suggestOverrideAnnouncement(
        { date: SUNDAY, kind: 'custom', from: '17:00', to: '19:00' },
        CONFIRMED_SCHEDULE,
        new Date('2026-09-10T10:00:00+02:00'),
      ),
    ).toEqual({ ok: false, reason: 'incomplete' })
  })

  it('takes the caller’s clock, and never reads one of its own', () => {
    const request = { date: SUNDAY, kind: 'custom', from: '17:00', to: '19:00' } as const

    // The same question, twice, with the same clock: the same answer. This is what lets
    // the server render the first paint and the browser take over without a flicker.
    expect(suggestOverrideAnnouncement(request, CONFIRMED_SCHEDULE, NOW)).toEqual(
      suggestOverrideAnnouncement(request, CONFIRMED_SCHEDULE, NOW),
    )
  })

  it('closes a normally open day with the week’s own closing as the expiry', () => {
    const result = suggestOverrideAnnouncement(
      { date: SUNDAY, kind: 'closed', from: '', to: '' },
      CONFIRMED_SCHEDULE,
      NOW,
    )

    expect(result).toEqual({
      ok: true,
      message: 'Lukket søndag 06.09',
      // The bar stands through the hours guests would otherwise have turned up in.
      expiresAt: new Date('2026-09-06T20:00:00+02:00').toISOString(),
    })
  })
})

describe('the expiry, as 1t and 1ae print it', () => {
  const instant = new Date('2026-09-06T20:00:00+02:00').toISOString()

  it('1ae prints the stamp alone', () => {
    expect(formatExpiryStamp(instant)).toBe('06.09.2026 kl. 20:00')
  })

  it('1t names the day as well', () => {
    expect(formatExpiryWeekdayStamp(instant)).toBe('søndag 06.09.2026 kl. 20:00')
  })

  it('answers null rather than “Invalid Date” for a value it cannot read', () => {
    expect(formatExpiryStamp(null)).toBeNull()
    expect(formatExpiryStamp(undefined)).toBeNull()
    expect(formatExpiryStamp('ikke en dato')).toBeNull()
    expect(formatExpiryWeekdayStamp('ikke en dato')).toBeNull()
  })

  it('reads the Copenhagen wall clock, not the machine’s', () => {
    // The same instant, written with a different offset. Both are 20:00 in Copenhagen.
    expect(formatExpiryStamp('2026-09-06T18:00:00Z')).toBe('06.09.2026 kl. 20:00')
  })
})

describe('what “Fjern” does, including §7e item 6', () => {
  it('offers nothing for a date with no change', () => {
    expect(describeOverrideRemoval('ingen')).toBeNull()
    expect(describeOverrideRemoval('ingen', true)).toBeNull()
  })

  it.each(['kladde', 'live_med_kladde'] as const)(
    'never removes an announcement for a %s, even one this override owns',
    (lifecycle) => {
      // A draft is not on the hjemmeside and dropping it changes nothing a guest reads, so
      // the message that describes the *published* hours must stay exactly where it is.
      expect(describeOverrideRemoval(lifecycle, true)?.removesAnnouncement).toBe(false)
      expect(describeOverrideRemoval(lifecycle, true)?.confirms).toBe(false)
    },
  )

  it('asks before a live removal, and says only the hours are going', () => {
    const removal = describeOverrideRemoval('live', false)

    expect(removal?.label).toBe('Fjern ændringen fra hjemmesiden')
    expect(removal?.confirms).toBe(true)
    expect(removal?.removesAnnouncement).toBe(false)
  })

  it('names both when the override owns the live message', () => {
    const removal = describeOverrideRemoval('live', true)

    expect(removal?.label).toBe('Fjern ændring og besked')
    expect(removal?.confirms).toBe(true)
    expect(removal?.removesAnnouncement).toBe(true)

    // The confirmation says what will happen to the message, before it is pressed.
    expect(removal?.description).toContain('beskeden')
  })

  it('defaults to “owns nothing” when nobody asked the question', () => {
    // The parameter has a default so the 8B call sites read unchanged, and the default is
    // the safe one: a caller who did not look up ownership cannot accidentally confirm a
    // removal of something they never checked for.
    expect(describeOverrideRemoval('live')).toEqual(describeOverrideRemoval('live', false))
  })
})

describe('what the screen says about the message afterwards', () => {
  it('says nothing for a code it does not recognise', () => {
    expect(describeAnnouncementOutcome(undefined)).toBeNull()
    expect(describeAnnouncementOutcome('')).toBeNull()
    expect(describeAnnouncementOutcome('noget-nogen-har-tastet')).toBeNull()
    expect(describeAnnouncementOutcome('fortryd_noget-andet')).toBeNull()
  })

  it('reports 1ae’s “Behold eksisterende” in the frame’s own words', () => {
    expect(describeAnnouncementOutcome(ANNOUNCEMENT_OUTCOME.kept)).toEqual({
      tone: 'success',
      text: 'Åbningstiderne er gemt. Beskeden blev ikke oprettet.',
    })
  })

  it.each([
    [ANNOUNCEMENT_OUTCOME.created],
    [ANNOUNCEMENT_OUTCOME.replaced],
    [ANNOUNCEMENT_OUTCOME.restored],
  ])('reports %s as a success', (code) => {
    expect(describeAnnouncementOutcome(code)?.tone).toBe('success')
  })

  it('reports a restore whose message expired in the meantime as a warning', () => {
    const outcome = describeAnnouncementOutcome(ANNOUNCEMENT_OUTCOME.restoredExpired)

    expect(outcome?.tone).toBe('warning')
    // Nothing extended the expiry to make the undo look successful.
    expect(outcome?.text).toContain('udløbet')
  })

  it('borrows every refusal from the domain rather than restating it', () => {
    // The coordinator's own sentences, reached through the code the address carries.
    expect(describeAnnouncementOutcome('no_effect')).toEqual({
      tone: 'warning',
      text: 'Ændringen svarer til de normale åbningstider, så der er ikke noget at fortælle gæsterne.',
    })

    expect(describeAnnouncementOutcome('too_long')).toEqual({
      tone: 'warning',
      text: 'Beskeden må højst være 90 tegn.',
    })

    // And the restore's own, reached through the `fortryd_` prefix.
    expect(describeAnnouncementOutcome('fortryd_nothing_to_restore')).toEqual({
      tone: 'warning',
      text: 'Der er ingen tidligere besked at sætte tilbage.',
    })
  })

  it('says nothing for the two statuses that are not obstacles', () => {
    // `applied` is reported as one of this phase's own outcomes, and `conflict` is not an
    // obstacle at all — it is 1ae's question, and the sheet is the answer.
    expect(describeAnnouncementOutcome('applied')).toBeNull()
    expect(describeAnnouncementOutcome('conflict')).toBeNull()
  })

  it('every refusal is a warning, because the hours were published anyway', () => {
    for (const code of [
      'no_effect',
      'expired',
      'too_long',
      'not_published',
      'stale_override',
      'stale_announcement',
      'invalid_payload',
      'not_found',
      'forbidden',
      'failed',
    ]) {
      expect(describeAnnouncementOutcome(code)?.tone, code).toBe('warning')
    }
  })
})


// ---------------------------------------------------------------------------
// The two concurrency refusals, mapped — the E2E substitution's other half
// ---------------------------------------------------------------------------

/**
 * `stale_announcement` and `stale_override`, from the coordinator's answer to the screen.
 *
 * §25 asks for these two as browser scenarios. They are asserted **here and in
 * `supabase/tests/017_generated_announcement.test.sql`** instead, and the split is
 * deliberate: 017 proves the *guarantee* — the status is returned, the whole row is
 * unchanged, no audit row is written, and ownership does not move by halves — from real
 * Staff JWTs, which is stronger than anything a rendered page can show. What is left is the
 * **mapping**: that each status reaches the person as the right sentence, in the right
 * tone, at an address that has not lost what happened to the opening hours.
 *
 * That mapping is pure, so it is tested deterministically rather than by racing two browser
 * contexts at one singleton — which is exactly what the removed E2E scenarios did, and why
 * they kept exercising the *applied* branch while asserting the stale one.
 */
describe('a refusal caused by somebody else’s change reaches the screen intact', () => {
  function refusal(status: 'stale_announcement' | 'stale_override'): ApplyGeneratedAnnouncementResult {
    return {
      status,
      conflict: null,
      current: null,
      announcement: null,
      ownership: null,
      previous: null,
      updatedAt: null,
      reason: null,
      // The property that matters most, restated as a fixture: a refusal carries no cache
      // tags, so nothing is expired for a write that did not happen.
      cacheTags: [],
    }
  }

  it.each([
    [
      'stale_announcement',
      'Nogen andre har rettet beskeden imens. Genindlæs siden, og prøv igen.',
    ],
    [
      'stale_override',
      'Nogen andre har rettet åbningstiden imens. Genindlæs siden, og prøv igen.',
    ],
  ] as const)('%s is worded by the domain, not by the screen', (status, sentence) => {
    expect(describeAnnouncementOutcome(status)).toEqual({ tone: 'warning', text: sentence })
  })

  it.each(['stale_announcement', 'stale_override'] as const)(
    '%s comes back beside the hours’ own outcome, not instead of it',
    (status) => {
      const href = generatedAnnouncementHref({
        date: '2026-09-06',
        hoursStatus: 'enkelt_offentliggjort',
        overrideId: '7f1c1d3e-0000-4000-8000-000000000001',
        message: 'Ændrede åbningstider søndag · 17:00–19:00',
        result: refusal(status),
      })

      const address = new URL(href, 'https://example.test')

      // §7e item 8: the hours were published before the message was attempted, and no
      // announcement outcome may quietly replace that fact.
      expect(address.searchParams.get('status')).toBe('enkelt_offentliggjort')
      expect(address.searchParams.get('besked')).toBe(status)

      // No sheet: a stale token is not a question to put to somebody, it is a refusal.
      expect(address.searchParams.get('konflikt')).toBeNull()

      // And no Fortryd, because nothing was written to undo.
      expect(address.searchParams.get('fortryd')).toBeNull()
    },
  )

  it('carries the wording back so it is not retyped after a refusal', () => {
    const message = 'Vi lukker tidligt på grund af en privat fest'

    const href = generatedAnnouncementHref({
      date: '2026-09-06',
      hoursStatus: 'enkelt_offentliggjort',
      overrideId: '7f1c1d3e-0000-4000-8000-000000000001',
      message,
      result: refusal('stale_announcement'),
    })

    expect(new URL(href, 'https://example.test').searchParams.get('forslag')).toBe(message)
  })

  it('offers no undo token for either, because neither wrote anything', () => {
    for (const status of ['stale_announcement', 'stale_override'] as const) {
      expect(refusal(status).cacheTags).toEqual([])
      expect(refusal(status).updatedAt).toBeNull()
    }
  })
})
