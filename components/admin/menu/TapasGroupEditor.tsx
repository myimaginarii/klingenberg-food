import { FieldGroupError, labelId, TextField } from '@/components/admin/Field'
import { MAX_TAPAS_HEADING_LENGTH, MAX_TAPAS_ITEM_LENGTH } from '@/lib/menu/tapas'

/**
 * One Tapas list — phase 5F, technical plan §4 (decision 3).
 *
 * A plain `<form>` posting to a Server Action, like every other form in this
 * administration: no client component, no controlled inputs, no state library, and
 * nothing in the browser that has to be kept in step with the server. Take the
 * JavaScript away and every control here still works, because every control here is a
 * submit button.
 *
 * WHAT IS FIXED, AND WHAT IS A FIELD
 *
 * The `<h3>` is the group's **structural** name — Fast indhold, Vælg 7, Vælg 3
 * dressinger — and it is not editable, because it is not content: it says which of the
 * three lists this is. The restaurant's own wording for the same list ("På bordet —
 * altid med", "I vælger 7") is a *field*, because that is what a guest reads on the
 * public menu.
 *
 * There is deliberately no control for `mode`, for `choose` or for the group's id.
 * Those are structural rules rather than restaurant content (§4, decision 3), they are
 * stated once in `TAPAS_GROUP_RULES`, and the Server Action rebuilds every saved group
 * from them — so there is nothing to render and nothing a submission could carry.
 *
 * EVERY BUTTON SAVES
 *
 * Flyt op, Flyt ned, Fjern, Tilføj punkt and Gem liste are five submit buttons in one
 * form, distinguished by the value they carry. Each one submits the whole list as it is
 * currently typed, so a person who edited two items and then moved a third keeps all
 * three changes — and none of them is an immediate change to the hjemmeside: they are
 * all ordinary drafts (§6), so Fjern needs no Fortryd and no confirmation.
 *
 * ONE ARRANGEMENT, BOTH WIDTHS
 *
 * The panel is narrow at 1440 px and is the whole screen at 375 px, so the item field
 * takes its own line and its three controls sit in a row beneath it at every width.
 * Nothing here is duplicated per breakpoint.
 */

export type TapasGroupForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly dishId: string
    readonly version: string
    readonly group: string
    readonly heading: string
    readonly item: string
    readonly newItem: string
    readonly action: string
    readonly section: string
  }
  /** The button values, built by `tapas-form.ts` so the two cannot spell them apart. */
  readonly values: {
    readonly save: string
    readonly add: string
    readonly remove: (index: number) => string
    readonly up: (index: number) => string
    readonly down: (index: number) => string
  }
}

export type TapasGroupView = {
  readonly id: string
  /** What the administration calls this list. Fixed; not the editable heading. */
  readonly label: string
  /** The group's own `<section>` — where a save, a removal or a move comes back to. */
  readonly anchorId: string
  /** The empty field's id — where Tilføj punkt comes back to. */
  readonly newItemAnchorId: string
  readonly heading: string
  readonly items: readonly string[]
  readonly headingError?: string
  readonly newItemError?: string
  readonly listError?: string
  readonly itemErrors: readonly (string | undefined)[]
}

/** One small control in an item's row. Its words are its name; the group and the position follow. */
function RowButton({
  children,
  disabled,
  name,
  tone = 'normal',
  value,
  what,
}: {
  children: string
  disabled?: boolean
  name: string
  tone?: 'normal' | 'quiet'
  value: string
  /** " Fast indhold punkt 2" — so a column of identical buttons is not identical. */
  what: string
}) {
  return (
    <button
      className={`rounded-field border-field-border min-h-tap min-w-tap flex flex-1 items-center justify-center whitespace-nowrap border px-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === 'quiet'
          ? 'bg-surface text-ink-2 hover:bg-surface-muted hover:text-ink'
          : 'bg-surface text-ink hover:bg-surface-muted'
      } disabled:text-ink-3`}
      disabled={disabled}
      name={name}
      type="submit"
      value={value}
    >
      {children}
      {/* The leading space is deliberate: JSX drops whitespace between elements, and
          without it the accessible name would read "FjernFast indhold punkt 2". */}
      <span className="sr-only"> {what}</span>
    </button>
  )
}

export function TapasGroupEditor({
  dishId,
  version,
  section,
  form,
  group,
}: {
  dishId: string
  version: string
  section: string | null
  form: TapasGroupForm
  group: TapasGroupView
}) {
  const { anchorId, newItemAnchorId } = group
  const titleId = `${anchorId}-titel`
  const headingId = `${anchorId}-overskrift`
  const listErrorId = `${anchorId}-liste-fejl`
  const total = group.items.length

  /** " Vælg 7 punkt 3" — the context a screen reader needs on an otherwise bare control. */
  const at = (index: number) => `${group.label} punkt ${index + 1}`

  return (
    <section aria-labelledby={titleId} className="border-border rounded-card border p-3 md:p-4" id={anchorId}>
      <h3 className="text-neutral-ink font-sans font-semibold" id={titleId}>
        {group.label}
      </h3>

      <form action={form.action} aria-label={`Tapas — ${group.label}`} className="mt-3 flex flex-col gap-3">
        <input name={form.fieldNames.dishId} type="hidden" value={dishId} />
        <input name={form.fieldNames.version} type="hidden" value={version} />
        <input name={form.fieldNames.group} type="hidden" value={group.id} />
        {section === null ? null : (
          <input name={form.fieldNames.section} type="hidden" value={section} />
        )}

        <TextField
          defaultValue={group.heading}
          error={group.headingError}
          hint="Sådan står listen på hjemmesiden."
          id={headingId}
          label="Overskrift"
          labelledBy={`${titleId} ${labelId(headingId)}`}
          maxLength={MAX_TAPAS_HEADING_LENGTH}
          name={form.fieldNames.heading}
          required
        />

        {total === 0 ? (
          <p className="text-ink-2 text-meta">Listen er tom. Skriv det første punkt herunder.</p>
        ) : (
          <ul aria-label={`Punkter i ${group.label}`} className="flex flex-col gap-3">
            {group.items.map((item, index) => {
              const fieldId = `${anchorId}-punkt-${index}`

              return (
                <li className="flex flex-col gap-2" key={`${index}-${item}`}>
                  <TextField
                    defaultValue={item}
                    error={group.itemErrors[index]}
                    id={fieldId}
                    label={`Punkt ${index + 1}`}
                    labelledBy={`${titleId} ${labelId(fieldId)}`}
                    maxLength={MAX_TAPAS_ITEM_LENGTH}
                    name={form.fieldNames.item}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <RowButton
                      disabled={index === 0}
                      name={form.fieldNames.action}
                      value={form.values.up(index)}
                      what={at(index)}
                    >
                      Flyt op
                    </RowButton>
                    <RowButton
                      disabled={index === total - 1}
                      name={form.fieldNames.action}
                      value={form.values.down(index)}
                      what={at(index)}
                    >
                      Flyt ned
                    </RowButton>
                    <RowButton
                      name={form.fieldNames.action}
                      tone="quiet"
                      value={form.values.remove(index)}
                      what={at(index)}
                    >
                      Fjern
                    </RowButton>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/*
          The empty field and its own button. Adding is a save like every other button
          here, so an item cannot be left half-added: either it has text and is stored,
          or the person is told to write some.
        */}
        <div className="border-border flex flex-col gap-2 border-t pt-3">
          <TextField
            defaultValue=""
            error={group.newItemError}
            id={newItemAnchorId}
            label="Nyt punkt"
            labelledBy={`${titleId} ${labelId(newItemAnchorId)}`}
            maxLength={MAX_TAPAS_ITEM_LENGTH}
            name={form.fieldNames.newItem}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              aria-describedby={group.listError === undefined ? undefined : listErrorId}
              className="rounded-field border-field-border bg-surface text-ink hover:bg-surface-muted min-h-tap inline-flex items-center border-[1.5px] px-4 font-semibold"
              name={form.fieldNames.action}
              type="submit"
              value={form.values.add}
            >
              + Tilføj punkt
              <span className="sr-only"> til {group.label}</span>
            </button>

            <button
              className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap px-6 font-semibold text-white"
              name={form.fieldNames.action}
              type="submit"
              value={form.values.save}
            >
              Gem liste
              <span className="sr-only"> — {group.label}</span>
            </button>
          </div>

          <FieldGroupError error={group.listError} id={listErrorId} />
        </div>
      </form>
    </section>
  )
}
