import { describe, expect, it } from 'vitest'

import {
  ANNOUNCEMENT_PAGE_OPTIONS,
  ANNOUNCEMENT_PAGE_ROUTES_MATCH_NAV,
  isAllowedExternalUrl,
  isAnnouncementPageRoute,
  resolveAnnouncementLink,
} from '@/lib/announcements/link'
import { ANNOUNCEMENT_LINK_PAGES } from '@/lib/schemas/announcement'
import { MAIN_NAV } from '@/lib/site/navigation'

/**
 * The announcement's optional link — technical plan §8, design 1ac.
 *
 * §8's risk table calls this row "open redirect / injected announcement link", so these
 * are security assertions rather than formatting ones. Two rules, and both are stated as
 * what is *accepted* rather than as a list of what is blocked:
 *
 *   * an internal destination is one of **our own six routes**, chosen from a closed set;
 *   * an external destination is an absolute **https** URL with a host.
 *
 * Everything else fails, and the tests below name the specific things somebody would try.
 */

describe('the six internal destinations', () => {
  it('are exactly the site’s own navigation routes', () => {
    // Two lists, one set. They are separate because they mirror different things — a
    // database CHECK and the approved header — so the equality is asserted rather than
    // arranged by sharing one constant.
    expect([...ANNOUNCEMENT_PAGE_ROUTES_MATCH_NAV].sort()).toEqual(
      MAIN_NAV.map((item) => item.href).sort(),
    )
  })

  it('carry the words the navigation already uses', () => {
    expect(ANNOUNCEMENT_PAGE_OPTIONS).toEqual([
      { route: '/', label: 'Forside' },
      { route: '/menu', label: 'Menu' },
      { route: '/mad-ud-af-huset', label: 'Mad ud af huset' },
      { route: '/om-os', label: 'Om os' },
      { route: '/nyheder', label: 'Nyheder' },
      { route: '/find-os', label: 'Find os' },
    ])
  })

  it.each([...ANNOUNCEMENT_LINK_PAGES])('accepts %s', (route) => {
    expect(isAnnouncementPageRoute(route)).toBe(true)
  })

  it.each([
    ['a route that does not exist', '/tilbud'],
    ['an admin route', '/admin'],
    ['an admin route that exists', '/admin/besked'],
    ['a route with a query string', '/menu?x=1'],
    ['a route with a fragment', '/menu#burgere'],
    ['a traversal', '/menu/../admin'],
    ['a trailing slash', '/menu/'],
    ['a protocol-relative path', '//evil.test/menu'],
    ['an absolute URL', 'https://evil.test/menu'],
    ['a relative path', 'menu'],
    ['the empty string', ''],
  ])('refuses %s', (_name, value) => {
    expect(isAnnouncementPageRoute(value)).toBe(false)
  })

  it('refuses anything that is not a string', () => {
    for (const value of [null, undefined, 0, {}, ['/menu']]) {
      expect(isAnnouncementPageRoute(value)).toBe(false)
    }
  })
})

describe('an external address', () => {
  it.each([
    'https://example.test',
    'https://example.test/',
    'https://example.test/side',
    'https://www.example.test/en/side?a=1#b',
    'https://example.test:8443/side',
  ])('accepts the https address %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true)
  })

  it.each([
    ['http, which §8 does not accept', 'http://example.test/side'],
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: with padding the browser would strip', 'java\tscript:alert(1)'],
    ['data:', 'data:text/html;base64,PHNjcmlwdD4='],
    ['a data URL carrying markup', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['mailto:', 'mailto:nogen@example.test'],
    ['tel:', 'tel:+4563908300'],
    ['a protocol-relative URL', '//example.test/side'],
    ['a scheme-less host', 'example.test/side'],
    ['a bare path', '/find-os'],
    ['a malformed URL', 'https://'],
    ['nonsense', 'ikke en adresse'],
    ['the empty string', ''],
    ['leading whitespace', ' https://example.test'],
    ['trailing whitespace', 'https://example.test '],
    ['an embedded newline', 'https://example.test/a\nb'],
    ['a mixed-case javascript scheme', 'JavaScript:alert(1)'],
    ['an uppercase HTTP scheme', 'HTTP://example.test'],
  ])('refuses %s', (_name, url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
  })

  it('refuses anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, ['https://example.test']]) {
      expect(isAllowedExternalUrl(value)).toBe(false)
    }
  })

  it('accepts an uppercase HTTPS scheme, because a URL scheme is case-insensitive', () => {
    // `new URL` lower-cases the protocol, so this is genuinely the same address. It is
    // asserted rather than left implicit, because the neighbouring HTTP case is refused
    // for the *protocol* and not for the casing.
    expect(isAllowedExternalUrl('HTTPS://example.test/side')).toBe(true)
  })
})

describe('resolving a stored row into a link', () => {
  it('renders no link at all when link_type is none', () => {
    expect(
      resolveAnnouncementLink({
        link_type: 'none',
        link_page: null,
        link_url: null,
        link_label: null,
      }),
    ).toBeNull()
  })

  it('ignores a label left behind on a row with no link', () => {
    expect(
      resolveAnnouncementLink({
        link_type: 'none',
        link_page: null,
        link_url: null,
        link_label: 'Se tider',
      }),
    ).toBeNull()
  })

  it('renders an internal page link with the label somebody wrote', () => {
    expect(
      resolveAnnouncementLink({
        link_type: 'page',
        link_page: '/find-os',
        link_url: null,
        link_label: 'Se tider',
      }),
    ).toEqual({ href: '/find-os', label: 'Se tider', external: false })
  })

  it('falls back to the page’s own name when no label was written', () => {
    expect(
      resolveAnnouncementLink({
        link_type: 'page',
        link_page: '/find-os',
        link_url: null,
        link_label: null,
      }),
    ).toEqual({ href: '/find-os', label: 'Find os', external: false })
  })

  it('treats a whitespace-only label as no label', () => {
    expect(
      resolveAnnouncementLink({
        link_type: 'page',
        link_page: '/menu',
        link_url: null,
        link_label: '   ',
      }),
    ).toEqual({ href: '/menu', label: 'Menu', external: false })
  })

  it('renders an https address as an external link', () => {
    expect(
      resolveAnnouncementLink({
        link_type: 'url',
        link_page: null,
        link_url: 'https://example.test/arrangement',
        link_label: 'Læs mere',
      }),
    ).toEqual({
      href: 'https://example.test/arrangement',
      label: 'Læs mere',
      external: true,
    })
  })

  it.each([
    ['an unapproved internal route', { link_type: 'page' as const, link_page: '/admin', link_url: null, link_label: 'X' }],
    ['a page link with no page', { link_type: 'page' as const, link_page: null, link_url: null, link_label: 'X' }],
    ['a page link that also carries a url', { link_type: 'page' as const, link_page: '/menu', link_url: 'https://example.test', link_label: 'X' }],
    ['an http address', { link_type: 'url' as const, link_page: null, link_url: 'http://example.test', link_label: 'X' }],
    ['a javascript address', { link_type: 'url' as const, link_page: null, link_url: 'javascript:alert(1)', link_label: 'X' }],
    ['a data address', { link_type: 'url' as const, link_page: null, link_url: 'data:text/html,<b>x</b>', link_label: 'X' }],
    ['a url link with no url', { link_type: 'url' as const, link_page: null, link_url: null, link_label: 'X' }],
    ['a url link that also carries a page', { link_type: 'url' as const, link_page: '/menu', link_url: 'https://example.test', link_label: 'X' }],
    ['an external address with no label', { link_type: 'url' as const, link_page: null, link_url: 'https://example.test', link_label: null }],
  ])('renders nothing for %s', (_name, values) => {
    expect(resolveAnnouncementLink(values)).toBeNull()
  })
})
