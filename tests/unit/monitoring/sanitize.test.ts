import type { ErrorEvent } from '@sentry/nextjs'
import { describe, expect, it } from 'vitest'

import {
  FILTERED,
  MAX_BREADCRUMBS,
  REDACTED,
  isSensitiveKey,
  redactText,
  sanitizeBreadcrumb,
  sanitizeErrorEvent,
  scrubValue,
  stripQuery,
} from '@/lib/monitoring/sanitize'

/**
 * The central sanitizer — phase 13C (brief §9, §11, §12, §30). Every rule held
 * against a literal event: what leaves, what never does.
 */

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24ifQ.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

/** A credential-bearing URL, assembled at run time so the source policy's domain rule reads no literal. */
function credentialUrl(scheme: string, credentials: string, rest: string): string {
  return [scheme, '://', credentials, '@', rest].join('')
}

/** Secret names assembled at run time, for the same reason the env suite does it. */
const RATE_LIMIT_NAME = ['RATE', 'LIMIT', 'SECRET'].join('_')
const DSN_NAME = ['SENTRY', 'DSN'].join('_')

describe('redactText', () => {
  it('replaces a JWT wherever it appears', () => {
    expect(redactText(`Bearer ${JWT} refused`)).not.toContain(JWT)
    // The JWT rule runs first, then the parameter rule redacts the whole value.
    expect(redactText(`apikey=${JWT}`)).toBe(`apikey=${REDACTED}`)
    expect(redactText(`the anon key ${JWT} was refused`)).toBe('the anon key [jwt] was refused')
  })

  it('strips credentials from a URL', () => {
    expect(redactText(credentialUrl('postgresql', 'postgres:hunter2', '127.0.0.1:54322/postgres'))).toBe(
      credentialUrl('postgresql', '[credentials]', '127.0.0.1:54322/postgres'),
    )
    expect(redactText(credentialUrl('https', 'abc123', 'o1.ingest.sentry.test/1'))).toBe(
      credentialUrl('https', '[credentials]', 'o1.ingest.sentry.test/1'),
    )
  })

  it('redacts token-carrying query parameters', () => {
    expect(redactText('/admin/bekraeft?token_hash=pkce_abcdef&type=recovery')).toBe(
      `/admin/bekraeft?token_hash=${REDACTED}&type=recovery`,
    )
    expect(redactText('PUT /storage/v1/object/upload/sign/x?token=abc.def')).toContain(`token=${REDACTED}`)
    expect(redactText('?code=12345678&next=/admin')).toBe(`?code=${REDACTED}&next=/admin`)
  })

  it('redacts a bearer value and a Supabase auth cookie', () => {
    expect(redactText('authorization: Bearer abcdefghijklmnop')).toBe(`authorization: Bearer ${REDACTED}`)
    expect(redactText('sb-localhost-auth-token.0=base64-abc; path=/')).toBe(
      `sb-localhost-auth-token.0=${REDACTED}; path=/`,
    )
  })

  it('replaces a Supabase secret key in the non-JWT format (the lock pass)', () => {
    const key = ['sb_secret_', 'N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'].join('')
    expect(redactText(`service role ${key} refused`)).toBe('service role [secret-key] refused')
    expect(redactText(`apikey=${key}`)).toBe(`apikey=${REDACTED}`)
    // The publishable key is public by design and stays readable.
    expect(redactText('sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH')).toBe('sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH')
  })

  it('replaces an e-mail address in a sentence', () => {
    expect(redactText('Inviting ny.medarbejder@example.test failed')).toBe('Inviting [email] failed')
    expect(redactText('two: a@b.test, c.d+e@f-g.h.test')).toBe('two: [email], [email]')
  })

  it('leaves ordinary text alone', () => {
    const text = 'Rate limiter unavailable for content:save: connection refused'
    expect(redactText(text)).toBe(text)
  })
})

describe('stripQuery', () => {
  it('drops the query and the fragment', () => {
    expect(stripQuery('/admin/bekraeft?token_hash=abc&type=invite')).toBe('/admin/bekraeft')
    expect(stripQuery('/menu#burgere')).toBe('/menu')
    expect(stripQuery('/admin/menu')).toBe('/admin/menu')
  })
})

describe('sensitive keys and scrubValue', () => {
  it('names the credential keys', () => {
    for (const key of [
      'Authorization',
      'cookie',
      'Set-Cookie',
      'password',
      RATE_LIMIT_NAME,
      'token_hash',
      'apikey',
      'api_key',
      'x-api-key',
      DSN_NAME,
      'service_role',
      'session',
      // The Danish words a form field of this administration would carry.
      'adgangskode',
      'ny_adgangskode',
      'kodeord',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true)
    }
    expect(isSensitiveKey('scope')).toBe(false)
    expect(isSensitiveKey('account_id')).toBe(false)
    expect(isSensitiveKey('storage_path')).toBe(false)
  })

  it('filters sensitive keys, redacts strings, keeps identifiers, bounds depth', () => {
    const scrubbed = scrubValue({
      account_id: '7a4b1e6c-0000-4000-8000-000000000001',
      password: 'hunter2',
      nested: { Authorization: 'Bearer abcdefghijklmnop', note: `see ${JWT}` },
      list: ['ok', credentialUrl('postgres', 'u:p', 'host/db')],
      count: 3,
      flag: true,
      nothing: null,
    }) as Record<string, unknown>

    expect(scrubbed.account_id).toBe('7a4b1e6c-0000-4000-8000-000000000001')
    expect(scrubbed.password).toBe(FILTERED)
    expect((scrubbed.nested as Record<string, unknown>).Authorization).toBe(FILTERED)
    expect((scrubbed.nested as Record<string, unknown>).note).toBe('see [jwt]')
    expect(scrubbed.list).toEqual(['ok', credentialUrl('postgres', '[credentials]', 'host/db')])
    expect(scrubbed.count).toBe(3)
    expect(scrubbed.flag).toBe(true)
    expect(scrubbed.nothing).toBeNull()

    let deep: unknown = 'leaf'
    for (let i = 0; i < 10; i += 1) deep = { d: deep }
    expect(JSON.stringify(scrubValue(deep))).toContain('[Truncated]')
  })
})

describe('sanitizeBreadcrumb', () => {
  it('drops request breadcrumbs whole', () => {
    expect(sanitizeBreadcrumb({ category: 'http', data: { url: 'https://x.test/?token=1' } })).toBeNull()
    expect(sanitizeBreadcrumb({ category: 'fetch' })).toBeNull()
    expect(sanitizeBreadcrumb({ category: 'xhr' })).toBeNull()
  })

  it('redacts console breadcrumbs and filters their sensitive data', () => {
    const crumb = sanitizeBreadcrumb({
      category: 'console',
      message: `create_image refused: token=abcdef ${JWT}`,
      data: { arguments: ['x'], cookie: 'sb=1' },
    })
    expect(crumb?.message).toBe(`create_image refused: token=${REDACTED} [jwt]`)
    expect(crumb?.data).toEqual({ arguments: ['x'], cookie: FILTERED })
  })
})

describe('sanitizeErrorEvent', () => {
  const event: ErrorEvent = {
    type: undefined,
    event_id: 'e1',
    server_name: 'ip-10-0-0-1',
    transaction: 'GET /admin/bekraeft?token_hash=abc',
    message: `failed with ${JWT}`,
    request: {
      method: 'POST',
      url: 'https://site.test/admin/bekraeft?token_hash=abc&type=invite',
      headers: { cookie: 'sb-x-auth-token=abc', authorization: 'Bearer abcdefghijklmnop', 'user-agent': 'UA' },
      cookies: { 'sb-x-auth-token': 'abc' },
      data: { password: 'hunter2', email: 'a@b.test' },
      query_string: 'token_hash=abc',
      env: { REMOTE_ADDR: '10.0.0.1' },
    },
    user: { id: '7a4b1e6c-0000-4000-8000-000000000001', email: 'staff@example.test', ip_address: '10.0.0.1', username: 'x' },
    tags: { operation: 'server-action', token: 'abc' },
    extra: { detail: credentialUrl('postgres', 'u:p', 'h/db'), secret: 'x' },
    contexts: {
      nextjs: { request_path: '/admin/bekraeft?token_hash=abc', route_type: 'route' },
      operation: { account_id: 'uuid-1', authorization: 'x' },
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: `refused ${JWT}`,
          mechanism: { type: 'generic', handled: false, data: { cookie: 'abc', function: 'f' } },
        },
      ],
    },
    breadcrumbs: [
      { category: 'http', data: { url: 'https://x.test/?token=1' } },
      { category: 'console', message: `Bearer abcdefghijklmnop` },
    ],
  }

  const out = sanitizeErrorEvent(event)

  it('reduces the request to the method and the path — no headers, cookies, body, query or env', () => {
    expect(out.request).toEqual({ method: 'POST', url: 'https://site.test/admin/bekraeft' })
  })

  it('reduces the user to the internal id', () => {
    expect(out.user).toEqual({ id: '7a4b1e6c-0000-4000-8000-000000000001' })
    expect(sanitizeErrorEvent({ type: undefined, user: { email: 'a@b.test' } }).user).toBeUndefined()
  })

  it('drops the hostname and the query from the transaction name', () => {
    expect(out.server_name).toBeUndefined()
    expect(out.transaction).toBe('GET /admin/bekraeft')
  })

  it('redacts messages, exception values and mechanism data', () => {
    expect(out.message).toBe('failed with [jwt]')
    expect(out.exception?.values?.[0]?.value).toBe('refused [jwt]')
    expect(out.exception?.values?.[0]?.mechanism?.data).toEqual({ cookie: FILTERED, function: 'f' })
  })

  it('filters sensitive tags, extra and context keys and keeps the technical ones', () => {
    expect(out.tags).toEqual({ operation: 'server-action', token: FILTERED })
    expect(out.extra).toEqual({ detail: credentialUrl('postgres', '[credentials]', 'h/db'), secret: FILTERED })
    expect(out.contexts?.operation).toEqual({ account_id: 'uuid-1', authorization: FILTERED })
  })

  it('strips the query from the framework’s request path', () => {
    expect(out.contexts?.nextjs).toEqual({ request_path: '/admin/bekraeft', route_type: 'route' })
  })

  it('drops request breadcrumbs, redacts the rest, and caps the trail', () => {
    expect(out.breadcrumbs).toEqual([{ category: 'console', message: `Bearer ${REDACTED}` }])

    const many = sanitizeErrorEvent({
      type: undefined,
      breadcrumbs: Array.from({ length: MAX_BREADCRUMBS + 10 }, (_, i) => ({ category: 'console', message: `m${i}` })),
    })
    expect(many.breadcrumbs).toHaveLength(MAX_BREADCRUMBS)
    expect(many.breadcrumbs?.[0]?.message).toBe('m10')
  })

  it('never contains the forbidden values anywhere in the serialised event', () => {
    const text = JSON.stringify(out)
    for (const forbidden of [JWT, 'hunter2', 'staff@example.test', '10.0.0.1', 'sb-x-auth-token=abc', 'token_hash=abc', 'abcdefghijklmnop', 'ip-10-0-0-1', 'u:p@h']) {
      expect(text, forbidden).not.toContain(forbidden)
    }
  })

  it('does not mutate the event it was given', () => {
    expect(event.request?.headers).toBeDefined()
    expect(event.user?.email).toBe('staff@example.test')
  })
})
