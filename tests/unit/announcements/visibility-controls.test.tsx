import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AnnouncementVisibilityUndo } from '@/components/admin/announcement/AnnouncementNotices'
import {
  AnnouncementVisibilityCard,
  RemoveAnnouncementNowButton,
  type AnnouncementVisibilityForm,
} from '@/components/admin/announcement/AnnouncementVisibility'
import { describeAnnouncementVisibilityChange } from '@/lib/announcements/visibility'

/**
 * 1ad's two immediate controls and their Fortryd, rendered — design 1ad, 1aa; §6.
 *
 * The *decision* lives in `lib/announcements/visibility.ts` and the transaction in
 * `supabase/migrations/20260830180000_announcement_visibility.sql`; both are tested where
 * they live. What is asserted here is the markup, and specifically the four promises this
 * screen makes that only markup can keep:
 *
 *   * **both controls submit the same operation** — the same two field names, the same
 *     action, the same requested state — so there is one business operation behind two
 *     drawings of it;
 *   * **no control carries content.** No message, no link, no expiry, no `source`,
 *     no `previous`, no `replaced_at`, no `draft` and no row id reaches the server from
 *     any of them, which is what makes "moving the switch cannot publish a draft" a
 *     property of the form rather than of a check — **in both directions** (§0h);
 *   * **the on direction is offered exactly while it can succeed.** A published message
 *     that is switched off but still current gets the same switch, asking for `vis=1`; an
 *     expired one gets a statement rather than a press `set_announcement_visible()` would
 *     refuse with `not_showable`;
 *   * **Fortryd asks for visibility and nothing else**, with the version token the write
 *     returned.
 *
 * Rendered with `react-dom/server`, as `bar.test.tsx` is. No test renderer, no DOM
 * environment and no new dependency.
 */

const VERSION = '2026-08-30T16:00:00.000Z'

/** A stand-in for the Server Action. Nothing here submits; only the markup is read. */
const form: AnnouncementVisibilityForm = {
  action: async () => {},
  fieldNames: { version: 'version', visible: 'vis' },
}

function hiddenValue(markup: string, name: string): string | null {
  const match = markup.match(
    new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`),
  )

  return match?.[1] ?? null
}

/** Every field name the markup would post. */
function fieldNames(markup: string): string[] {
  return [...markup.matchAll(/<(?:input|select|textarea)[^>]*name="([^"]+)"/g)]
    .map((match) => match[1] ?? '')
    .sort()
}

const CONTENT_FIELDS = [
  'besked',
  'message',
  'link',
  'adresse',
  'linktekst',
  'udloeb',
  'udloeb_dato',
  'udloeb_tid',
  'expires_at',
  'source',
  'previous',
  'replaced_at',
  'draft',
  'entity',
  'id',
]

describe('the "Vis besked" card while the message is showing', () => {
  const markup = renderToStaticMarkup(
    <AnnouncementVisibilityCard form={form} restorable version={VERSION} visible />,
  )

  it('draws 1ad’s control and its own words', () => {
    expect(markup).toContain('Vis besked')
    expect(markup).toContain('Slå fra, og den forsvinder straks')
    expect(markup).toContain('Slå fra, og bjælken forsvinder med det samme.')
  })

  it('asks for the off direction — pressing it hides the bar', () => {
    expect(hiddenValue(markup, 'vis')).toBe('0')
  })

  it('carries the version token the screen was rendered from (§6)', () => {
    expect(hiddenValue(markup, 'version')).toBe(VERSION)
  })

  it('posts exactly two fields, and neither is content', () => {
    expect(fieldNames(markup)).toEqual(['version', 'vis'])

    for (const field of CONTENT_FIELDS) {
      expect(fieldNames(markup), `no field is called ${field}`).not.toContain(field)
    }
  })

  it('says the state in words as well as in the switch (1aa)', () => {
    expect(markup).toContain('Beskeden vises på hjemmesiden. Slå fra, så den fjernes straks.')
  })
})

describe('the same card while the message is switched off but still showable', () => {
  const markup = renderToStaticMarkup(
    <AnnouncementVisibilityCard form={form} restorable version={VERSION} visible={false} />,
  )

  it('is the same one control, in its off position (§0h)', () => {
    expect(markup).toContain('aria-label="Vis besked"')
    expect(markup).toContain('<form')
  })

  it('asks for the on direction — pressing it shows the published message again', () => {
    expect(hiddenValue(markup, 'vis')).toBe('1')
    expect(hiddenValue(markup, 'version')).toBe(VERSION)
  })

  it('still posts exactly two fields, and neither is content', () => {
    expect(fieldNames(markup)).toEqual(['version', 'vis'])

    for (const field of CONTENT_FIELDS) {
      expect(fieldNames(markup), `no field is called ${field}`).not.toContain(field)
    }
  })

  it('says the state in words, and that it publishes nothing', () => {
    expect(markup).toContain('Slå til, og den vises igen straks')
    expect(markup).toContain('Det offentliggør')
    expect(markup).toContain(
      'Beskeden vises ikke på hjemmesiden. Slå til, så den samme besked vises igen straks.',
    )
  })
})

describe('the same place once the published message has expired', () => {
  const markup = renderToStaticMarkup(
    <AnnouncementVisibilityCard
      form={form}
      restorable={false}
      version={VERSION}
      visible={false}
    />,
  )

  it('offers no press at all — the database would refuse it (not_showable)', () => {
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('<form')
    expect(markup).not.toContain('name="vis"')
  })

  it('names the expiry as the reason, and Offentliggør as the way past it', () => {
    expect(markup).toContain('Vis besked — slået fra')
    expect(markup).toContain('Beskeden er udløbet')
    expect(markup).toContain('Offentliggør')
  })
})

describe('"Fjern beskeden nu" — the second entrance to the same operation', () => {
  const markup = renderToStaticMarkup(
    <RemoveAnnouncementNowButton form={form} version={VERSION} />,
  )

  it('carries 1ad’s own label', () => {
    expect(markup).toContain('Fjern beskeden nu')
  })

  it('submits exactly what the switch submits', () => {
    expect(fieldNames(markup)).toEqual(['version', 'vis'])
    expect(hiddenValue(markup, 'vis')).toBe('0')
    expect(hiddenValue(markup, 'version')).toBe(VERSION)
  })

  it('says it works at once, bound to the button rather than beside it', () => {
    expect(markup).toContain('Virker straks')
    expect(markup).toContain('aria-describedby="fjern-besked-nu-hjaelp"')
    expect(markup).toContain('id="fjern-besked-nu-hjaelp"')
  })

  it('is not dressed as a publish (1aa: handling ≠ udgivelse)', () => {
    expect(markup).not.toContain('bg-brand-700')
  })
})

describe('the Fortryd strip', () => {
  const markup = renderToStaticMarkup(
    <AnnouncementVisibilityUndo
      form={form}
      message={describeAnnouncementVisibilityChange({ visible: false })}
      restoreVisible
      version={VERSION}
    />,
  )

  it('reports what already happened, in the phase brief’s own words', () => {
    expect(markup).toContain('Beskeden er fjernet fra hjemmesiden.')
  })

  it('announces politely and does not take focus (1aa)', () => {
    expect(markup).toContain('role="status"')
    expect(markup).not.toContain('autofocus')
    expect(markup).not.toContain('autoFocus')
  })

  it('asks for visibility back, and for nothing else', () => {
    expect(hiddenValue(markup, 'vis')).toBe('1')
    expect(hiddenValue(markup, 'version')).toBe(VERSION)
    expect(fieldNames(markup)).toEqual(['version', 'vis'])

    for (const field of CONTENT_FIELDS) {
      expect(fieldNames(markup), `the undo carries no ${field}`).not.toContain(field)
    }
  })

  it('names what Fortryd would undo, for a screen reader meeting a lone “Fortryd”', () => {
    expect(markup).toContain('Fortryd')
    expect(markup).toContain('vis beskeden på hjemmesiden igen')
  })
})
