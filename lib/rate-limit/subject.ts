import { createHmac } from 'node:crypto'

/**
 * Client-keyed subjects for the sign-in path — technical plan §8, §12; phase 13B.
 *
 * The sign-in and password-reset actions run without a session, so the limiter
 * cannot key them by `auth.uid()`. They are keyed by the client instead — and the
 * client is the one thing this system has otherwise refused to record: §12 promises
 * no tracking, and the limiter is not allowed to become analytics through the back
 * door. So three rules:
 *
 *   1. **Only a trusted address is read.** On Vercel the platform's proxy writes
 *      `x-real-ip` itself, overwriting anything the client sent, so it can be
 *      believed. Anywhere else — local development, a test run, an unknown host —
 *      no header is trusted, and every client shares one subject (`local`). A
 *      spoofable `x-forwarded-for` from an untrusted environment would let an
 *      attacker choose their own bucket, which is the opposite of a limit.
 *   2. **Nothing stored is reversible.** The subject is an HMAC-SHA256 over the
 *      address (or the normalised e-mail), under a server-side secret. The table
 *      holds 64 hex characters that name nobody.
 *   3. **The key is a secret, not a hash.** A plain hash of an IPv4 address is a
 *      lookup table away from the address; the HMAC is not. The secret lives in
 *      the environment (the rate-limit secret of §10e, read through
 *      `lib/env/server.ts`) and is never logged.
 *
 * The e-mail subject exists for one reason: a run spread across many addresses at
 * one account. It is deliberately the looser tier of the two (`scopes.ts`), so that
 * knowing the owner's address is not enough to lock the owner out cheaply.
 */

export type ClientSubjectKind = 'address' | 'account'

/** How many of the trusted forwarding headers the platform sets. Vercel sets both. */
export const TRUSTED_ADDRESS_HEADERS = ['x-real-ip', 'x-forwarded-for'] as const

export const LOCAL_CLIENT_ADDRESS = 'local'

type HeaderReader = { get(name: string): string | null }

/**
 * The client address this environment may believe, or `local` when it may believe
 * none.
 *
 * `x-real-ip` first; then the first entry of `x-forwarded-for`, which on Vercel is
 * the platform's own. A header that is present but empty or malformed is treated as
 * absent. The address is never returned to a caller that would store it — it goes
 * straight into {@link deriveClientSubject}.
 */
export function trustedClientAddress(headers: HeaderReader, trustHeaders: boolean): string {
  if (!trustHeaders) return LOCAL_CLIENT_ADDRESS

  const realIp = cleanAddress(headers.get('x-real-ip'))
  if (realIp !== null) return realIp

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded !== null) {
    const first = cleanAddress(forwarded.split(',')[0] ?? null)
    if (first !== null) return first
  }

  return LOCAL_CLIENT_ADDRESS
}

function cleanAddress(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  // An address is short and printable; anything else is not one.
  if (trimmed.length === 0 || trimmed.length > 64) return null
  if (!/^[0-9a-fA-F:.\[\]]+$/.test(trimmed)) return null
  return trimmed.toLowerCase()
}

/** The account key: trimmed and lower-cased, so `Owner@Example.test ` and `owner@example.test` are one subject. */
export function normalizeAccountAddress(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * The 64-hex-character subject the database function accepts.
 *
 * The kind is part of the message, so an address and an e-mail that happen to be the
 * same string cannot collide, and a subject derived for one scope family cannot be
 * replayed as the other.
 */
export function deriveClientSubject(secret: string, kind: ClientSubjectKind, value: string): string {
  return createHmac('sha256', secret).update(`${kind}\n${value}`).digest('hex')
}

/** What the database function requires of a client subject, restated for tests. */
export const CLIENT_SUBJECT_PATTERN = /^[0-9a-f]{64}$/
