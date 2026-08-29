/**
 * The administration's form fields — design 1aa ("FELTER"), 1r.
 *
 * One component per kind of field rather than the same eight class names repeated down
 * an editor. That is not only tidiness: 1aa draws a field in three states — normal,
 * focus and error — and the error state is the one that is easy to get subtly wrong.
 * Written once, every field in the administration binds its message the same way:
 *
 *   * the message is a real element with an id, and the control points at it with
 *     `aria-describedby`, so a screen reader reads the field and its problem together;
 *   * `aria-invalid` marks the control itself, so the problem is not carried by the
 *     red border alone — 1aa's "status = ikon + tekst, aldrig farve alene" applies to
 *     fields as much as to badges;
 *   * the message text is a sentence, and it sits beneath the field it belongs to
 *     rather than in a summary somewhere else on the screen.
 *
 * The focus ring is not set here. `app/globals.css` gives every focusable element the
 * design's 3 px ring globally, so a field cannot ship without one.
 *
 * Every value is a token from frame 1aa. Nothing invents a colour, a radius or a size.
 */

const CONTROL_BASE =
  'bg-field-bg rounded-field border-[1.5px] w-full text-ink placeholder:text-ink-3'

const CONTROL_TONE = {
  normal: 'border-field-border',
  error: 'border-error bg-surface',
} as const

function controlClass(invalid: boolean, extra: string): string {
  return `${CONTROL_BASE} ${invalid ? CONTROL_TONE.error : CONTROL_TONE.normal} ${extra}`
}

/** The label, the control and its message, laid out the way 1aa draws them. */
function FieldShell({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/*
        The label carries an id as well as a `for`, so a control that needs a *longer*
        accessible name than its visible label can point at this element together with
        one that supplies the context — see `labelledBy` below. Harmless everywhere else.
      */}
      <label className="text-meta text-neutral-ink font-medium" htmlFor={id} id={labelId(id)}>
        {label}
      </label>

      {children}

      {hint === undefined ? null : (
        <p className="text-ink-3 text-micro" id={`${id}-hjaelp`}>
          {hint}
        </p>
      )}

      {error === undefined ? null : (
        <p className="text-error-ink text-meta flex items-center gap-1.5 font-medium" id={`${id}-fejl`}>
          <span aria-hidden="true" className="border-error size-3.5 shrink-0 rounded-full border-2" />
          {error}
        </p>
      )}
    </div>
  )
}

/** The id of a field's own `<label>`, for a control that composes a longer name. */
export function labelId(id: string): string {
  return `${id}-etiket`
}

/** What a control needs to point at its own hint and message. */
function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint === undefined ? null : `${id}-hjaelp`, error === undefined ? null : `${id}-fejl`]
    .filter((value): value is string => value !== null)
    .join(' ')

  return ids.length > 0 ? ids : undefined
}

export type FieldProps = {
  id: string
  name: string
  label: string
  defaultValue?: string
  hint?: string
  error?: string
  required?: boolean
  autoComplete?: string
  inputMode?: 'text' | 'decimal'
  maxLength?: number
  /**
   * Element ids whose text, joined, is this control's accessible name.
   *
   * For a field whose visible label is only meaningful in context — "Punkt 1" inside one
   * of three Tapas lists (phase 5F). Pass the context element's id *and* this field's own
   * `labelId(id)`, so the spoken name contains the visible label rather than replacing
   * it. The `<label for>` is still there, so clicking the words still focuses the field.
   */
  labelledBy?: string
}

export function TextField({
  id,
  name,
  label,
  defaultValue,
  hint,
  error,
  required,
  autoComplete = 'off',
  inputMode,
  maxLength,
  labelledBy,
}: FieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        aria-describedby={describedBy(id, hint, error)}
        aria-labelledby={labelledBy}
        aria-invalid={error === undefined ? undefined : true}
        autoComplete={autoComplete}
        className={controlClass(error !== undefined, 'min-h-12 px-3')}
        defaultValue={defaultValue}
        id={id}
        inputMode={inputMode}
        maxLength={maxLength}
        name={name}
        required={required}
        type="text"
      />
    </FieldShell>
  )
}

export function TextAreaField({
  id,
  name,
  label,
  defaultValue,
  hint,
  error,
  rows = 4,
  maxLength,
}: Omit<FieldProps, 'inputMode' | 'autoComplete'> & { rows?: number }) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error === undefined ? undefined : true}
        className={controlClass(error !== undefined, 'p-3 leading-relaxed')}
        defaultValue={defaultValue}
        id={id}
        maxLength={maxLength}
        name={name}
        rows={rows}
      />
    </FieldShell>
  )
}

export function SelectField({
  id,
  name,
  label,
  defaultValue,
  hint,
  error,
  options,
}: Omit<FieldProps, 'inputMode' | 'autoComplete' | 'maxLength'> & {
  options: readonly { value: string; label: string }[]
}) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error === undefined ? undefined : true}
        className={controlClass(error !== undefined, 'min-h-12 px-3')}
        defaultValue={defaultValue}
        id={id}
        name={name}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

/**
 * A message that belongs to a group of controls rather than to one — the label chips,
 * where the problem is with the set and not with any single checkbox.
 *
 * The group carries `role="group"` with its own `aria-describedby`, which is the same
 * association a single field makes, one level up.
 */
export function FieldGroupError({ id, error }: { id: string; error?: string }) {
  if (error === undefined) return null

  return (
    <p className="text-error-ink text-meta flex items-center gap-1.5 font-medium" id={id}>
      <span aria-hidden="true" className="border-error size-3.5 shrink-0 rounded-full border-2" />
      {error}
    </p>
  )
}
