import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EmailBlock } from '@/components/site/contact/EmailBlock'

/**
 * The public e-mail block on Find os — the C4 factual check (2026-09-06).
 *
 * `site_contact.email` had no public renderer until the restaurant supplied an
 * address. Two rules are worth asserting as markup, because both are visibility rules
 * rather than logic: the stored value becomes a real `mailto:` link, and an empty field
 * renders *nothing at all* — not a label above a gap — which is what the editor's own
 * hint promises the Owner (1v) and the rule every other contact block already follows
 * (1g, 1k, 1o). The guest-visible walk is `tests/e2e/public-site.spec.ts`.
 */

const EMAIL = 'soebylarsen@gmail.com'

describe('the address the restaurant supplied', () => {
  it('is a mailto link carrying the stored value, printed as text as well', () => {
    const html = renderToStaticMarkup(<EmailBlock email={EMAIL} />)

    expect(html).toContain(`href="mailto:${EMAIL}"`)
    expect(html).toContain(`>${EMAIL}</a>`)
    expect(html).toContain('E-mail')
  })

  it('is never hard-coded: a different stored address is the one that renders', () => {
    const html = renderToStaticMarkup(<EmailBlock email="anden@klingenberg.test" />)

    expect(html).toContain('href="mailto:anden@klingenberg.test"')
    expect(html).not.toContain(EMAIL)
  })

  it('trims the whitespace a paste leaves behind rather than linking it', () => {
    const html = renderToStaticMarkup(<EmailBlock email={`  ${EMAIL}  `} />)

    expect(html).toContain(`href="mailto:${EMAIL}"`)
  })
})

describe('an empty field leaves no gap', () => {
  it('renders nothing at all for null', () => {
    expect(renderToStaticMarkup(<EmailBlock email={null} />)).toBe('')
  })

  it('renders nothing at all for an empty or blank value', () => {
    expect(renderToStaticMarkup(<EmailBlock email="" />)).toBe('')
    expect(renderToStaticMarkup(<EmailBlock email="   " />)).toBe('')
  })

  it('carries no label of its own when there is nothing to label', () => {
    expect(renderToStaticMarkup(<EmailBlock email={null} className="mt-7" />)).not.toContain(
      'E-mail',
    )
  })
})
