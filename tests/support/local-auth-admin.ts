import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Test-only Auth cleanup against the LOCAL stack — phase 11C (brief §30, §33).
 *
 * The user-administration suites create real Auth identities (the invitee), and
 * unlike a content row a leftover Auth user makes every later run and every local
 * sign-in confusing. The application never deletes an identity ("deactivate, never
 * delete", §5), so the suites need a door the application does not have: this one.
 *
 * It is a test file, run by Vitest or Playwright in Node, never part of any bundle.
 * It reads the service-role key from `.env.local` the way `scripts/seed-local-users.mjs`
 * does — and for the same reason: it cannot import `lib/env/server.ts`, which imports
 * `server-only` — and it refuses to run against anything but a loopback Supabase, so
 * it can never delete a real account. `scripts/check-source-policy.mjs` names it as
 * the second deliberate exception to the secret rule, beside the seed script.
 *
 * Every helper only ever touches identities under the reserved `.test` TLD, which
 * cannot be a real mailbox (RFC 2606). Nothing here is reachable from the app.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function loadLocalEnv(): void {
  const envFile = resolve(process.cwd(), '.env.local')
  if (!existsSync(envFile)) return

  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]!] === undefined) {
      process.env[match[1]!] = match[2]!
    }
  }
}

function requireLocal(url: string): void {
  const host = new URL(url).hostname
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Refusing to touch Auth identities on "${host}": tests only ever clean a loopback Supabase.`)
  }
}

/** The one service-role client the tests hold — never exported, never returned. */
function serviceClient(): SupabaseClient {
  loadLocalEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('The account suites need the local Supabase URL and service-role key (.env.local).')
  }
  requireLocal(url)

  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function assertTestAddress(email: string): void {
  if (!email.toLowerCase().endsWith('@example.test')) {
    throw new Error(`Refusing to touch "${email}": test identities live under @example.test only.`)
  }
}

export type LocalAuthUser = {
  readonly id: string
  readonly email: string
  readonly emailConfirmedAt: string | null
  readonly bannedUntil: string | null
}

/** The Auth identity holding a `.test` address, if any. */
export async function findLocalAuthUser(email: string): Promise<LocalAuthUser | null> {
  assertTestAddress(email)
  const service = serviceClient()
  const target = email.toLowerCase()

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`Could not list identities: ${error.message}`)

    const match = data.users.find((user) => user.email?.toLowerCase() === target)
    if (match) {
      const banned = (match as { banned_until?: string | null }).banned_until ?? null
      return {
        id: match.id,
        email: target,
        emailConfirmedAt: match.email_confirmed_at ?? null,
        bannedUntil: banned,
      }
    }
    if (data.users.length < 200) return null
  }

  return null
}

/**
 * Remove a test identity and everything that cascades from it (its profile). The
 * seeded owner and staff are never deleted: the two seeded addresses are refused.
 */
export async function deleteLocalAuthUser(email: string): Promise<void> {
  assertTestAddress(email)
  if (email === 'owner@example.test' || email === 'staff@example.test') {
    throw new Error(`Refusing to delete the seeded identity ${email}.`)
  }

  const user = await findLocalAuthUser(email)
  if (user === null) return

  const { error } = await serviceClient().auth.admin.deleteUser(user.id)
  if (error) throw new Error(`Could not delete ${email}: ${error.message}`)
}

/** Mark a `.test` identity confirmed, as accepting its invitation would. */
export async function confirmLocalAuthUser(email: string): Promise<void> {
  const user = await findLocalAuthUser(email)
  if (user === null) throw new Error(`${email} does not exist.`)

  const { error } = await serviceClient().auth.admin.updateUserById(user.id, { email_confirm: true })
  if (error) throw new Error(`Could not confirm ${email}: ${error.message}`)
}

/**
 * The seeded identities exactly as `npm run db:users` leaves them: the two
 * profiles, their roles, active. Restored by the same upsert the script performs,
 * so a suite that promoted or deactivated one of them leaves nothing behind.
 */
export async function restoreSeededIdentities(): Promise<void> {
  const service = serviceClient()

  const seeded = [
    { email: 'owner@example.test', name: 'Lokal Ejer', role: 'owner' },
    { email: 'staff@example.test', name: 'Lokal Medarbejder', role: 'staff' },
  ]

  for (const identity of seeded) {
    const user = await findLocalAuthUser(identity.email)
    if (user === null) throw new Error(`${identity.email} is missing — run \`npm run db:users\`.`)

    const { error: unban } = await service.auth.admin.updateUserById(user.id, { ban_duration: 'none' })
    if (unban) throw new Error(`Could not unban ${identity.email}: ${unban.message}`)

    const { error } = await service
      .from('profiles')
      .upsert(
        { user_id: user.id, name: identity.name, role: identity.role, disabled_at: null },
        { onConflict: 'user_id' },
      )
    if (error) throw new Error(`Could not restore the profile of ${identity.email}: ${error.message}`)
  }
}

export type LocalProfile = {
  readonly userId: string
  readonly name: string
  readonly role: string
  readonly disabledAt: string | null
}

/** Every profile row, as the service role reads them — for "nothing left behind" assertions. */
export async function listLocalProfiles(): Promise<LocalProfile[]> {
  const { data, error } = await serviceClient()
    .from('profiles')
    .select('user_id, name, role, disabled_at')
    .order('name')
  if (error) throw new Error(`Could not list profiles: ${error.message}`)

  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    name: row.name as string,
    role: row.role as string,
    disabledAt: (row.disabled_at as string | null) ?? null,
  }))
}

/** Account audit rows for one identity, as the service role reads them. */
export async function listLocalAccountAudit(userId: string): Promise<{ action: string; actorId: string | null }[]> {
  const { data, error } = await serviceClient()
    .from('audit_log')
    .select('action, actor_id')
    .eq('entity', 'profile')
    .eq('entity_id', userId)
    .order('created_at')
  if (error) throw new Error(`Could not read the audit log: ${error.message}`)

  return (data ?? []).map((row) => ({ action: row.action as string, actorId: (row.actor_id as string | null) ?? null }))
}

// ---------------------------------------------------------------------------
// The local mail catcher (Mailpit, port 54324) — where every invitation lands
// ---------------------------------------------------------------------------

const MAILPIT = 'http://127.0.0.1:54324'

export type CaughtMail = { readonly id: string; readonly subject: string; readonly html: string }

/** The messages sent to one `.test` address, newest first. */
export async function caughtMailFor(email: string): Promise<CaughtMail[]> {
  assertTestAddress(email)

  const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
  if (!search.ok) throw new Error(`The mail catcher answered ${search.status}.`)
  const list = (await search.json()) as { messages?: { ID: string; Subject: string }[] }

  const messages: CaughtMail[] = []
  for (const message of list.messages ?? []) {
    const detail = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)
    if (!detail.ok) throw new Error(`The mail catcher answered ${detail.status} for a message.`)
    const body = (await detail.json()) as { HTML?: string; Text?: string }
    messages.push({ id: message.ID, subject: message.Subject, html: body.HTML ?? body.Text ?? '' })
  }

  return messages
}

/** The `token_hash` and `type` of the one-time link in an invitation e-mail. */
export function inviteLinkOf(mail: CaughtMail): { tokenHash: string; type: string } | null {
  const match = /\/admin\/bekraeft\?token_hash=([^&"'\s]+)&(?:amp;)?type=([a-z]+)/.exec(mail.html)
  if (match === null) return null
  return { tokenHash: match[1]!, type: match[2]! }
}

// ---------------------------------------------------------------------------
// The rate-limit counters — phase 13B
// ---------------------------------------------------------------------------
//
// The application has no door that lowers a counter, by design (migration
// `20260905120000`). The suites need one for the same reason they need the Auth
// cleanup above: a story that proves the refusal leaves a full bucket behind, and
// a bucket left behind would refuse the next run for up to a window. So, loopback
// only and service role only, the tests may empty the table — and may FILL one
// bucket, so a UI story can meet the refusal without hundreds of requests.

export type LocalRateLimitBucket = {
  readonly scope: string
  readonly subject: string
  readonly windowStart: string
  readonly hits: number
}

/** Every counter, gone. Nothing else is touched. */
export async function clearLocalRateLimits(): Promise<void> {
  const service = serviceClient()
  const { error } = await service.from('rate_limit_buckets').delete().neq('hits', -1)
  if (error) throw new Error(`Could not clear the local rate-limit buckets: ${error.message}`)
}

/**
 * Put `hits` into the CURRENT window of one scope for one subject — an actor's uuid
 * for an actor-keyed scope. The window is computed the way the function computes
 * it: the epoch-aligned floor of now over the scope's window length.
 */
export async function fillLocalRateLimit(scope: string, subject: string, hits: number): Promise<void> {
  const service = serviceClient()

  const rule = await service
    .from('rate_limit_scopes')
    .select('window_seconds')
    .eq('scope', scope)
    .maybeSingle<{ window_seconds: number }>()
  if (rule.error || rule.data === null) {
    throw new Error(`Unknown rate-limit scope "${scope}": ${rule.error?.message ?? 'no such row'}`)
  }

  const seconds = rule.data.window_seconds
  const windowStart = new Date(Math.floor(Date.now() / 1000 / seconds) * seconds * 1000).toISOString()

  const { error } = await service
    .from('rate_limit_buckets')
    .upsert({ scope, subject, window_start: windowStart, hits }, { onConflict: 'scope,subject,window_start' })
  if (error) throw new Error(`Could not fill the local rate-limit bucket: ${error.message}`)
}

/** What the table holds — for asserting privacy: no address, no e-mail, ever. */
export async function listLocalRateLimitBuckets(): Promise<LocalRateLimitBucket[]> {
  const service = serviceClient()
  const { data, error } = await service
    .from('rate_limit_buckets')
    .select('scope, subject, window_start, hits')
  if (error) throw new Error(`Could not read the local rate-limit buckets: ${error.message}`)

  return (data as { scope: string; subject: string; window_start: string; hits: number }[]).map((row) => ({
    scope: row.scope,
    subject: row.subject,
    windowStart: row.window_start,
    hits: row.hits,
  }))
}
