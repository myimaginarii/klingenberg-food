import { ModalDialog } from '@/components/admin/menu/ModalDialog'
import type { NewsPrompt } from '@/lib/news/lifecycle'

/**
 * One news confirmation — publish, unpublish or delete. Design 1s ("Offentliggør
 * åbner en lille bekræftelse"), the 1r rule ("Slet spørger altid"), technical plan §6.
 *
 * The same shape every confirmation in this administration has: reached by a **link**
 * (nothing has happened yet), rendered by the server as an ordinary block that
 * JavaScript promotes to a modal `<dialog>`, resolved by a form a person has to
 * submit. The safe way out comes first, filled, and holds focus; the committing
 * control is second, outlined — in the error tone when it destroys something, the
 * neutral tone when it publishes.
 *
 * Every sentence comes from `lib/news/lifecycle.ts`; this file arranges them. The
 * form carries the article id and the version token the server rendered — the action
 * re-authorizes, re-resolves and re-checks both, so the dialog is an explanation,
 * never a permission.
 */
export function NewsConfirmDialog({
  anchorId,
  prompt,
  cancelHref,
  cancelLabel,
  action,
  fieldNames,
  articleId,
  articleTitle,
  version,
  destructive = false,
}: {
  anchorId: string
  prompt: NewsPrompt
  /** Back to the control this was opened from, so focus returns where it started. */
  cancelHref: string
  cancelLabel: string
  action: (formData: FormData) => Promise<void>
  fieldNames: { readonly articleId: string; readonly version: string }
  articleId: string
  articleTitle: string
  /** The version the confirmation was rendered from — the concurrency token (§6). */
  version: string
  destructive?: boolean
}) {
  const headingId = `${anchorId}-titel`

  return (
    <ModalDialog cancelHref={cancelHref} id={anchorId} labelledBy={headingId}>
      <div className="flex flex-col gap-4 p-4 md:p-5">
        <div>
          {/* `wrap-anywhere`: the question quotes the title, which may be one unbroken word. */}
          <h2 className="text-heading font-sans font-semibold wrap-anywhere" id={headingId}>
            {prompt.question}
          </h2>
          <p className="text-ink-2 text-meta mt-1">{prompt.consequence}</p>
        </div>

        {/*
          On the phone the two choices stack, full width, the safe one first with a
          clear gap — the arrangement 1ae's sheet, the users-admin confirmations and
          the menu's deletion (12A) use; from `md` they are 1s's row.
        */}
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-end md:gap-2">
          <a
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap inline-flex items-center justify-center px-5 font-semibold text-white"
            data-autofocus
            href={cancelHref}
          >
            {cancelLabel}
          </a>

          <form action={action} className="flex flex-col md:block">
            <input name={fieldNames.articleId} type="hidden" value={articleId} />
            <input name={fieldNames.version} type="hidden" value={version} />
            <button
              className={
                destructive
                  ? 'rounded-field border-error text-error-ink hover:bg-error-surface min-h-tap bg-surface inline-flex items-center justify-center border-[1.5px] px-4 font-semibold'
                  : 'rounded-field border-neutral-ink text-neutral-ink hover:bg-section min-h-tap bg-surface inline-flex items-center justify-center border-[1.5px] px-4 font-semibold'
              }
              type="submit"
            >
              {prompt.confirmLabel}
              <span className="sr-only"> — {articleTitle}</span>
            </button>
          </form>
        </div>
      </div>
    </ModalDialog>
  )
}
