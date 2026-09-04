import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AnnouncementCard } from '@/components/admin/dashboard/AnnouncementCard'
import { DashboardBar } from '@/components/admin/dashboard/DashboardBar'
import { DashboardTiles } from '@/components/admin/dashboard/DashboardTiles'
import { NoticeFoot } from '@/components/admin/NoticeFoot'
import { PendingChanges } from '@/components/admin/PendingChanges'
import type { Profile } from '@/lib/auth/session'
import type { PendingChange } from '@/lib/publishing/pending'

/**
 * The dashboard and the shared foot as server markup — phase 12C, designs 1x / 1q / 1y.
 *
 * Each assertion pins one decision that was a measured defect or a frame requirement:
 * the foot's phone classes and its `empty:hidden`, the tile named by its label and
 * described by its line, the phone-only and the wide tile, the bar's DOM order, the
 * band's count with the per-item list beneath it, and the announcement card reading
 * the published state. What these produce on screen is measured in
 * `tests/e2e/dashboard-mobile.spec.ts`.
 */

const staff: Profile = { userId: 'u', email: 's@example.test', name: 'Lokal Medarbejder', role: 'staff', disabledAt: null }

const noop = async () => {}

describe('NoticeFoot — 1y\'s foot, shared', () => {
  it('sticks to the bottom of the phone screen, is last visually, and hides itself when empty', () => {
    const html = renderToStaticMarkup(<NoticeFoot><p>Gemt.</p></NoticeFoot>)

    expect(html).toContain('admin-foot')
    expect(html).toContain('max-md:sticky')
    expect(html).toContain('max-md:bottom-0')
    expect(html).toContain('max-md:order-last')
    expect(html).toContain('empty:hidden')
    // From md it is an ordinary block: no positioning outside the phone variants.
    expect(html).not.toMatch(/(^|\s)(sticky|fixed|order-last)(\s|")/)
  })

  it('renders an empty element, not nothing, so the DOM order never differs between widths', () => {
    const html = renderToStaticMarkup(<NoticeFoot>{null}</NoticeFoot>)
    expect(html).toMatch(/^<div class="admin-foot[^"]*"><\/div>$/)
  })

  // The CSS half of the same promise: an empty foot reserves no scroll clearance. Four
  // of the five screens render the foot unconditionally, so the rule has to look past
  // the element's presence to whether it holds anything (the phase-12 lock pass).
  it('reserves scroll clearance at the bottom of the phone screen only while the foot holds something', async () => {
    const { readFile } = await import('node:fs/promises')
    const css = await readFile(new URL('../../../app/globals.css', import.meta.url), 'utf8')
    expect(css).toContain('html:has(.admin-foot:not(:empty))')
    expect(css).not.toContain('html:has(.admin-foot) {')
    expect(css).toMatch(/html:has\(\.admin-foot:not\(:empty\)\) \{\s*scroll-padding-bottom: 11rem;/)
  })
})

describe('DashboardTiles — 1x\'s rows and 1q\'s cards', () => {
  const tiles = [
    { key: 'menu', label: 'Rediger menu', description: 'Priser, udsolgt, nye retter', href: '/admin/menu', glyph: 'menu' as const },
    { key: 'besked', label: 'Besked på hjemmesiden', description: 'Kort besked øverst på siden', href: '/admin/besked', glyph: 'announcement' as const, phoneOnly: true },
    { key: 'takeaway', label: 'Mad ud af huset', description: 'Tekst om fester og store selskaber', href: '/admin/mad-ud-af-huset', glyph: 'takeaway' as const, wide: true },
  ]

  it('names each link by its label and describes it by its line', () => {
    const html = renderToStaticMarkup(<DashboardTiles tiles={tiles} />)

    expect(html).toContain('aria-label="Administrationens områder"')
    expect(html).toContain('aria-labelledby="flise-menu"')
    expect(html).toContain('aria-describedby="flise-menu-om"')
    expect(html).toContain('id="flise-menu">Rediger menu</b>')
    expect(html).toContain('id="flise-menu-om">Priser, udsolgt, nye retter</span>')
    expect(html).toContain('href="/admin/menu"')
  })

  it('draws the announcement row on the phone only, and the takeaway row across the grid', () => {
    const html = renderToStaticMarkup(<DashboardTiles tiles={tiles} />)

    expect(html).toMatch(/<li class="md:hidden[^"]*"><a[^>]*aria-labelledby="flise-besked"/)
    expect(html).toMatch(/<li class="[^"]*md:col-span-2 lg:col-span-3[^"]*"><a[^>]*aria-labelledby="flise-takeaway"/)
  })

  it('is a 68 px row on the phone and a card from md, in one markup', () => {
    const html = renderToStaticMarkup(<DashboardTiles tiles={tiles} />)
    expect(html).toContain('min-h-[4.25rem]')
    expect(html).toContain('md:flex-col')
    expect(html).toContain('lg:grid-cols-3')
  })
})

describe('DashboardBar — 1q\'s order at every width', () => {
  it('reads wordmark, account, link, sign-out — and says who is signed in', () => {
    const html = renderToStaticMarkup(<DashboardBar name="Lokal Ejer" role="owner" signOut={noop} />)

    const order = ['Administration', 'Logget ind som', 'Lokal Ejer', 'Ejer', 'Se hjemmesiden', 'Log ud'].map((word) => html.indexOf(word))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('href="/"')
    expect(html).toContain('type="submit"')
  })
})

describe('PendingChanges — the band with the phase-4 list beneath it', () => {
  const change = (entity: PendingChange['entity'], entityId: string, subject: string | null, requiresOwner: boolean): PendingChange => ({
    entity,
    entityId,
    label: entity === 'dish' ? 'Ret' : 'Forsiden',
    subject,
    state: 'draft',
    updatedAt: '2026-09-04T10:00:00Z',
    editorName: 'Lokal Medarbejder',
    requiresOwner,
  })

  it('renders nothing when nothing is pending', () => {
    expect(renderToStaticMarkup(<PendingChanges changes={[]} profile={staff} action={noop} />)).toBe('')
  })

  it('counts, offers Forhåndsvis and Offentliggør, and lists each item once with its checkbox', () => {
    const html = renderToStaticMarkup(
      <PendingChanges
        action={noop}
        changes={[change('dish', 'd1', 'Odin', false), change('page:home', 'h', null, true)]}
        profile={staff}
      />,
    )

    expect(html).toContain('aria-label="Ændringer der venter"')
    expect(html).toContain('2 ændringer er ikke offentliggjort')
    // The titles appear once each — in the list, where the locked suites address them.
    expect(html.match(/Ret: Odin/g)).toHaveLength(1)
    expect(html.match(/>Forsiden</g)).toHaveLength(1)
    expect(html).toContain('href="/api/preview/start?maal=menu"')
    expect(html).toContain('>Offentliggør</button>')
    // Two rows: the dish checked, the Owner's Forsiden shown but disabled, and said.
    expect(html.match(/type="checkbox"/g)).toHaveLength(2)
    expect(html).toContain('disabled=""')
    expect(html).toContain('Kun ejeren kan offentliggøre dette.')
    expect(html).toContain('sidst rettet af Lokal Medarbejder')
  })
})

describe('AnnouncementCard — the published state, never a draft', () => {
  it('shows the message, "Vises nu" and when it disappears, with the way to the editor', () => {
    const html = renderToStaticMarkup(
      <AnnouncementCard
        expiresAtLabel="søndag 14.09.2026 kl. 20:00"
        href="/admin/besked"
        message="Ændrede åbningstider søndag · 17:00–19:00"
        state={{ badge: 'Vises nu', sentence: 'Beskeden vises øverst på hjemmesiden indtil søndag 14.09.2026 kl. 20:00.', tone: 'success' }}
      />,
    )

    expect(html).toContain('Besked på hjemmesiden')
    expect(html).toContain('Vises nu')
    expect(html).toContain('“Ændrede åbningstider søndag · 17:00–19:00”')
    expect(html).toContain('Forsvinder af sig selv søndag 14.09.2026 kl. 20:00')
    expect(html).toContain('href="/admin/besked"')
    expect(html).toContain('Rediger besked')
  })

  it('says there is no message, in phase 7\'s own words, when there is none', () => {
    const html = renderToStaticMarkup(
      <AnnouncementCard
        expiresAtLabel={null}
        href="/admin/besked"
        message={null}
        state={{ badge: 'Ingen besked', sentence: 'Der står ingen besked på hjemmesiden lige nu.', tone: 'neutral' }}
      />,
    )

    expect(html).toContain('Ingen besked')
    expect(html).toContain('Der står ingen besked på hjemmesiden lige nu.')
    expect(html).not.toContain('Forsvinder')
  })
})
