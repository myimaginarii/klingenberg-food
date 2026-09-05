import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuthAdmin } from '@/lib/accounts/auth-admin'
import { setAccountActive } from '@/lib/accounts/admin'
import { createImageStorage } from '@/lib/images/storage'
import { resetOperationalStorm } from '@/lib/monitoring/report'
import { reportRequestError } from '@/lib/monitoring/request-error'
import { initMonitoring } from '@/lib/monitoring/sentry'
import { consumeRateLimit } from '@/lib/rate-limit/limiter'

/**
 * The whole event, byte for byte — phase 13's lock pass (§0ak, brief §20 and §24).
 *
 * `boundary.test.ts` proves each application path over the real SDK client but has
 * to strip the stack frames before asserting "nothing forbidden anywhere", because
 * the ContextLines integration quotes the test file's own source — which spells the
 * forbidden values. Here every forbidden value is assembled at run time from
 * fragments, so no source line spells one, and the assertions run over the WHOLE
 * serialised envelope item: frames, source quotes, contexts, breadcrumbs and all.
 *
 * Two events are representative of what production could carry: a Server Action
 * error whose request, message, breadcrumbs and contexts hold every class of secret
 * this system knows (an Authorization header, the session cookie, a JWT, an e-mail
 * address, a recovery and an invitation token, the database URL, the service-role
 * key in both formats, a signed upload URL, the request query, a form body); and the
 * three operational events whose provider sentences echo credentials. The third case
 * pins what ContextLines quotes: source code, never a runtime value.
 */

function j(...parts: string[]): string {
  return parts.join('')
}

const FAKE = {
  jwt: j('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoieCJ9', '.', 'ZmFrZXNpZ25hdHVyZWZha2Vz'),
  bearer: j('Bear', 'er ', 'abcdef0123456789abcdef0123456789'),
  cookie: j('sb-localhost-auth-', 'token=', 'cookieValue1234567890'),
  email: j('ejer.k', '@', 'klingenberg-food-fixture.test'),
  resetToken: j('pkce_', 'resetTokenHash', '0123456789abcdef'),
  inviteToken: j('invite', 'Token', 'Qwerty9876543210'),
  dbUrl: j('postgres', '://', 'postgres:', 'SuperSecretDbPassw0rd', '@', 'db.projectref.supabase.test:5432/postgres'),
  serviceKey: j('sb_', 'secret_', 'N7UND0UgjKTVK-fake-service-key'),
  signedUpload: j('/storage/v1/object/upload/sign/media-originals/x/original.jpg?', 'token=', 'signedUploadTokenAbc123'),
  bodyField: j('Hemmelig', 'Formularværdi', '4711'),
  password: j('Adgangs', 'kode', 'Xyz123!'),
}

type Sent = { type: string; payload: Record<string, unknown> }
const sent: Sent[] = []

const recordingTransport: Sentry.NodeOptions['transport'] = (options) =>
  Sentry.createTransport(options, async (request) => {
    const body = typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body)
    const lines = body.split('\n').filter((line) => line.length > 0)
    for (let i = 1; i + 1 < lines.length; i += 2) {
      const header = JSON.parse(lines[i]!) as { type: string }
      const payload = JSON.parse(lines[i + 1]!) as Record<string, unknown>
      sent.push({ type: header.type, payload })
    }
    return { statusCode: 200 }
  })

async function flushed(): Promise<Record<string, unknown>[]> {
  await Sentry.flush(2_000)
  return sent.filter((item) => item.type === 'event').map((item) => item.payload)
}

/** The whole envelope item, frames and source quotes included. */
function whole(event: Record<string, unknown>): string {
  return JSON.stringify(event)
}

function expectNothingForbidden(text: string, label: string): void {
  for (const [name, value] of Object.entries(FAKE)) {
    expect(text, `${label}: ${name}`).not.toContain(value)
  }
  // The password inside the URL, on its own.
  expect(text, `${label}: db password`).not.toContain('SuperSecretDbPassw0rd')
  expect(text, `${label}: reset token`).not.toContain('resetTokenHash')
  expect(text, `${label}: signed upload token`).not.toContain('signedUploadTokenAbc123')
}

const serviceClient = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => serviceClient.current,
}))

beforeAll(() => {
  const dsn = j('https', '://', 'publickey', '@', 'o1.ingest.sentry.test/1')
  const result = initMonitoring({
    settings: { dsn, environment: 'test', release: 'lockpass', enabled: true },
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

describe('representative events carrying every class of secret', () => {
  it('a Server Action error whose request, message, breadcrumbs and extra carry them all', async () => {
    // A console breadcrumb the application might have written before the throw.
    console.error(`Saving the form failed for ${FAKE.email}: body=${FAKE.bodyField} ${FAKE.bearer}`)
    Sentry.addBreadcrumb({
      category: 'http',
      data: { url: FAKE.signedUpload, method: 'PUT', 'x-secret': FAKE.serviceKey },
    })
    // What the SDK's own request capture would hold if it were allowed to read the
    // request: the form body, the cookies, the query. `RequestData` is configured to
    // keep the method and URL only, and the sanitizer drops the rest again.
    Sentry.getIsolationScope().setSDKProcessingMetadata({
      normalizedRequest: {
        method: 'POST',
        url: `http://localhost:3100/admin/bekraeft?token_hash=${FAKE.resetToken}`,
        headers: { cookie: FAKE.cookie, authorization: FAKE.bearer },
        cookies: { 'sb-localhost-auth-token': 'cookieValue1234567890' },
        query_string: `token_hash=${FAKE.resetToken}`,
        data: `navn=Ret&beskrivelse=${FAKE.bodyField}&adgangskode=${FAKE.password}`,
      },
    })
    Sentry.getCurrentScope().setExtra('form', { navn: 'Ret', adgangskode: FAKE.password })
    Sentry.getCurrentScope().setContext('debug', {
      database_url: FAKE.dbUrl,
      service_role_key: FAKE.serviceKey,
      plain: `connection ${FAKE.dbUrl} refused`,
    })

    const error = new Error(
      `Could not save: ${FAKE.dbUrl} — auth ${FAKE.jwt} — key ${FAKE.serviceKey} — ${FAKE.email} — ${FAKE.signedUpload}`,
    )
    const outcome = reportRequestError(
      error,
      {
        path: `/admin/bekraeft?token_hash=${FAKE.resetToken}&token=${FAKE.inviteToken}&type=recovery`,
        method: 'POST',
        headers: {
          authorization: FAKE.bearer,
          cookie: FAKE.cookie,
          'x-forwarded-for': '203.0.113.7',
          'content-type': 'application/x-www-form-urlencoded',
        },
      },
      { routerKind: 'App Router', routePath: '/admin/bekraeft', routeType: 'action', revalidateReason: undefined },
    )
    expect(outcome).toBe('reported')

    const all = await flushed()
    expect(all).toHaveLength(1)
    const event = all[0]!
    const text = whole(event)
    expectNothingForbidden(text, 'action event')
    // The SDK's request record: method and the URL without its query, nothing else.
    expect(event.request).toEqual({ method: 'POST', url: 'http://localhost:3100/admin/bekraeft' })
    expect(text).not.toContain('203.0.113.7')
    expect(text).not.toContain('x-forwarded-for')
    expect(event.user).toBeUndefined()
    expect(event.server_name).toBeUndefined()
    // What must survive: the route, the operation, the release, a redacted message.
    expect((event.tags as Record<string, string>).route).toBe('/admin/bekraeft')
    expect((event.tags as Record<string, string>).operation).toBe('server-action')
    expect(event.release).toBe('lockpass')
    const value = (event.exception as { values: { value: string }[] }).values[0]!.value
    expect(value).toContain('[credentials]@')
    expect(value).toContain('[jwt]')
    expect(value).toContain('[email]')
    expect(value).toContain('token=[redacted]')
    Sentry.getCurrentScope().clear()
    Sentry.getIsolationScope().clear()
  })

  it('operational events whose provider sentences carry credentials', async () => {
    // The limiter: a database sentence with the connection string in it.
    const failing = {
      rpc: async () => ({ data: null, error: { message: `connection to ${FAKE.dbUrl} failed (${FAKE.jwt})` } }),
    } as unknown as SupabaseClient
    await consumeRateLimit(failing, 'content:save')

    // The storage boundary: a signed URL and a service key in the storage error.
    serviceClient.current = {
      storage: {
        from: () => ({
          remove: async () => ({ error: { message: `refused ${FAKE.signedUpload} with ${FAKE.serviceKey}` } }),
        }),
      },
    }
    await createImageStorage().removeOriginal('0b8f6c2e-1111-4222-8333-444455556666/original.jpg')

    // The Auth Admin boundary: an address and a bearer value echoed by the Auth server.
    serviceClient.current = {
      auth: {
        admin: {
          updateUserById: async () => ({
            error: { code: 'unexpected_failure', status: 500, message: `${FAKE.bearer} refused for ${FAKE.email} at /admin/bekraeft?token=${FAKE.inviteToken}` },
          }),
        },
      },
    }
    const committed = {
      rpc: async () => ({ data: { status: 'updated', updated_at: '2026-09-05T10:00:00Z' }, error: null }),
    } as unknown as SupabaseClient
    await setAccountActive(committed, createAuthAdmin(), {
      userId: '7a4b1e6c-0000-4000-8000-000000000001',
      active: false,
      expectedUpdatedAt: 'v',
    })

    const all = await flushed()
    expect(all.map((event) => (event.tags as Record<string, string>).operation).sort()).toEqual([
      'auth-admin:ban-failed',
      'image:cleanup-failed',
      'rate-limiter:unavailable',
    ])
    for (const event of all) {
      expectNothingForbidden(whole(event), String((event.tags as Record<string, string>).operation))
      expect(event.user).toBeUndefined()
    }
    // The repair identifiers survive: scope, bucket and path, account UUID.
    const byOp = Object.fromEntries(all.map((event) => [(event.tags as Record<string, string>).operation, event]))
    expect((byOp['rate-limiter:unavailable']!.tags as Record<string, string>).scope).toBe('content:save')
    expect((byOp['image:cleanup-failed']!.contexts as Record<string, Record<string, unknown>>).operation).toEqual({
      bucket: 'media-originals',
      paths: ['0b8f6c2e-1111-4222-8333-444455556666/original.jpg'],
    })
    expect((byOp['auth-admin:ban-failed']!.contexts as Record<string, Record<string, unknown>>).operation).toEqual({
      account_id: '7a4b1e6c-0000-4000-8000-000000000001',
    })
  })
})

describe('what ContextLines puts in a frame', () => {
  it('quotes source lines only: code, never a runtime value', async () => {
    const runtimeOnly = j('runtime', 'Secret', 'Value', String(Date.now()))
    function throwing(secret: string): never {
      throw new Error(`failed with ${secret.length} characters`)
    }
    try {
      throwing(runtimeOnly)
    } catch (error) {
      reportRequestError(error, { path: '/menu', method: 'GET', headers: {} }, {
        routerKind: 'App Router', routePath: '/menu', routeType: 'render', revalidateReason: undefined,
      })
    }
    const event = (await flushed())[0]!
    const frames = (event.exception as { values: { stacktrace?: { frames?: Record<string, unknown>[] } }[] }).values[0]!
      .stacktrace!.frames!
    const withContext = frames.filter((frame) => typeof frame.context_line === 'string')
    expect(withContext.length).toBeGreaterThan(0)
    const quoted = withContext
      .flatMap((frame) => [
        ...((frame.pre_context as string[] | undefined) ?? []),
        frame.context_line as string,
        ...((frame.post_context as string[] | undefined) ?? []),
      ])
      .join('\n')
    // The quoted lines are this file's source: they contain the identifier, never the value.
    expect(quoted).toContain('throwing(runtimeOnly)')
    expect(quoted).not.toContain(runtimeOnly)
    expect(whole(event)).not.toContain(runtimeOnly)
    const sample = withContext[withContext.length - 1]!
    // A frame carries the position, the quoted lines and nothing about the process.
    expect(Object.keys(sample).sort()).toEqual([
      'colno', 'context_line', 'filename', 'function', 'in_app', 'lineno', 'module', 'post_context', 'pre_context',
    ])
    // No local variable values travel (LocalVariablesAsync is not installed).
    expect(frames.some((frame) => frame.vars !== undefined)).toBe(false)
  })
})
