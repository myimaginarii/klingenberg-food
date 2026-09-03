import {
  describeRole,
  LAST_OWNER_NOTE,
  otherRole,
  ROLE_LABELS,
  type Account,
  type AccountControls,
  type AccountStatusLabel,
} from '@/lib/accounts/model'

/**
 * The account list — phase 11C. No approved frame draws it; it is built in the
 * administration's own language: 1z's list of cards, 1aa's pills (a shape before
 * the word, never colour alone), 1r's rule that a destructive control asks first.
 *
 * Each row states four things in words — the name, the address, the role, the
 * state — and offers the controls the server decided it offers. Every control is a
 * **link** to a confirmation: pressing one navigates and nothing has happened yet.
 * The row of the only active owner offers no role or deactivation control and
 * says why in a sentence, not in a greyed-out button: the database refuses the
 * same operation under a lock whatever the screen shows, so the screen's job is to
 * explain, not to enforce.
 *
 * Nothing here decides anything: which controls exist comes from `accountControls`,
 * the sentences from `describeAccountStatus`, the addresses from `./routes.ts`.
 */

export type UserListRow = {
  readonly account: Account
  readonly status: AccountStatusLabel
  readonly controls: AccountControls
  readonly roleHref: string
  readonly deactivateHref: string
  readonly reactivateHref: string
  readonly ids: { readonly role: string; readonly deactivate: string; readonly reactivate: string }
}

const ROW_TONE = {
  active: 'bg-surface border-border',
  invited: 'bg-warning-surface border-warning-border border-[1.5px]',
  deactivated: 'bg-neutral-surface border-border',
} as const

const NEUTRAL_CONTROL =
  'rounded-field border-neutral-ink text-neutral-ink hover:bg-section bg-surface inline-flex min-h-tap items-center justify-center border-[1.5px] px-4 text-meta font-semibold no-underline'

const DESTRUCTIVE_CONTROL =
  'rounded-field border-error text-error-ink hover:bg-error-surface bg-surface inline-flex min-h-tap items-center justify-center border-[1.5px] px-4 text-meta font-semibold no-underline'

const PRIMARY_CONTROL =
  'bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field inline-flex min-h-tap items-center justify-center px-4 text-meta font-semibold text-white no-underline'

export function UserList({ rows, anchorId }: { rows: readonly UserListRow[]; anchorId: string }) {
  const headingId = `${anchorId}-titel`

  return (
    <section aria-labelledby={headingId} id={anchorId}>
      <h2 className="font-mono text-label text-ink-3 uppercase" id={headingId}>
        Brugere
      </h2>

      <ul className="mt-3 flex flex-col gap-2.5">
        {rows.map((row) => (
          <li
            className={`rounded-card flex flex-col gap-3 border p-3.5 md:flex-row md:items-start md:justify-between md:gap-4 ${ROW_TONE[row.status.tone]}`}
            key={row.account.userId}
          >
            <div className="min-w-0">
              <p className="text-ink font-semibold">
                {row.account.name}
                {row.controls.self ? <span className="text-ink-3 font-normal"> (dig)</span> : null}
              </p>
              <p className="text-ink-2 text-meta break-all font-mono">{row.account.email}</p>
              <p className="text-ink-3 text-meta mt-1">{row.status.line}</p>
            </div>

            <div className="flex shrink-0 flex-col gap-2.5 md:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <RolePill role={row.account.role} />
                <StatusPill status={row.status} />
              </div>

              <RowControls row={row} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RowControls({ row }: { row: UserListRow }) {
  const { controls, account } = row

  if (controls.withheldReason === 'last_owner') {
    return <p className="text-ink-3 text-meta max-w-[24rem] md:text-right">{LAST_OWNER_NOTE}</p>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {controls.canChangeRole ? (
        <a className={NEUTRAL_CONTROL} href={row.roleHref} id={row.ids.role}>
          Gør til {ROLE_LABELS[otherRole(account.role)].toLowerCase()}
          <span className="sr-only"> — {account.name}</span>
        </a>
      ) : null}

      {controls.canDeactivate ? (
        <a className={DESTRUCTIVE_CONTROL} href={row.deactivateHref} id={row.ids.deactivate}>
          Deaktivér
          <span className="sr-only"> — {account.name}</span>
        </a>
      ) : null}

      {controls.canReactivate ? (
        <a className={PRIMARY_CONTROL} href={row.reactivateHref} id={row.ids.reactivate}>
          Genaktivér
          <span className="sr-only"> — {account.name}</span>
        </a>
      ) : null}
    </div>
  )
}

/** Ejer / Medarbejder — a neutral pill; the word carries the meaning. */
function RolePill({ role }: { role: Account['role'] }) {
  return (
    <span className="rounded-badge border-border bg-neutral-surface text-neutral-ink inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-micro leading-none font-semibold">
      <span aria-hidden="true" className="bg-neutral-ink size-2 shrink-0 rounded-sm" />
      {describeRole(role)}
    </span>
  )
}

/** Aktiv / Inviteret / Deaktiveret — 1aa's status pill: shape, word, tone. */
function StatusPill({ status }: { status: AccountStatusLabel }) {
  switch (status.tone) {
    case 'active':
      return (
        <span className="rounded-badge border-success-border bg-success-surface text-success-ink inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-micro leading-none font-semibold">
          <span aria-hidden="true" className="bg-success size-2 shrink-0 rounded-full" />
          {status.pill}
        </span>
      )
    case 'invited':
      return (
        <span className="rounded-badge border-warning-border bg-surface text-warning-ink inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-micro leading-none font-semibold">
          <span aria-hidden="true" className="bg-warning size-2 shrink-0 rotate-45" />
          {status.pill}
        </span>
      )
    case 'deactivated':
      return (
        <span className="rounded-badge border-border bg-surface text-ink-2 inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-micro leading-none font-semibold">
          <span aria-hidden="true" className="text-ink-3 leading-none">✕</span>
          {status.pill}
        </span>
      )
  }
}
