import { describe, expect, it } from 'vitest'

import {
  contentSecurityPolicy,
  DISABLED_PERMISSIONS,
  HSTS_MAX_AGE_SECONDS,
  permissionsPolicy,
  securityHeaders,
} from '@/lib/security/headers'

/**
 * The security-header policy — phase 13B (brief §38).
 *
 * The pure builder, pinned directive by directive. What the built site actually
 * sends — and that it sends it together with the public cache header — is
 * `tests/e2e/security-headers.spec.ts`.
 */

const production = { production: true, supabaseOrigin: 'https://project.supabase.test' }
const development = { production: false, supabaseOrigin: 'http://127.0.0.1:54321' }

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/)
      return [name!, sources]
    }),
  )
}

describe('the production Content-Security-Policy', () => {
  const csp = directives(contentSecurityPolicy(production))

  it('names every directive the policy is built from, and no wildcard anywhere', () => {
    expect([...csp.keys()]).toEqual([
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'object-src',
      'base-uri',
      'form-action',
      'frame-ancestors',
      'frame-src',
    ])
    // No `*`, and no bare scheme source (`https:` alone would admit every origin).
    expect(contentSecurityPolicy(production)).not.toMatch(/\*|https?:(?=[\s;]|$)/)
  })

  it('embeds the Google Maps frame and nothing else', () => {
    expect(csp.get('frame-src')).toEqual(["'self'", 'https://www.google.com'])
  })

  it("allows the framework's inline bootstrap scripts and nothing from another origin — and never eval", () => {
    expect(csp.get('script-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(contentSecurityPolicy(production)).not.toContain('unsafe-eval')
  })

  it('allows no inline style: the production HTML carries none', () => {
    expect(csp.get('style-src')).toEqual(["'self'"])
  })

  it('serves images and the uploader connection from this origin and the Supabase origin only', () => {
    expect(csp.get('img-src')).toEqual(["'self'", 'https://project.supabase.test'])
    expect(csp.get('connect-src')).toEqual(["'self'", 'https://project.supabase.test'])
    expect(csp.get('font-src')).toEqual(["'self'"])
  })

  it('blocks plugins, base hijacks, foreign form targets and every framing parent', () => {
    expect(csp.get('object-src')).toEqual(["'none'"])
    expect(csp.get('base-uri')).toEqual(["'self'"])
    expect(csp.get('form-action')).toEqual(["'self'"])
    expect(csp.get('frame-ancestors')).toEqual(["'none'"])
  })

  it('does not upgrade insecure requests: local development serves plain-HTTP images', () => {
    expect(contentSecurityPolicy(production)).not.toContain('upgrade-insecure-requests')
    expect(contentSecurityPolicy(development)).not.toContain('upgrade-insecure-requests')
  })

  it('leaves the Supabase sources out when the origin is not configured, rather than guessing', () => {
    const without = directives(contentSecurityPolicy({ production: true, supabaseOrigin: null }))
    expect(without.get('img-src')).toEqual(["'self'"])
    expect(without.get('connect-src')).toEqual(["'self'"])
  })
})

describe('the development policy', () => {
  it("adds only what the framework's development mode needs: eval for stack traces, inline styles for the overlay", () => {
    const csp = directives(contentSecurityPolicy(development))
    expect(csp.get('script-src')).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"])
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(csp.get('img-src')).toEqual(["'self'", 'http://127.0.0.1:54321'])
  })
})

describe('the Permissions-Policy', () => {
  it('switches off exactly the capabilities the site never uses, for every origin', () => {
    expect(DISABLED_PERMISSIONS).toEqual(['camera', 'microphone', 'geolocation', 'payment', 'usb', 'browsing-topics'])
    expect(permissionsPolicy()).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    )
  })
})

describe('the full header set', () => {
  it('in production: CSP, nosniff, referrer policy, permissions policy, frame denial and HSTS', () => {
    expect(securityHeaders(production)).toEqual([
      { key: 'Content-Security-Policy', value: contentSecurityPolicy(production) },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: permissionsPolicy() },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Strict-Transport-Security', value: `max-age=${HSTS_MAX_AGE_SECONDS}` },
    ])
  })

  it('pins HSTS to two years without includeSubDomains or preload — both are launch decisions', () => {
    const hsts = securityHeaders(production).find((h) => h.key === 'Strict-Transport-Security')!
    expect(HSTS_MAX_AGE_SECONDS).toBe(63_072_000)
    expect(hsts.value).toBe('max-age=63072000')
    expect(hsts.value).not.toContain('includeSubDomains')
    expect(hsts.value).not.toContain('preload')
  })

  it('sends no HSTS from a development build', () => {
    expect(securityHeaders(development).map((h) => h.key)).not.toContain('Strict-Transport-Security')
  })

  it('never sets Cache-Control: the routes own it', () => {
    for (const input of [production, development]) {
      expect(securityHeaders(input).map((h) => h.key.toLowerCase())).not.toContain('cache-control')
    }
  })
})
