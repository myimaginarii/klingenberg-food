import { ModalDialog } from '@/components/admin/menu/ModalDialog'
import type { Account, AccountPrompt } from '@/lib/accounts/model'

/**
 * One account confirmation — a role change, a deactivation or a reactivation.
 * Phase 11C; the 1r rule ("Slet spørger altid") applied to the two changes that
 * take something away, and to the two that give something, because both change
 * what a person may do.
 *
 * The same shape every confirmation in this administration has: reached by a
 * **link** (nothing has happened yet), rendered by the server as an ordinary block
 * that JavaScript promotes to a modal `<dialog>`, resolved by a form a person has
 * to submit. The safe way out comes first, filled, and holds focus; `Esc` is that
 * same way out; the committing control is second, outlined — in the error tone
 * when it takes access away, the neutral tone when it gives it.
 *
 * The question names the person — name and address, and "dig selv" when it is the
 * signed-in owner's own row — so the target is never ambiguous. The form carries
 * the account id, the version token the server rendered and, for a role change,
 * the role from the closed vocabulary; the action re-authorizes, re-resolves and
 * re-checks all three, so the dialog is an explanation, never a permission.
 */
export function UserConfirmDialog({
  anchorId,
  prompt,
  cancelHref,
  cancelLabel,
  action,
  fieldNames,
  account,
  role,
}: {
  anchorId: string
  prompt: AccountPrompt
  /** Back to the control this was opened from, so focus returns where it started. */
  cancelHref: string
  cancelLabel: string
  action: (formData: FormData) => Promise<void>
  fieldNames: { readonly user: string; readonly version: string; readonly role: string }
  account: Pick<Account, 'userId' | 'name' | 'updatedAt'>
  /** The role a role-change form submits; absent for the two active-state forms. */
  role?: Account['role']
}) {
  const headingId = `${anchorId}-titel`

  return (
    <ModalDialog cancelHref={cancelHref} id={anchorId} labelledBy={headingId}>
      <div className="flex flex-col gap-4 p-4 md:p-5">
        <div>
          <h2 className="text-heading font-sans font-semibold" id={headingId}>
            {prompt.question}
          </h2>
          <p className="text-ink-2 text-meta mt-1">{prompt.consequence}</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <a
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap inline-flex items-center px-5 font-semibold text-white"
            data-autofocus
            href={cancelHref}
          >
            {cancelLabel}
          </a>

          <form action={action}>
            <input name={fieldNames.user} type="hidden" value={account.userId} />
            <input name={fieldNames.version} type="hidden" value={account.updatedAt} />
            {role === undefined ? null : <input name={fieldNames.role} type="hidden" value={role} />}
            <button
              className={
                prompt.destructive
                  ? 'rounded-field border-error text-error-ink hover:bg-error-surface min-h-tap bg-surface inline-flex items-center border-[1.5px] px-4 font-semibold'
                  : 'rounded-field border-neutral-ink text-neutral-ink hover:bg-section min-h-tap bg-surface inline-flex items-center border-[1.5px] px-4 font-semibold'
              }
              type="submit"
            >
              {prompt.confirmLabel}
              <span className="sr-only"> — {account.name}</span>
            </button>
          </form>
        </div>
      </div>
    </ModalDialog>
  )
}
