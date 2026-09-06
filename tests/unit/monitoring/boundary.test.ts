import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuthAdmin } from '@/lib/accounts/auth-admin'
import { setAccountActive, inviteAccount } from '@/lib/accounts/admin'
import type { Profile } from '@/lib/auth/session'
import { deleteLibraryImage } from '@/lib/images/admin'
import { finalizeImageUpload } from '@/lib/images/finalize'
import { createImageStorage, type ImageStorage } from '@/lib/images/storage'
import { OPERATIONAL_EVENTS, reportOperationalEvent, resetOperationalStorm } from '@/lib/monitoring/report'
import { reportRequestError } from '@/lib/monitoring/request-error'
import { DROPPED_INTEGRATIONS, initMonitoring, monitoringOptions } from '@/lib/monitoring/sentry'
import { consumeRateLimit, releaseSignInAttempt, reserveSignInAttempt } from '@/lib/rate-limit/limiter'

/**
 * The monitoring boundary, end to end — phase 13C (brief §29, §31).
 *
 * The real SDK client, the real sanitizer, the real reporter and the real
 * application modules, with exactly one substitution: a transport that records
 * every envelope instead of sending it. Each story below runs a real code path —
 * the limiter door over a failing database client, the account transition over a
 * failing Auth Admin API, the storage boundary over a failing Storage API, the
 * framework hook over a thrown Server Action error — and then inspects the event
 * the SDK would have sent, byte for byte, for the fields that must and must not be
 * there. No network is touched, and no real project exists behind the DSN.
 */

/** A credential-bearing URL, assembled at run time so the source policy's domain rule reads no literal. */
function credentialUrl(scheme: string, credentials: string, rest: string): string {
  return [scheme, '://', credentials, '@', rest].join('')
}

const DSN = credentialUrl('https', 'public', 'o1.ingest.sentry.test/1')
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const ACCOUNT_ID = '7a4b1e6c-0000-4000-8000-000000000001'
const STORAGE_PATH = '0b8f6c2e-1111-4222-8333-444455556666/original.jpg'
const EMAIL = 'ny.medarbejder@example.test'
const ZERO_COUNTS = { dish: 0, weekly: 0, monthly: 0, news: 0, 'page:home': 0, 'page:takeaway': 0, 'page:about': 0 }

type Sent = { type: string; payload: Record<string, unknown> }
const sent: Sent[] = []

/** The SDK's own transport factory over a delivery function that records instead of sending. */
const recordingTransport: Sentry.NodeOptions['transport'] = (options) =>
  Sentry.createTransport(options, async (request) => {
    const body = typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body)
    const lines = body.split('\n').filter((line) => line.length > 0)
    // Envelope: header, then (item header, item payload) pairs.
    for (let i = 1; i + 1 < lines.length; i += 2) {
      const header = JSON.parse(lines[i]!) as { type: string }
      const payload = JSON.parse(lines[i + 1]!) as Record<string, unknown>
      sent.push({ type: header.type, payload })
    }
    return { statusCode: 200 }
  })

function events(): Record<string, unknown>[] {
  return sent.filter((item) => item.type === 'event').map((item) => item.payload)
}

async function flushed(): Promise<Record<string, unknown>[]> {
  await Sentry.flush(2_000)
  return events()
}

/**
 * The event as text, minus the stack frames: the ContextLines integration quotes
 * source lines around each frame, and in this suite those lines are this file —
 * which spells the forbidden values on purpose. What is asserted is the data the
 * SDK carries about the failure, not the test's own source code.
 */
function serialised(event: Record<string, unknown>): string {
  const exception = event.exception as { values?: Record<string, unknown>[] } | undefined
  const values = exception?.values?.map((value) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'stacktrace')),
  )
  return JSON.stringify(values === undefined ? event : { ...event, exception: { ...exception, values } })
}

// The two service-role boundaries construct their own client; the tests hand them
// a failing one. `createSupabaseServiceClient` is the only door, so one mock covers
// both `lib/accounts/auth-admin.ts` and `lib/images/storage.ts`.
const serviceClient = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => serviceClient.current,
}))

const STAFF: Profile = { userId: ACCOUNT_ID, email: 'staff@example.test', name: 'Test', role: 'staff', disabledAt: null }

beforeAll(() => {
  const result = initMonitoring({
    settings: { dsn: DSN, environment: 'test', release: 'test-release', enabled: true },
    transport: recordingTransport,
  })
  expect(result.active).toBe(true)
})

beforeEach(() => {
  sent.length = 0
  resetOperationalStorm()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the client', () => {
  it('runs errors only: no tracing, no profiling, no Replay, no PII by default', () => {
    const options = monitoringOptions({ dsn: DSN, environment: 'production', release: 'r', enabled: true })
    expect(options.sendDefaultPii).toBe(false)
    expect('tracesSampleRate' in options).toBe(false)
    expect('tracesSampler' in options).toBe(false)
    expect('profilesSampleRate' in options).toBe(false)
    expect('enableTracing' in options).toBe(false)
    expect('replaysSessionSampleRate' in options).toBe(false)

    const client = Sentry.getClient()!
    for (const name of DROPPED_INTEGRATIONS) {
      if (name === 'RequestData' || name === 'OnUncaughtException') continue
      expect(client.getIntegrationByName(name), `${name} is not installed`).toBeUndefined()
    }
    expect(client.getIntegrationByName('RequestData')).toBeDefined()
    expect(client.getIntegrationByName('Dedupe')).toBeUndefined()
    expect(client.getIntegrationByName('Console')).toBeDefined()
    expect(client.getOptions().tracesSampleRate).toBeUndefined()
  })
})

describe('an unexpected Server Action error through the framework hook', () => {
  it('is captured once, tagged, with the route and without headers or the query', async () => {
    const outcome = reportRequestError(
      new Error(`Could not read the accounts: ${JWT}`),
      {
        path: '/admin/brugere?status=x&token_hash=secret-token',
        method: 'POST',
        headers: { cookie: 'sb-localhost-auth-token=abc', authorization: `Bearer ${JWT}` },
      },
      { routerKind: 'App Router', routePath: '/admin/brugere', routeType: 'action', revalidateReason: undefined },
    )
    expect(outcome).toBe('reported')

    const all = await flushed()
    expect(all).toHaveLength(1)
    const event = all[0]!
    const tags = event.tags as Record<string, string>
    expect(tags.component).toBe('next')
    expect(tags.operation).toBe('server-action')
    expect(tags.route).toBe('/admin/brugere')
    expect(event.release).toBe('test-release')
    expect(event.environment).toBe('test')
    // The SDK's request record carries the method alone: the hook hands it no
    // headers, no cookies and no URL, and the path lives in the framework context.
    expect(event.request).toEqual({ method: 'POST' })
    expect((event.contexts as Record<string, Record<string, unknown>>).nextjs?.request_path).toBe('/admin/brugere')
    const text = serialised(event)
    expect(text).not.toContain(JWT)
    expect(text).not.toContain('secret-token')
    expect(text).not.toContain('sb-localhost-auth-token=abc')
    expect(text).not.toContain('cookie')
    expect(event.user).toBeUndefined()
  })

  it('covers a render, a route handler and the proxy under their own operation names', async () => {
    reportRequestError(new Error('render'), { path: '/menu', method: 'GET', headers: {} }, {
      routerKind: 'App Router', routePath: '/menu', routeType: 'render', renderSource: 'react-server-components', revalidateReason: undefined,
    })
    reportRequestError(new Error('route'), { path: '/api/preview/start?maal=forside', method: 'GET', headers: {} }, {
      routerKind: 'App Router', routePath: '/api/preview/start', routeType: 'route', revalidateReason: undefined,
    })
    reportRequestError(new Error('proxy'), { path: '/admin', method: 'GET', headers: {} }, {
      routerKind: 'App Router', routePath: '/admin', routeType: 'proxy', revalidateReason: undefined,
    })
    const all = await flushed()
    const operations = all.map((event) => (event.tags as Record<string, string>).operation).sort()
    expect(operations).toEqual(['proxy', 'route-handler', 'server-render'])
    const render = all.find((event) => (event.tags as Record<string, string>).operation === 'server-render')!
    expect((render.tags as Record<string, string>).render_source).toBe('react-server-components')
  })

  it('reads a form posted without JavaScript as the action it is', async () => {
    reportRequestError(new Error('no-js action'), { path: '/admin/menu', method: 'POST', headers: {} }, {
      routerKind: 'App Router', routePath: '/(admin)/admin/menu/page', routeType: 'render', revalidateReason: undefined,
    })
    const event = (await flushed())[0]!
    expect((event.tags as Record<string, string>).operation).toBe('server-action')
    expect(event.request).toEqual({ method: 'POST' })
  })

  it('ignores the framework’s own control flow: a redirect is not an error', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/admin?status=gemt;307;' })
    expect(
      reportRequestError(redirect, { path: '/admin/menu', method: 'POST', headers: {} }, {
        routerKind: 'App Router', routePath: '/admin/menu', routeType: 'action', revalidateReason: undefined,
      }),
    ).toBe('ignored')
    const notFound = Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' })
    expect(
      reportRequestError(notFound, { path: '/nyheder/x', method: 'GET', headers: {} }, {
        routerKind: 'App Router', routePath: '/nyheder/[slug]', routeType: 'render', revalidateReason: undefined,
      }),
    ).toBe('ignored')
    expect(await flushed()).toHaveLength(0)
  })
})

describe('the limiter that cannot answer', () => {
  function failingDatabase(reason: 'error' | 'throw' | 'garbage'): SupabaseClient {
    return {
      rpc: async () => {
        if (reason === 'throw') throw new Error(`fetch failed to ${credentialUrl('https', `x:${JWT}`, 'db.supabase.test')}`)
        if (reason === 'garbage') return { data: { status: 'maybe' }, error: null }
        return { data: null, error: { message: 'connection refused', code: '08006' } }
      },
    } as unknown as SupabaseClient
  }

  it('reports the scope and the door, never a subject, and fails open as before', async () => {
    const decision = await consumeRateLimit(failingDatabase('error'), 'content:save')
    expect(decision).toEqual({ status: 'unavailable' })

    const all = await flushed()
    expect(all).toHaveLength(1)
    const event = all[0]!
    expect(event.level).toBe('warning')
    expect(event.tags).toMatchObject({ component: 'rate-limiter', operation: 'rate-limiter:unavailable', scope: 'content:save', door: 'consume_rate_limit', policy: 'allow' })
    expect(event.fingerprint).toEqual(['operational', 'rate-limiter:unavailable', 'content:save'])
    expect(event.message).toContain('connection refused')
    expect(event.user).toBeUndefined()
  })

  it('reports a fail-closed tier as an error', async () => {
    await consumeRateLimit(failingDatabase('error'), 'accounts:invite')
    const all = await flushed()
    expect(all).toHaveLength(1)
    expect(all[0]!.level).toBe('error')
    expect(all[0]!.tags).toMatchObject({ operation: 'rate-limiter:refused', scope: 'accounts:invite', policy: 'refuse' })
  })

  it('covers the sign-in reservation and the release, redacting what the error carries', async () => {
    const subject = 'a'.repeat(64)
    expect(await reserveSignInAttempt(failingDatabase('throw'), subject, subject)).toEqual({ status: 'unavailable' })
    expect(await releaseSignInAttempt(failingDatabase('error'), subject, subject)).toBe(false)
    const all = await flushed()
    expect(all.map((event) => (event.tags as Record<string, string>).operation).sort()).toEqual([
      'rate-limiter:release-failed',
      'rate-limiter:unavailable',
    ])
    for (const event of all) {
      const text = serialised(event)
      expect(text).not.toContain(JWT)
      expect(text).not.toContain(subject)
    }
  })

  it('reports an unreadable reply as unavailable too', async () => {
    expect(await consumeRateLimit(failingDatabase('garbage'), 'content:publish')).toEqual({ status: 'unavailable' })
    expect((await flushed())[0]!.message).toContain('unreadable reply')
  })

  it('sends one event per scope per window during an outage, not one per request', async () => {
    for (let i = 0; i < 50; i += 1) await consumeRateLimit(failingDatabase('error'), 'content:save')
    for (let i = 0; i < 50; i += 1) await consumeRateLimit(failingDatabase('error'), 'operation:immediate')
    const all = await flushed()
    expect(all).toHaveLength(2)
    expect(all.map((event) => (event.tags as Record<string, string>).scope).sort()).toEqual(['content:save', 'operation:immediate'])
  })

  it('reports nothing for a limited or an allowed answer', async () => {
    const answering = {
      rpc: async () => ({ data: { status: 'limited', retry_after_seconds: 30 }, error: null }),
    } as unknown as SupabaseClient
    expect(await consumeRateLimit(answering, 'content:save')).toEqual({ status: 'limited', retryAfterSeconds: 30 })
    expect(await flushed()).toHaveLength(0)
  })
})

describe('the Auth Admin boundary', () => {
  function service(overrides: {
    updateUserById?: () => Promise<{ error: unknown }>
    inviteUserByEmail?: () => Promise<{ data: { user: unknown }; error: unknown }>
    listUsers?: () => Promise<{ data: { users: unknown[] }; error: unknown }>
  }) {
    return {
      auth: {
        admin: {
          updateUserById: overrides.updateUserById ?? (async () => ({ error: null })),
          inviteUserByEmail: overrides.inviteUserByEmail ?? (async () => ({ data: { user: null }, error: null })),
          listUsers: overrides.listUsers ?? (async () => ({ data: { users: [] }, error: null })),
        },
      },
    }
  }

  const committed = {
    rpc: async () => ({ data: { status: 'updated', updated_at: '2026-09-05T10:00:00Z' }, error: null }),
  } as unknown as SupabaseClient

  it('a deactivation whose ban failed is one error naming the account, never the address or a token', async () => {
    serviceClient.current = service({
      updateUserById: async () => ({ error: { code: 'unexpected_failure', status: 500, message: `Bearer ${JWT} refused for ${EMAIL}` } }),
    })

    const result = await setAccountActive(committed, createAuthAdmin(), {
      userId: ACCOUNT_ID,
      active: false,
      expectedUpdatedAt: '2026-09-05T09:00:00Z',
    })
    expect(result).toEqual({ status: 'updated', updatedAt: '2026-09-05T10:00:00Z', authStep: 'failed' })

    const all = await flushed()
    expect(all).toHaveLength(1)
    const event = all[0]!
    expect(event.level).toBe('error')
    expect(event.tags).toMatchObject({ component: 'auth-admin', operation: 'auth-admin:ban-failed', code: 'unexpected_failure', status: 500 })
    expect((event.contexts as Record<string, Record<string, unknown>>).operation).toEqual({ account_id: ACCOUNT_ID })
    expect(event.fingerprint).toEqual(['operational', 'auth-admin:ban-failed', ACCOUNT_ID])
    const text = serialised(event)
    expect(text).not.toContain(EMAIL)
    expect(text).not.toContain(JWT)
  })

  it('two accounts left half-moved inside one minute are two events and two issues, not one (the lock pass)', async () => {
    const SECOND_ACCOUNT = '7a4b1e6c-0000-4000-8000-000000000002'
    serviceClient.current = service({
      updateUserById: async () => ({ error: { code: 'unexpected_failure', status: 500, message: 'x' } }),
    })
    for (const userId of [ACCOUNT_ID, SECOND_ACCOUNT, ACCOUNT_ID]) {
      await setAccountActive(committed, createAuthAdmin(), { userId, active: false, expectedUpdatedAt: 'v' })
    }
    const all = await flushed()
    // The third call repeats the first account inside the window: suppressed. The
    // second account is a distinct repair and is not.
    expect(all).toHaveLength(2)
    expect(all.map((event) => event.fingerprint)).toEqual([
      ['operational', 'auth-admin:ban-failed', ACCOUNT_ID],
      ['operational', 'auth-admin:ban-failed', SECOND_ACCOUNT],
    ])
  })

  it('a reactivation whose unban failed is its own operation', async () => {
    serviceClient.current = service({
      updateUserById: async () => ({ error: { code: 'unexpected_failure', status: 503, message: 'x' } }),
    })
    const result = await setAccountActive(committed, createAuthAdmin(), {
      userId: ACCOUNT_ID, active: true, expectedUpdatedAt: '2026-09-05T09:00:00Z',
    })
    expect(result.authStep).toBe('failed')
    expect(((await flushed())[0]!.tags as Record<string, string>).operation).toBe('auth-admin:unban-failed')
  })

  it('an accepted invitation whose profile failed names the account and not the invitee', async () => {
    serviceClient.current = service({
      inviteUserByEmail: async () => ({
        data: { user: { id: ACCOUNT_ID, email: EMAIL, email_confirmed_at: null } },
        error: null,
      }),
    })
    const failingProfile = {
      rpc: async () => ({ data: null, error: { code: 'XX000', message: `internal error for ${EMAIL}` } }),
    } as unknown as SupabaseClient

    const result = await inviteAccount(failingProfile, createAuthAdmin(), { email: EMAIL, name: 'Ny', role: 'staff' }, [])
    expect(result).toEqual({ status: 'profile_failed' })

    const all = await flushed()
    expect(all).toHaveLength(1)
    expect(all[0]!.tags).toMatchObject({ operation: 'accounts:profile-failed', code: 'XX000' })
    expect((all[0]!.contexts as Record<string, Record<string, unknown>>).operation).toEqual({ account_id: ACCOUNT_ID })
    expect(serialised(all[0]!)).not.toContain(EMAIL)
  })

  it('the expected answers — a duplicate address, a malformed one — report nothing', async () => {
    serviceClient.current = service({
      inviteUserByEmail: async () => ({ data: { user: null }, error: { code: 'email_exists', status: 422, message: 'exists' } }),
      listUsers: async () => ({ data: { users: [] }, error: null }),
    })
    const database = { rpc: async () => ({ data: { status: 'created' }, error: null }) } as unknown as SupabaseClient
    expect(await inviteAccount(database, createAuthAdmin(), { email: EMAIL, name: 'Ny', role: 'staff' }, [])).toEqual({ status: 'auth_failed' })

    serviceClient.current = service({
      inviteUserByEmail: async () => ({ data: { user: null }, error: { code: 'validation_failed', status: 400, message: 'bad' } }),
    })
    expect(await inviteAccount(database, createAuthAdmin(), { email: 'not-an-address', name: 'Ny', role: 'staff' }, [])).toEqual({ status: 'invalid_email' })

    // A forbidden transition is an answer for the screen, not an operator's problem.
    const forbidden = { rpc: async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) } as unknown as SupabaseClient
    const result = await setAccountActive(forbidden, createAuthAdmin(), { userId: ACCOUNT_ID, active: false, expectedUpdatedAt: 'x' })
    expect(result.status).toBe('forbidden')

    expect(await flushed()).toHaveLength(0)
  })
})

describe('the storage boundary', () => {
  function storageService(remove: () => Promise<{ error: unknown }>) {
    return {
      storage: {
        from: () => ({
          remove,
          createSignedUploadUrl: async () => ({ data: null, error: { message: `signed url failed ${JWT}` } }),
          upload: async () => ({ error: { message: 'bucket full' } }),
          download: async () => ({ data: null, error: { message: 'missing' } }),
        }),
      },
    }
  }

  it('a post-commit cleanup that fails names the bucket and the server-minted paths, never a token', async () => {
    serviceClient.current = storageService(async () => ({ error: { message: `remove refused: token=${JWT}` } }))
    const committedDelete = {
      rpc: async () => ({
        data: { status: 'deleted', references: 0, storage_path: STORAGE_PATH, affected: { live: ZERO_COUNTS, draft: ZERO_COUNTS } },
        error: null,
      }),
    } as unknown as SupabaseClient
    const expired: string[][] = []

    const result = await deleteLibraryImage(
      committedDelete,
      createImageStorage(),
      STAFF,
      { imageId: ACCOUNT_ID, expectedUpdatedAt: 'v1', confirmed: false, derivativePaths: [`${STORAGE_PATH.split('/')[0]}/960.avif`] },
      { expireTags: (tags) => { expired.push([...tags]) } },
    )
    expect(result.status).toBe('deleted')

    const all = await flushed()
    expect(all).toHaveLength(2)
    for (const event of all) {
      expect(event.level).toBe('warning')
      expect(event.tags).toMatchObject({ component: 'image-storage', operation: 'image:cleanup-failed' })
      expect(serialised(event)).not.toContain(JWT)
    }
    const contexts = all
      .map((event) => (event.contexts as Record<string, Record<string, unknown>>).operation)
      .sort((a, b) => String(a?.bucket).localeCompare(String(b?.bucket)))
    expect(contexts).toEqual([
      { bucket: 'media', paths: [`${STORAGE_PATH.split('/')[0]}/960.avif`] },
      { bucket: 'media-originals', paths: [STORAGE_PATH] },
    ])
    expect(all.map((event) => event.fingerprint).sort()).toEqual([
      ['operational', 'image:cleanup-failed', 'media'],
      ['operational', 'image:cleanup-failed', 'media-originals'],
    ])
  })

  it('a refused derivative write and a refused signed upload are errors; a user refusal is nothing', async () => {
    serviceClient.current = storageService(async () => ({ error: null }))
    const storage: ImageStorage = createImageStorage()

    expect(await storage.mintOriginalUpload(STORAGE_PATH)).toBeNull()
    expect(await storage.uploadDerivative('x/960.avif', new Uint8Array([1]), 'image/avif')).toBe(false)

    // The finalize flow over an original that is not an image: `not_an_image`,
    // the person's own refusal, and nothing for an operator.
    const database = { rpc: async () => ({ data: { status: 'created' }, error: null }) } as unknown as SupabaseClient
    const refusing: ImageStorage = {
      ...storage,
      downloadOriginal: async () => new Uint8Array([1, 2, 3, 4]),
      removeOriginal: async () => undefined,
    }
    const outcome = await finalizeImageUpload({ storage: refusing, database }, STAFF, { storagePath: STORAGE_PATH })
    expect(outcome.status).toBe('not_an_image')

    const all = await flushed()
    expect(all.map((event) => (event.tags as Record<string, string>).operation).sort()).toEqual([
      'image:derivative-write-failed',
      'image:upload-grant-failed',
    ])
    for (const event of all) expect(serialised(event)).not.toContain(JWT)
  })
})

describe('the reporter itself', () => {
  it('has a closed vocabulary with a level and a component for every entry', () => {
    for (const [name, definition] of Object.entries(OPERATIONAL_EVENTS)) {
      expect(name).toMatch(/^[a-z-]+:[a-z-]+$/)
      expect(['warning', 'error']).toContain(definition.level)
      expect(definition.summary.length).toBeGreaterThan(20)
    }
    expect(OPERATIONAL_EVENTS['rate-limiter:unavailable'].level).toBe('warning')
    expect(OPERATIONAL_EVENTS['rate-limiter:refused'].level).toBe('error')
    expect(OPERATIONAL_EVENTS['auth-admin:ban-failed'].level).toBe('error')
    expect(OPERATIONAL_EVENTS['image:cleanup-failed'].level).toBe('warning')
    expect(OPERATIONAL_EVENTS['image:create-refused'].level).toBe('error')
  })

  it('attaches a thrown error as the exception and keeps the summary', async () => {
    const outcome = reportOperationalEvent('image:create-refused', {
      error: new Error(`refused ${JWT}`),
      context: { storage_path: STORAGE_PATH },
    })
    expect(outcome).toBe('reported')
    const event = (await flushed())[0]!
    const exception = (event.exception as { values: { value: string; mechanism: { handled: boolean } }[] }).values[0]!
    expect(exception.value).toBe('refused [jwt]')
    expect(exception.mechanism.handled).toBe(true)
    expect(event.fingerprint).toEqual(['operational', 'image:create-refused'])
  })

  it('filters a sensitive key a caller might pass by mistake', async () => {
    reportOperationalEvent('auth-admin:invite-failed', {
      tags: { code: 'x' },
      context: { authorization: `Bearer ${JWT}`, account_id: ACCOUNT_ID },
    })
    const event = (await flushed())[0]!
    expect((event.contexts as Record<string, Record<string, unknown>>).operation).toEqual({ authorization: '[Filtered]', account_id: ACCOUNT_ID })
  })
})
