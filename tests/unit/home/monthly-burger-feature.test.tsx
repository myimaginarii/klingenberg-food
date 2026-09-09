import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MonthlyBurgerFeature } from '@/components/site/home/MonthlyBurgerFeature'
import type { HomepageMonthlyBurgerSection, MonthlyBurgerView } from '@/lib/menu/view'

/**
 * The Forside's Månedens burger section, rendered.
 *
 * The *decision* of which state to show lives in `lib/menu/view.ts` and is tested
 * there; what is asserted here is the markup each state produces — that an absent
 * burger draws the menu page's own empty card and nothing invented, that a burger kept
 * off the Forside really does emit nothing rather than an empty band, that a sold-out
 * one keeps its place without an ordering action, and that no burger name, price or
 * ingredient is written by this component.
 *
 * Rendered with `react-dom/server`, which the project already depends on. No test
 * renderer, no DOM environment and no new dependency.
 */
const PHONE = '+45 63 90 83 00'

function burger(overrides: Partial<MonthlyBurgerView> = {}): MonthlyBurgerView {
  return {
    name: 'Septemberburgeren',
    description: 'Beskrivelse fra administrationen.',
    priceOre: 10500,
    startsOn: '2026-09-01',
    endsOn: '2026-09-30',
    soldOutOn: null,
    image: null,
    showOnHomepage: true,
    soldOut: false,
    ...overrides,
  }
}

function active(overrides: Partial<MonthlyBurgerView> = {}): HomepageMonthlyBurgerSection {
  return { kind: 'burger', burger: burger(overrides) }
}

function render(props: Parameters<typeof MonthlyBurgerFeature>[0]): string {
  return renderToStaticMarkup(<MonthlyBurgerFeature {...props} />)
}

describe('MonthlyBurgerFeature', () => {
  it('renders nothing at all for an active burger kept off the Forside', () => {
    expect(render({ section: { kind: 'hidden' }, primaryPhone: PHONE })).toBe('')
  })

  it('draws the menu page’s own empty card when there is no burger', () => {
    const html = render({ section: { kind: 'empty' }, primaryPhone: PHONE })

    expect(html).toContain('Der er ingen månedens burger lige nu.')
    expect(html).toContain('Skiftende')
    // An ordinary card, not an unfilled-input treatment: no dashed rule, no field background.
    expect(html).not.toContain('border-dashed')
    expect(html).not.toContain('bg-field-bg')
    // The card's heading is the section's heading, so the outline gains one level and
    // no visually-hidden duplicate.
    expect(html).toContain('<h2 id="maanedens-burger-titel"')
    expect(html).toContain('aria-labelledby="maanedens-burger-titel"')
    expect(html).not.toContain('<h3')
  })

  it('invents no burger, price or ordering action for the empty state', () => {
    const html = render({ section: { kind: 'empty' }, primaryPhone: PHONE })

    expect(html).not.toContain('kr.')
    expect(html).not.toContain('tel:')
    expect(html).not.toContain('Bestil på telefon')
    expect(html).not.toContain('ikke oplyst')
    // No photograph frame and no placeholder: the empty card is text on the band.
    expect(html).not.toContain('afventer')
  })

  it('keeps the empty state on the approved beige band and no other surface', () => {
    const html = render({ section: { kind: 'empty' }, primaryPhone: PHONE })

    expect(html).toContain('bg-section')
    expect(html).toContain('bg-surface')
    expect(html).not.toContain('bg-brand')
    expect(html).not.toContain('gradient')
  })

  it('shows the administration’s own name, description and price', () => {
    const html = render({ section: active(), primaryPhone: PHONE })

    expect(html).toContain('Septemberburgeren')
    expect(html).toContain('Beskrivelse fra administrationen.')
    expect(html).toContain('105 kr.')
  })

  it('gives the burger the section heading, labelled by the eyebrow above it', () => {
    const html = render({ section: active(), primaryPhone: PHONE })

    expect(html).toContain('<h2 id="maanedens-burger-titel"')
    expect(html).toContain('aria-labelledby="maanedens-burger-titel"')
    expect(html).toContain('Månedens burger')
  })

  it('prints the window as the section dateline', () => {
    expect(render({ section: active(), primaryPhone: PHONE })).toContain('01.09.2026–30.09.2026')
  })

  it('offers the primary number as "Bestil på telefon"', () => {
    const html = render({ section: active(), primaryPhone: PHONE })

    expect(html).toContain('Bestil på telefon')
    expect(html).toContain('href="tel:+4563908300"')
    expect(html).toContain(PHONE)
  })

  it('links on to the menu', () => {
    expect(render({ section: active(), primaryPhone: PHONE })).toContain('href="/menu"')
  })

  it('keeps a sold-out burger visible, says so, and withdraws the ordering action', () => {
    const html = render({ section: active({ soldOut: true }), primaryPhone: PHONE })

    expect(html).toContain('Septemberburgeren')
    expect(html).toContain('Udsolgt i dag')
    expect(html).not.toContain('Bestil på telefon')
    expect(html).not.toContain('tel:')
    // The price stays readable so the guest can see what it costs tomorrow (1af).
    expect(html).toContain('105 kr.')
    expect(html).toContain('line-through')
    // The menu is still reachable — the section does not become a dead end.
    expect(html).toContain('href="/menu"')
  })

  it('drops the phone action rather than rendering a broken link when no number is stored', () => {
    const html = render({ section: active(), primaryPhone: null })

    expect(html).toContain('Septemberburgeren')
    expect(html).not.toContain('tel:')
  })

  it('renders no dateline for a burger with no window, rather than an empty one', () => {
    const html = render({
      section: active({ startsOn: null, endsOn: null }),
      primaryPhone: PHONE,
    })

    expect(html).toContain('Septemberburgeren')
    expect(html).not.toContain('Til og med')
    expect(html).not.toContain('Fra ')
  })

  it('omits an unwritten description instead of leaving an empty paragraph', () => {
    const html = render({ section: active({ description: null }), primaryPhone: PHONE })

    expect(html).not.toContain('<p class="mt-2.5')
  })

  it('omits an unset price instead of inventing one', () => {
    const html = render({ section: active({ priceOre: null }), primaryPhone: PHONE })

    expect(html).toContain('Septemberburgeren')
    expect(html).not.toContain('kr.')
  })

  it('uses the approved surfaces and no others', () => {
    const activeHtml = render({ section: active(), primaryPhone: PHONE })
    const sold = render({ section: active({ soldOut: true }), primaryPhone: PHONE })

    expect(activeHtml).toContain('bg-section')
    expect(activeHtml).toContain('bg-surface')
    expect(sold).toContain('bg-surface-muted')
    expect(activeHtml).not.toContain('gradient')
  })
})
