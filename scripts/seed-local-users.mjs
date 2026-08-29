#!/usr/bin/env node
/**
 * Local development identities — technical plan §5, §10a.
 *
 * Creates the two throwaway accounts a developer needs to exercise the admin:
 *
 *     owner@example.test   role 'owner'
 *     staff@example.test   role 'staff'
 *
 * WHY THIS IS A SCRIPT AND NOT `seed.sql`
 *
 * Supabase Auth owns `auth.users`, `auth.identities` and the password hash. Writing
 * those rows by hand is undocumented internal manipulation: it works until a CLI
 * upgrade changes a column, and it produces users that behave subtly differently from
 * real ones (no identity row, so password reset misbehaves). The supported route is the
 * admin API — `auth.admin.createUser` — which is what this script uses. The application
 * profile row is then written through the same service-role client.
 *
 * SAFETY
 *
 * The script refuses to run against anything that is not a local Supabase. Two
 * independent guards must both pass: the API URL must be a loopback host, and
 * `--allow-remote` is not offered as an escape hatch. `.test` is a reserved TLD
 * (RFC 2606) and can never be a real mailbox.
 *
 * It is idempotent: an existing user is updated to the expected role and re-enabled
 * rather than duplicated, so it is safe to re-run after `npm run db:reset`.
 *
 * This script never creates a real restaurant account. The one-time production owner
 * bootstrap described in §5 is a separate, later piece of work.
 */

import { createClient } from '@supabase/supabase-js'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Throwaway local passwords. They satisfy supabase/config.toml's local policy
 * (minimum 12 characters, lower + upper + digits) and are deliberately printed at the
 * end of the run — there is nothing here to protect. A real account never gets a
 * password from this repository.
 */
const USERS = [
  {
    email: 'owner@example.test',
    password: 'LocalOwner12345',
    name: 'Lokal Ejer',
    role: 'owner',
  },
  {
    email: 'staff@example.test',
    password: 'LocalStaff12345',
    name: 'Lokal Medarbejder',
    role: 'staff',
  },
]

function fail(message) {
  console.error(`seed-local-users: ${message}`)
  process.exit(1)
}

function requireLocal(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    fail(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL.`)
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    fail(
      `refusing to run against "${parsed.host}". This script only ever targets a local ` +
        'Supabase. Real accounts are created by the one-time owner bootstrap (§5).',
    )
  }
  return parsed
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    fail(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. ' +
        'Run `npm run db:start`, copy the printed values into .env.local, and retry.',
    )
  }

  requireLocal(url)

  // Service-role client: no session persistence, no token refresh, no cookies. It
  // exists for the length of this process and nowhere else.
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  for (const user of USERS) {
    const existing = await findUserByEmail(admin, user.email)

    let userId
    if (existing) {
      const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
        password: user.password,
        email_confirm: true,
      })
      if (error) fail(`could not update ${user.email}: ${error.message}`)
      userId = data.user.id
      console.log(`  updated  ${user.email}`)
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        // Local development has no reason to make a developer click a link in the
        // mail catcher before they can log in. The password-reset flow is still
        // exercised through the mail catcher, which is the part worth testing.
        email_confirm: true,
      })
      if (error) fail(`could not create ${user.email}: ${error.message}`)
      userId = data.user.id
      console.log(`  created  ${user.email}`)
    }

    // `profiles.user_id` is the primary key, so this upsert is the whole story:
    // create the profile, or correct its role and clear any deactivation.
    const { error: profileError } = await admin
      .from('profiles')
      .upsert(
        { user_id: userId, name: user.name, role: user.role, disabled_at: null },
        { onConflict: 'user_id' },
      )
    if (profileError) {
      fail(`could not write the profile for ${user.email}: ${profileError.message}`)
    }
  }

  console.log('\nLocal development identities ready:\n')
  for (const user of USERS) {
    console.log(`  ${user.role.padEnd(5)}  ${user.email}  ${user.password}`)
  }
  console.log('\nThese are throwaway local credentials. Nothing here is a real account.')
}

/**
 * `listUsers` is paginated. Two seeded users will always be on the first page, but
 * paging properly costs three lines and removes a surprise later.
 */
async function findUserByEmail(admin, email) {
  const target = email.toLowerCase()
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) fail(`could not list users: ${error.message}`)
    const match = data.users.find((u) => u.email?.toLowerCase() === target)
    if (match) return match
    if (data.users.length < 200) return null
  }
  return null
}

await main()
