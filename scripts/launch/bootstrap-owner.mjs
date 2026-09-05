#!/usr/bin/env node
/**
 * The one-time production Owner bootstrap — technical plan §5 ("Accounts",
 * decision 11), §8, §10c; phase 14A.
 *
 *   BOOTSTRAP_CONFIRM_HOST=<ref>.supabase.co \
 *     node scripts/launch/bootstrap-owner.mjs --email <owner's address> --name "<owner's name>" [--dry-run]
 *
 * with the project's API URL and its service-role key in the environment under
 * the two names `scripts/backup/lib/env.mjs` gives them — the same two the
 * application and the backup tooling read; `.env.example` and
 * `docs/runbooks/owner-handover.md` spell them out.
 *
 * ITS ONLY JOB is to put the FIRST Owner into an application that has none:
 * the Auth invitation (the person receives the Danish invitation e-mail through
 * the project's SMTP and chooses their own password on `/admin/ny-adgangskode`),
 * then the profile — `role = 'owner'`, active — behind the identity the Auth
 * server returned. That is the phase-11 invitation model exactly (§0ab), applied
 * once from a terminal because the screen that normally performs it,
 * `/admin/brugere`, needs an Owner to open it. It replaces the older §5 wording
 * (a random password plus a reset e-mail): no password is generated, printed,
 * sent or known to anyone but the Owner.
 *
 * It is NOT a user-management CLI: it never changes a role, never reactivates,
 * never promotes, never deletes an identity, and refuses the moment any Owner
 * profile exists — active or disabled. From then on the administration owns
 * every account (lib/accounts/admin.ts) and this command is inert.
 *
 * WHAT IT MAY WRITE, AND THROUGH WHICH DOOR. The service role, over the Auth
 * Admin API for the invitation and over PostgREST for ONE insert into
 * `public.profiles` — the same trusted path `scripts/seed-local-users.mjs` has
 * used since phase 1 (§8 names "the one-time production owner bootstrap" as the
 * fourth and last legitimate holder of the key), narrowed to an INSERT: an
 * existing row is never updated. The application's own transition,
 * `create_account_profile()`, cannot serve here because it requires an active
 * Owner as the caller. One audit row (`bootstrap`, entity `profile`, no actor)
 * records what happened, best-effort.
 *
 * TARGET SAFETY (lib/target.mjs): a hosted project only, confirmed by naming its
 * project host in BOOTSTRAP_CONFIRM_HOST; the local stack refused; an Owner
 * address under a reserved domain refused; a directory holding `@example.test`
 * identities refused as a development stack. `--local-harness` is how the tests
 * run the same code against the local stack — loopback only, `@example.test`
 * only — and it opens no path to a hosted project.
 *
 * PARTIAL STATES (lib/owner-state.mjs): a first run that sent the invitation and
 * then failed to write the profile is repaired by the same command with the same
 * address — the invitation re-sent to an unconfirmed identity, or the profile
 * attached to a confirmed one without a new e-mail. Ambiguous states refuse.
 *
 * Nothing printed is a secret: the target host and ref, what was sent, what was
 * created, and the next step. The service-role key is on the logger's redaction
 * list; no token, link or password exists to print.
 */

import { parseArgs } from 'node:util'

import { createClient } from '@supabase/supabase-js'

import { NAMES, readApiProject, readOptions, secretValues } from '../backup/lib/env.mjs'
import { createLogger } from '../backup/lib/run.mjs'
import { classifyOwnerState } from './lib/owner-state.mjs'
import { HARNESS_FLAG, assessLaunchTarget, assessOwnerEmail, isTestIdentityAddress } from './lib/target.mjs'

const NAME_MAX = 120
const PAGE_SIZE = 200
const MAX_PAGES = 20

function usage() {
  console.error(
    `usage: node scripts/launch/bootstrap-owner.mjs --email <address> --name <name> [--dry-run] [${HARNESS_FLAG}]`,
  )
  process.exit(2)
}

/** @param {string} message @returns {never} */
function refuse(message) {
  console.error(`bootstrap-owner: refused — ${message}`)
  process.exit(1)
}

/**
 * Every identity, paged; the one holding the Owner's address, and how many are
 * repository fixtures. The Auth server enforces one identity per address.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} email
 */
async function readIdentities(admin, email) {
  let identity = null
  let testIdentities = 0
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
    if (error) throw new Error(`Listing identities failed: ${error.code ?? 'unknown'} (${error.status ?? '?'})`)
    for (const user of data.users) {
      const address = (user.email ?? '').toLowerCase()
      if (isTestIdentityAddress(address)) testIdentities += 1
      if (address === email) {
        identity = {
          userId: user.id,
          email: address,
          emailConfirmedAt: user.email_confirmed_at ?? null,
          bannedUntil: /** @type {{ banned_until?: string | null }} */ (user).banned_until ?? null,
        }
      }
    }
    if (data.users.length < PAGE_SIZE) break
  }
  return { identity, testIdentities }
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'local-harness': { type: 'boolean', default: false },
    },
    strict: true,
  })
  const harness = values['local-harness']
  if (!values.email || !values.name) usage()

  const logger = createLogger({ secrets: secretValues(process.env) })
  const project = readApiProject(process.env)
  const options = readOptions(process.env)

  // --- 1. The target and the address ---------------------------------------------
  const target = assessLaunchTarget({
    kind: 'api',
    url: project.apiUrl,
    confirmHost: options.bootstrapConfirmHost,
    confirmName: NAMES.bootstrapConfirmHost,
    harness,
    operation: 'Owner bootstrap',
  })
  logger.info(`target: ${target.description}${target.projectRef ? ` (project ${target.projectRef})` : ''}${harness ? ' — local harness' : ''}`)
  if (!target.ok) refuse(target.reasons.join(' '))

  const owner = assessOwnerEmail(values.email, { harness })
  if (!owner.ok) refuse(owner.reasons.join(' '))
  const name = /** @type {string} */ (values.name).trim()
  if (name.length < 1 || name.length > NAME_MAX) refuse(`the Owner's name must be 1–${NAME_MAX} characters.`)

  // --- 2. What exists ------------------------------------------------------------
  const admin = createClient(project.apiUrl, project.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  const { data: profileRows, error: profilesError } = await admin.from('profiles').select('user_id, role, disabled_at')
  if (profilesError) refuse(`the profiles could not be read: ${profilesError.code ?? 'unknown'} ${profilesError.message}`)
  const profiles = (profileRows ?? []).map((row) => ({
    userId: /** @type {string} */ (row.user_id),
    role: /** @type {string} */ (row.role),
    disabledAt: /** @type {string | null} */ (row.disabled_at ?? null),
  }))

  const { identity, testIdentities } = await readIdentities(admin, owner.email)
  const decision = classifyOwnerState({ profiles, identity, testIdentities, harness })
  logger.info(`state ${decision.state}: ${decision.summary}`)
  if (decision.action === 'refuse') refuse(decision.summary + '.')

  if (values['dry-run']) {
    logger.info(
      `dry run — would ${decision.action === 'attach' ? 'send nothing' : 'send the invitation'} to ${owner.email} ` +
        `and create the Owner profile "${name}"; nothing was changed`,
    )
    return
  }

  // --- 3. The invitation ---------------------------------------------------------
  let userId = identity?.userId ?? null
  let invitation = 'none (the identity is already confirmed; the person signs in with the password they chose)'

  if (decision.action === 'invite' || decision.action === 'reinvite') {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(owner.email, { data: { name } })
    if (error) {
      refuse(
        `the Auth server did not accept the invitation: ${error.code ?? 'unknown'} (${error.status ?? '?'}). ` +
          'Nothing was created. Check the project’s SMTP configuration (docs/runbooks/pre-launch-checklist.md S5) and run again.',
      )
    }
    if (!data.user?.id) refuse('the Auth server answered without an identity. Nothing was created; run again.')
    userId = data.user.id
    invitation = decision.action === 'reinvite' ? `re-sent to ${owner.email}` : `sent to ${owner.email}`
  }
  logger.info(`invitation: ${invitation}`)
  if (userId === null) refuse('no identity to attach the profile to. Nothing was changed; run again.')

  // --- 4. The profile — one INSERT, never an update -------------------------------
  const { error: profileError } = await admin.from('profiles').insert({ user_id: userId, name, role: 'owner' })
  if (profileError) {
    refuse(
      `the invitation was accepted by the Auth server but the profile could not be written ` +
        `(${profileError.code ?? 'unknown'}: ${profileError.message}). The identity exists; run this same command ` +
        'again with the same address to repair it — the profile is created without a second invitation once the person has accepted.',
    )
  }
  logger.info('profile: created (role owner, active)')

  const { error: auditError } = await admin.from('audit_log').insert({
    actor_id: null,
    action: 'bootstrap',
    entity: 'profile',
    entity_id: userId,
    before: null,
    after: { name, role: 'owner', disabled_at: null, invitation: decision.action },
  })
  if (auditError) logger.warn(`the audit row could not be written (${auditError.code ?? 'unknown'}); the Owner exists regardless`)

  // --- 5. What happens next -------------------------------------------------------
  logger.info(`bootstrap complete for project ${target.projectRef ?? target.host}`)
  logger.info(
    decision.action === 'attach'
      ? 'next: the Owner signs in at /admin/login with the password they already chose (or uses Glemt adgangskode)'
      : 'next: the Owner opens the invitation e-mail, chooses a password, and signs in at /admin — then creates Staff at /admin/brugere',
  )
  logger.info('this command is now inert: an Owner exists, and /admin/brugere owns every account from here')
}

main().catch((error) => {
  console.error(`bootstrap-owner: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
