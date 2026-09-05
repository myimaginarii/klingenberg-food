import { describe, expect, it } from 'vitest'

import {
  CLIENT_SUBJECT_PATTERN,
  deriveClientSubject,
  LOCAL_CLIENT_ADDRESS,
  normalizeAccountAddress,
  trustedClientAddress,
} from '@/lib/rate-limit/subject'

/**
 * Client-keyed subjects — phase 13B, brief §6 and §12.
 *
 * What the sign-in throttle may believe about a request, and what it turns it into
 * before anything is stored.
 */

function headersOf(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null }
}

describe('trustedClientAddress', () => {
  it('believes no header outside the platform: every client is `local`', () => {
    expect(trustedClientAddress(headersOf({ 'x-real-ip': '203.0.113.9' }), false)).toBe(LOCAL_CLIENT_ADDRESS)
    expect(trustedClientAddress(headersOf({ 'x-forwarded-for': '203.0.113.9' }), false)).toBe(LOCAL_CLIENT_ADDRESS)
    expect(trustedClientAddress(headersOf({}), false)).toBe(LOCAL_CLIENT_ADDRESS)
  })

  it('on the platform reads x-real-ip first', () => {
    expect(
      trustedClientAddress(headersOf({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' }), true),
    ).toBe('203.0.113.9')
  })

  it('falls back to the first x-forwarded-for entry, and lower-cases an IPv6 address', () => {
    expect(trustedClientAddress(headersOf({ 'x-forwarded-for': '2001:DB8::1, 10.0.0.1' }), true)).toBe('2001:db8::1')
  })

  it('treats an empty or malformed header as absent', () => {
    expect(trustedClientAddress(headersOf({ 'x-real-ip': '   ' }), true)).toBe(LOCAL_CLIENT_ADDRESS)
    expect(trustedClientAddress(headersOf({ 'x-real-ip': 'not an address; drop table' }), true)).toBe(
      LOCAL_CLIENT_ADDRESS,
    )
    expect(trustedClientAddress(headersOf({ 'x-real-ip': 'a'.repeat(65) }), true)).toBe(LOCAL_CLIENT_ADDRESS)
  })
})

describe('normalizeAccountAddress', () => {
  it('trims and lower-cases, so one account is one subject', () => {
    expect(normalizeAccountAddress('  Owner@Example.TEST ')).toBe('owner@example.test')
  })
})

describe('deriveClientSubject', () => {
  const secret = 'a-test-secret'

  it('produces the 64-hex-character key the database accepts', () => {
    const subject = deriveClientSubject(secret, 'address', '203.0.113.9')
    expect(subject).toMatch(CLIENT_SUBJECT_PATTERN)
    expect(subject).toHaveLength(64)
  })

  it('is deterministic for one secret and different for another', () => {
    expect(deriveClientSubject(secret, 'address', '203.0.113.9')).toBe(
      deriveClientSubject(secret, 'address', '203.0.113.9'),
    )
    expect(deriveClientSubject('other', 'address', '203.0.113.9')).not.toBe(
      deriveClientSubject(secret, 'address', '203.0.113.9'),
    )
  })

  it('separates the two kinds, so an address and an account can never share a bucket', () => {
    expect(deriveClientSubject(secret, 'address', 'x')).not.toBe(deriveClientSubject(secret, 'account', 'x'))
  })

  it('does not contain the address it was derived from', () => {
    const subject = deriveClientSubject(secret, 'address', '203.0.113.9')
    expect(subject).not.toContain('203')
    expect(subject).not.toContain('113')
  })
})
