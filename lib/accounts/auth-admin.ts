import 'server-only'

import { reportOperationalEvent } from '@/lib/monitoring/report'
import { createSupabaseServiceClient } from '@/lib/supabase/service'

/**
 * The Auth Admin boundary — technical plan §5 ("Accounts", decision 11), §8
 * ("Service-role key reaches the browser"), §10c; phase 11C.
 *
 * Supabase Auth owns the identity: the e-mail, the password hash, the confirmation
 * state, and the ban that makes the Auth server refuse a person's tokens. None of
 * that can be written through the request-scoped client, because `authenticated`
 * holds no privilege on `auth.users` — it is written through the Auth Admin API,
 * which needs the service role. This module is the **second** runtime caller of
 * `createSupabaseServiceClient()` in the whole project (the first is the image
 * storage boundary, §0t), and `tests/unit/policy/images-boundary.test.ts` pins that
 * the list is exactly those two.
 *
 * THE CLIENT NEVER LEAVES THIS FILE. `createAuthAdmin()` returns three narrow
 * capabilities — invite, look up by e-mail, ban / unban — and nothing that could
 * reach `auth.admin` in general: no delete, no password, no metadata editor, no
 * session listing, no generic query. A Server Action asks for the capability it
 * needs, after `requireOwner()`, and the browser never sees any of it: this module
 * imports `server-only`, so a Client Component that reached it would fail the
 * build; the Server Actions that call it return only a status code.
 *
 * WHAT "INVITED" MEANS. `inviteUserByEmail` creates the Auth identity and hands the
 * invitation e-mail to the Auth server's mailer in one operation (locally, the CLI's
 * mail catcher on port 54324; in production, the project's custom SMTP — §10c, a
 * launch prerequisite). `invited` therefore means the Auth server *accepted the
 * delivery* — not that the person received it — and a failure to send is a failure
 * of the whole operation, never a silently created identity. Measured on the local
 * stack (2026-09-03): an unconfirmed existing identity is re-sent the invitation
 * under the same id; a confirmed one answers `email_exists`; a malformed address
 * answers `validation_failed`.
 *
 * WHAT A BAN MEANS — AND WHAT IT DOES NOT. `ban_duration` sets `banned_until` on
 * the identity. Measured on the same stack: the Auth server then refuses the person's
 * *already-issued* access token at `/user` (`user_banned`, 403) — which is what every
 * admin request checks through `getUser()` — refuses a refresh while banned, and
 * refuses a new sign-in. But a ban only HOLDS a session: a refresh token that was
 * never presented while banned resumes the session the moment the ban is lifted,
 * and the Auth Admin API of this version (GoTrue v2.196) has no route that ends
 * another person's sessions. Ending them is therefore the database transition's
 * job — `set_account_active()` removes the person's `auth.sessions` rows in the
 * same transaction as `disabled_at` — and the ban is the second lock on the same
 * door: it is what refuses the access token that is still in flight, and the
 * sign-in. The database refusal is independent and immediate regardless:
 * `is_staff()` reads `profiles.disabled_at` (§5).
 *
 * No password is ever generated, shown or sent by this module. The person chooses
 * their own on `/admin/ny-adgangskode` after the invitation link establishes a
 * session through `/admin/bekraeft` (phase 1's route, which already accepts
 * `type=invite`).
 *
 * WHAT AN OPERATOR HEARS (phase 13C). The three failures this module already
 * logs are the ones a person cannot repair from the screen: an invitation the
 * Auth server refused for a technical reason, a directory it could not list, and
 * — the partial outcome that matters — a ban or unban that failed after the
 * database transition committed. Each becomes one operational event
 * (`lib/monitoring/report.ts`) carrying the Auth server's error code and status
 * and, for the ban, the account's UUID so the Owner can be told which account to
 * deactivate again. Never the address, never a token. `email_exists` and
 * `validation_failed` are answers, not failures, and are not reported.
 */

export type AuthIdentity = {
  readonly userId: string
  readonly email: string
  /** Null until the person has accepted the invitation (or was created confirmed). */
  readonly emailConfirmedAt: string | null
}

export type InviteOutcome =
  /** The Auth server created (or re-used an unconfirmed) identity and accepted the e-mail. */
  | { readonly status: 'invited'; readonly identity: AuthIdentity }
  /** A confirmed identity already holds this address; nothing was sent. */
  | { readonly status: 'email_exists' }
  /** The Auth server refused the address as malformed. */
  | { readonly status: 'invalid_email' }
  /** Anything else — the operation did not happen. */
  | { readonly status: 'failed' }

export type AuthAdmin = {
  /** Create the identity and send the invitation, in one operation. */
  inviteByEmail(email: string, name: string): Promise<InviteOutcome>
  /** The identity holding an address, if any — for the `email_exists` repair path. */
  findByEmail(email: string): Promise<AuthIdentity | null>
  /** Ban (refuse every token and sign-in) or unban one identity. */
  setBanned(userId: string, banned: boolean): Promise<'done' | 'failed'>
}

/** Effectively permanent: the Auth server's own documented "forever" example. */
const BAN_FOREVER = '876000h'

/** A `listUsers` page. Two seeded identities and a restaurant's staff fit in one. */
const PAGE_SIZE = 200
const MAX_PAGES = 20

type AdminUserLike = {
  id: string
  email?: string
  email_confirmed_at?: string | null
}

function identityOf(user: AdminUserLike): AuthIdentity {
  return {
    userId: user.id,
    email: (user.email ?? '').toLowerCase(),
    emailConfirmedAt: user.email_confirmed_at ?? null,
  }
}

/**
 * The three capabilities over a fresh service client. Nothing about the client is
 * returned; nothing about a failure but its kind is returned either — the Auth
 * server's own message is logged server-side and never shown to a person, so the
 * form cannot become an oracle for which addresses exist beyond what the
 * directory already tells the Owner (§8).
 */
export function createAuthAdmin(): AuthAdmin {
  const service = createSupabaseServiceClient()

  return {
    async inviteByEmail(email, name) {
      const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
        data: { name },
      })

      if (error) {
        if (error.code === 'email_exists') return { status: 'email_exists' }
        if (error.code === 'validation_failed') return { status: 'invalid_email' }
        console.error(`Inviting an account failed: ${error.code ?? 'unknown'} (${error.status ?? '?'})`)
        reportOperationalEvent('auth-admin:invite-failed', {
          detail: error.message,
          tags: { code: error.code ?? 'unknown', status: error.status ?? 0 },
        })
        return { status: 'failed' }
      }

      if (!data.user) return { status: 'failed' }

      return { status: 'invited', identity: identityOf(data.user) }
    },

    async findByEmail(email) {
      const target = email.toLowerCase()

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { data, error } = await service.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
        if (error) {
          console.error(`Listing identities failed: ${error.code ?? 'unknown'}`)
          reportOperationalEvent('auth-admin:lookup-failed', {
            detail: error.message,
            tags: { code: error.code ?? 'unknown', status: error.status ?? 0 },
          })
          return null
        }

        const match = data.users.find((user) => user.email?.toLowerCase() === target)
        if (match) return identityOf(match)
        if (data.users.length < PAGE_SIZE) return null
      }

      return null
    },

    async setBanned(userId, banned) {
      const { error } = await service.auth.admin.updateUserById(userId, {
        ban_duration: banned ? BAN_FOREVER : 'none',
      })

      if (error) {
        console.error(
          `${banned ? 'Banning' : 'Unbanning'} an identity failed: ${error.code ?? 'unknown'} (${error.status ?? '?'})`,
        )
        // The database transition has already committed when this runs (see
        // `./admin.ts`): the account is deactivated (or reactivated) there and not
        // at the Auth server. That is the partial state the operator must hear about.
        // Grouped per account (the phase-13 lock pass): two accounts left half-moved
        // inside one minute are two repairs, and the storm boundary must not fold
        // the second into the first.
        reportOperationalEvent(banned ? 'auth-admin:ban-failed' : 'auth-admin:unban-failed', {
          detail: error.message,
          tags: { code: error.code ?? 'unknown', status: error.status ?? 0 },
          context: { account_id: userId },
          groupBy: userId,
        })
        return 'failed'
      }

      return 'done'
    },
  }
}
