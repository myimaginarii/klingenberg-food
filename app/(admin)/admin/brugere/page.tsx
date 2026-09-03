import { AdminSectionBar } from '@/components/admin/menu/AdminSectionBar'
import { InviteForm } from '@/components/admin/users/InviteForm'
import { UserConfirmDialog } from '@/components/admin/users/UserConfirmDialog'
import { UserList, type UserListRow } from '@/components/admin/users/UserList'
import { UsersStatusNotice } from '@/components/admin/users/UsersStatusNotice'
import { readAccountDirectory } from '@/lib/accounts/admin'
import {
  accountControls,
  activeOwnerCount,
  describeAccountStatus,
  describeDeactivation,
  describeReactivation,
  describeRoleChange,
  otherRole,
  type InviteFieldKey,
} from '@/lib/accounts/model'
import { requireOwner } from '@/lib/auth/guards'

import { changeRole, deactivateAccount, reactivateAccount } from './account-actions'
import { decodeInviteErrors, readInviteForm, USERS_ERROR_FIELD, USERS_FORM } from './forms'
import { inviteUser } from './invite-actions'
import {
  DEACTIVATE_DIALOG_ANCHOR,
  INVITE_ANCHOR,
  LIST_ANCHOR,
  REACTIVATE_DIALOG_ANCHOR,
  ROLE_DIALOG_ANCHOR,
  rowControlId,
  USERS_PARAM,
  usersHref,
} from './routes'

/**
 * Brugere — technical plan §3, §5 ("Accounts", decision 11), §8, §15 (phase 11C).
 *
 * SCOPE. The Owner lists the accounts, invites a Staff or Owner account (name,
 * e-mail, role), changes a role, and deactivates — never deletes — an account, or
 * reactivates one. No approved frame draws this screen (§5: "no new screens are
 * required beyond a user list, which the approved design does not contain and
 * which is therefore built in the approved visual language"), so it is 1z's list
 * of cards, 1v's one-card form and this administration's one confirmation shape,
 * and nothing more: no password control, no metadata editor, no delete, no
 * session viewer, no permission matrix.
 *
 * **`requireOwner()`, here, in the page.** §5's matrix puts "User accounts" in the
 * Owner column alone. A staff member who types the address is sent to the "no
 * access" page rather than shown a locked screen, every Server Action calls
 * `requireOwner()` again for itself, and the database refuses anybody else a third
 * time: `list_accounts()` raises, the three transitions raise, and RLS shows a
 * staff JWT only its own row. Absence of the dashboard tile is not the enforcement.
 *
 * All the state this screen has is in the URL (`./routes.ts`): which confirmation
 * is on screen, what the last action did, and what a refused invitation echoed
 * back. The confirmations are server-rendered blocks that scripting promotes to
 * modal dialogs (`ModalDialog`); the whole screen works with JavaScript off.
 *
 * THE LAST ACTIVE OWNER. The row offers no role or deactivation control and says
 * why. That is an explanation: `set_account_role()` and `set_account_active()`
 * refuse the same operation under the invariant lock, and the deferred constraint
 * trigger refuses it again at commit for any path that bypasses them (pgTAP 028).
 */

/** A repeated parameter is a malformed request, not two answers: take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function searchParamsOf(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    for (const item of many(value)) search.append(key, item)
  }

  return search
}

/** The outcomes that come back with the typed values echoed. */
const ECHOED_STATUSES = new Set(['ugyldig', 'findes', 'ugyldig_email', 'login_fejl', 'profil_fejl'])

const EMPTY_INVITE = { name: '', email: '', role: '' } as const

export default async function UsersAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireOwner()

  const [params, accounts] = await Promise.all([searchParams, readAccountDirectory()])

  const status = one(params[USERS_PARAM.status])
  const owners = activeOwnerCount(accounts)

  const issues = decodeInviteErrors(many(params[USERS_ERROR_FIELD]))
  const echoed = issues.length > 0 || (status !== undefined && ECHOED_STATUSES.has(status))
  const inviteValues = echoed ? readInviteForm(searchParamsOf(params)) : EMPTY_INVITE

  const errorFor = (field: InviteFieldKey) => issues.find((issue) => issue.field === field)?.message

  const rows: UserListRow[] = accounts.map((account) => ({
    account,
    status: describeAccountStatus(account),
    controls: accountControls(account, profile.userId, owners),
    roleHref: usersHref({ confirmRole: account.userId }),
    deactivateHref: usersHref({ confirmDeactivate: account.userId }),
    reactivateHref: usersHref({ confirmReactivate: account.userId }),
    ids: {
      role: rowControlId(account.userId, 'role'),
      deactivate: rowControlId(account.userId, 'deactivate'),
      reactivate: rowControlId(account.userId, 'reactivate'),
    },
  }))

  // The one open confirmation, resolved against the server's own list and the
  // controls the server offers — an id naming nothing, or naming a row whose
  // control is withheld, produces no dialog at all.
  const rowFor = (id: string | undefined): UserListRow | null =>
    id === undefined ? null : (rows.find((row) => row.account.userId === id) ?? null)

  const confirmingRole = rowFor(one(params[USERS_PARAM.confirmRole]))
  const confirmingDeactivate = confirmingRole === null ? rowFor(one(params[USERS_PARAM.confirmDeactivate])) : null
  const confirmingReactivate =
    confirmingRole === null && confirmingDeactivate === null
      ? rowFor(one(params[USERS_PARAM.confirmReactivate]))
      : null

  const dialogFieldNames = { user: USERS_FORM.user, version: USERS_FORM.version, role: USERS_FORM.role }

  const dialogs = (
    <>
      {confirmingRole === null || !confirmingRole.controls.canChangeRole ? null : (
        <UserConfirmDialog
          account={confirmingRole.account}
          action={changeRole}
          anchorId={ROLE_DIALOG_ANCHOR}
          cancelHref={usersHref({ focus: { userId: confirmingRole.account.userId, control: 'role' } })}
          cancelLabel="Behold rollen"
          fieldNames={dialogFieldNames}
          prompt={describeRoleChange(confirmingRole.account, confirmingRole.controls.self)}
          role={otherRole(confirmingRole.account.role)}
        />
      )}

      {confirmingDeactivate === null || !confirmingDeactivate.controls.canDeactivate ? null : (
        <UserConfirmDialog
          account={confirmingDeactivate.account}
          action={deactivateAccount}
          anchorId={DEACTIVATE_DIALOG_ANCHOR}
          cancelHref={usersHref({
            focus: { userId: confirmingDeactivate.account.userId, control: 'deactivate' },
          })}
          cancelLabel="Behold kontoen aktiv"
          fieldNames={dialogFieldNames}
          prompt={describeDeactivation(confirmingDeactivate.account, confirmingDeactivate.controls.self)}
        />
      )}

      {confirmingReactivate === null || !confirmingReactivate.controls.canReactivate ? null : (
        <UserConfirmDialog
          account={confirmingReactivate.account}
          action={reactivateAccount}
          anchorId={REACTIVATE_DIALOG_ANCHOR}
          cancelHref={usersHref({
            focus: { userId: confirmingReactivate.account.userId, control: 'reactivate' },
          })}
          cancelLabel="Lad den være deaktiveret"
          fieldNames={dialogFieldNames}
          prompt={describeReactivation(confirmingReactivate.account)}
        />
      )}
    </>
  )

  return (
    <>
      <AdminSectionBar backHref="/admin" backLabel="Oversigt" title="Brugere" />

      <main className="mx-auto flex w-full max-w-[52rem] flex-col gap-4 px-gutter py-6 md:px-8">
        <UsersStatusNotice status={status} />

        <p className="text-ink-2 text-meta">
          Hvem der kan logge ind i administrationen, og hvad de må. En konto deaktiveres
          — den slettes aldrig, så navnet bliver stående ved alt, personen har lavet.
        </p>

        <UserList anchorId={LIST_ANCHOR} rows={rows} />

        <InviteForm
          action={inviteUser}
          anchorId={INVITE_ANCHOR}
          errorFor={errorFor}
          fieldNames={{ name: USERS_FORM.name, email: USERS_FORM.email, role: USERS_FORM.role }}
          key={JSON.stringify(inviteValues)}
          values={inviteValues}
        />

        {dialogs}
      </main>
    </>
  )
}

