import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AnnouncementConflictSheet } from '@/components/admin/hours/AnnouncementConflictSheet'
import { GeneratedAnnouncementField } from '@/components/admin/hours/GeneratedAnnouncementField'
import { CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * 1t's announcement option and 1ae's conflict sheet, rendered — design 1t, 1ae, 1aa;
 * technical plan §7e item 8. **Phase 8C-3B.**
 *
 * The *decisions* live in `lib/announcements/generated.ts`, `generated-suggestion.ts` and
 * `generated-operation.ts`, and the transaction in
 * `supabase/migrations/20260831200000_override_removal_lifecycle.sql`; each is tested
 * where it lives. What is asserted here is the **markup**, and specifically the promises
 * only markup can keep:
 *
 *   * **no control carries an authoritative field.** No expiry, no link, no source, no
 *     owning override, no `previous` and no `replaced_at` reaches the server from any of
 *     them — which is what makes *"the browser may edit the message and nothing else"* a
 *     property of the form rather than of a check somebody remembered to write.
 *   * **the option is absent, not disabled, when there is nothing to suggest** (§4).
 *   * **1ae is a dialog with a name, two labelled ways out, and no third one.**
 *
 * Effects do not run under `renderToStaticMarkup`, which is exactly right for these
 * assertions: what is rendered here is the **server's** first paint, which is what a
 * person sees before any script has run and what they keep if none ever does.
 */

const FIELD_NAMES = {
  wanted: 'besked-til',
  message: 'besked-tekst',
  version: 'besked-version',
} as const

const OVERRIDE_FIELD_NAMES = {
  date: 'dato',
  kind: 'art',
  from: 'fra',
  to: 'til',
} as const

function renderField(
  overrides: Partial<Parameters<typeof GeneratedAnnouncementField>[0]> = {},
): string {
  return renderToStaticMarkup(
    <GeneratedAnnouncementField
      defaultWanted
      echoedMessage={null}
      fieldNames={FIELD_NAMES}
      idPrefix="enkelt-aendring"
      initial={{
        ok: true,
        message: 'Ændrede åbningstider søndag · 17:00–19:00',
        expiresAt: new Date('2026-09-06T20:00:00+02:00').toISOString(),
      }}
      overrideFieldNames={OVERRIDE_FIELD_NAMES}
      schedule={CONFIRMED_SCHEDULE}
      version="2026-09-01T10:00:00.000Z"
      {...overrides}
    />,
  )
}

describe('1t’s “Vis også som besked øverst på hjemmesiden”', () => {
  it('is drawn ticked, with the generator’s wording and its expiry in words', () => {
    const markup = renderField()

    expect(markup).toContain('Vis også som besked øverst på hjemmesiden')
    expect(markup).toContain('checked=""')
    expect(markup).toContain('Ændrede åbningstider søndag · 17:00–19:00')

    // 1t's expiry helper, from the instant the generator computed — printed, never posted.
    expect(markup).toContain('Udløber automatisk søndag 06.09.2026 kl. 20:00')

    // And the frame's own promise about the suggestion.
    expect(markup).toContain('Retter du tiderne, opdateres forslaget')
  })

  it('submits three fields, and they are the three the server will accept', () => {
    const names = [...renderField().matchAll(/name="([^"]+)"/g)].map((match) => match[1]).sort()

    expect(names).toEqual(['besked-tekst', 'besked-til', 'besked-version'])
  })

  it.each([
    ['an expiry', 'expires_at'],
    ['a page link', 'link_page'],
    ['an external link', 'link_url'],
    ['a link label', 'link_label'],
    ['an owning override', 'source_override_id'],
    ['a displaced snapshot', 'previous'],
    ['a replacement stamp', 'replaced_at'],
    ['the generated source', 'opening_hours'],
  ])('carries no %s for a forged submission to move', (_what, needle) => {
    expect(renderField()).not.toContain(needle)
  })

  it('submits nothing at all once the box is cleared', () => {
    // Not a disabled input — no input. An unchecked checkbox is not submitted either way,
    // and removing the message and the version token with it means `readAnnouncementRequest`
    // sees a request for nothing rather than a request with a blank tick beside it.
    const markup = renderField({ defaultWanted: false })

    expect(markup).toContain('besked-til')
    expect(markup).not.toContain('besked-tekst')
    expect(markup).not.toContain('besked-version')
    expect(markup).not.toContain('checked=""')
  })

  it('keeps a wording somebody already approved when a refusal sent them back', () => {
    const markup = renderField({ echoedMessage: 'Vi lukker tidligt i dag' })

    expect(markup).toContain('Vi lukker tidligt i dag')
    // And it does not quietly retype the generator's default over it.
    expect(markup).not.toContain('Ændrede åbningstider søndag · 17:00–19:00')
  })

  it.each([
    ['no_effect', 'ingen ændret åbningstid'],
    ['expired', 'Tidspunktet er passeret'],
    ['too_long', 'for lang'],
  ] as const)('renders an explanation and no checkbox for %s', (reason, sentence) => {
    const markup = renderField({ initial: { ok: false, reason } })

    // §4: absent rather than present and inert.
    expect(markup).not.toContain('besked-til')
    expect(markup).not.toContain('Vis også som besked')
    expect(markup).toContain(sentence)

    // And every one of them says the hours are unaffected, because they are.
    expect(markup).toContain('Åbningstiderne kan gemmes som normalt')
  })

  it('says nothing at all while the card is still being filled in', () => {
    // Somebody halfway through choosing a date has not made a mistake.
    const markup = renderField({ initial: { ok: false, reason: 'incomplete' } })

    expect(markup).not.toContain('besked-til')
    expect(markup).not.toContain('Åbningstiderne kan gemmes som normalt')
  })

  it('associates its helper and its counter with the field they describe', () => {
    const markup = renderField()

    // 1aa: an error or a helper that is not associated is one a screen reader never reads.
    expect(markup).toMatch(
      /aria-describedby="enkelt-aendring-besked-hjaelp enkelt-aendring-besked-antal"/,
    )
    expect(markup).toContain('id="enkelt-aendring-besked-hjaelp"')
    expect(markup).toContain('id="enkelt-aendring-besked-antal"')
  })

  it('marks an over-long wording invalid without blocking the hours', () => {
    const markup = renderField({ echoedMessage: 'x'.repeat(120) })

    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain('højst være 90')
    // No `required`, no `maxlength`: §7e item 8 makes the hours authoritative, so a message
    // this card would not accept must still let "Gem og offentliggør" publish the times.
    expect(markup).not.toContain('required=""')
    expect(markup).not.toContain('maxlength=')
  })
})

// ---------------------------------------------------------------------------
// 1ae
// ---------------------------------------------------------------------------

const CONFLICT_FIELDS = {
  override: 'aendring',
  overrideVersion: 'aendring-version',
  version: 'besked-version',
  message: 'besked-tekst',
  confirm: 'erstat',
} as const

function renderSheet(): string {
  return renderToStaticMarkup(
    <AnnouncementConflictSheet
      action={async () => {}}
      current={{
        message: 'Ny burger på menuen denne weekend',
        expiresAt: new Date('2026-09-15T20:00:00+02:00').toISOString(),
      }}
      fieldNames={CONFLICT_FIELDS}
      idPrefix="enkelt-aendring"
      keepHref="/admin/aabningstider?besked=beholdt"
      message="Ændrede åbningstider søndag · 17:00–19:00"
      overrideId="7f1c1d3e-0000-4000-8000-000000000001"
      overrideVersion="2026-09-01T10:00:00.000Z"
      proposed={{
        message: 'Ændrede åbningstider søndag · 17:00–19:00',
        expiresAt: new Date('2026-09-06T20:00:00+02:00').toISOString(),
      }}
      returnFocusTo="enkelt-aendring-offentliggoer"
      version="2026-09-01T11:00:00.000Z"
    />,
  )
}

describe('1ae’s conflict sheet', () => {
  it('is a dialog, open, and named by its own question', () => {
    const markup = renderSheet()

    expect(markup).toContain('<dialog')
    // Server-rendered `open`, so the question is on the page before any script runs.
    expect(markup).toContain('open=""')
    expect(markup).toContain('aria-labelledby="enkelt-aendring-konflikt-titel"')
    expect(markup).toContain('Der vises allerede en besked på hjemmesiden.')
  })

  it('draws both messages and both expiries, in the frame’s own words', () => {
    const markup = renderSheet()

    expect(markup).toContain('Vises nu')
    expect(markup).toContain('Erstattes af')
    expect(markup).toContain('Ny besked')

    expect(markup).toContain('Ny burger på menuen denne weekend')
    expect(markup).toContain('Udløber 15.09.2026 kl. 20:00')

    expect(markup).toContain('Ændrede åbningstider søndag · 17:00–19:00')
    expect(markup).toContain('Udløber 06.09.2026 kl. 20:00')
  })

  it('marks only the current message active, because only it is', () => {
    const markup = renderSheet()

    expect(markup.match(/Aktiv/g)).toHaveLength(1)
  })

  it('offers exactly two ways out, both labelled', () => {
    const markup = renderSheet()

    expect(markup).toContain('Behold eksisterende besked')
    expect(markup).toContain('Erstat med den nye besked')

    // Focus starts on the choice that changes nothing a guest can read.
    expect(markup).toMatch(/data-autofocus[^>]*>\s*Behold eksisterende besked/)
  })

  it('“Behold eksisterende besked” is a link, so it can write nothing', () => {
    const markup = renderSheet()

    // §12: the branch that keeps the existing message is not a Server Action at all. A
    // link cannot become one by accident.
    expect(markup).toMatch(/<a[^>]+href="\/admin\/aabningstider\?besked=beholdt"/)
  })

  it('submits a row id, two version tokens, the wording and one bit — and nothing else', () => {
    const markup = renderSheet()

    const names = [...markup.matchAll(/<input[^>]*name="([^"]+)"/g)]
      .map((match) => match[1])
      .sort()

    expect(names).toEqual([
      'aendring',
      'aendring-version',
      'besked-tekst',
      'besked-version',
      'erstat',
    ])
  })

  it.each([
    ['an expiry', 'expires_at'],
    ['a page link', 'link_page'],
    ['a source', 'opening_hours'],
    ['an owning override', 'source_override_id'],
    ['a displaced snapshot', 'previous'],
  ])('carries no %s the server does not re-derive', (_what, needle) => {
    expect(renderSheet()).not.toContain(needle)
  })
})
