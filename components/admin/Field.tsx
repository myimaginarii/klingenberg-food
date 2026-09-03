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
   * `email` for an address (the phone keyboard shows @ and .); the server parses
   * the value either way, so the attribute is a convenience, never a rule.
   */
  type?: 'text' | 'email'
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
  type = 'text',
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
        type={type}
      />
    </FieldShell>
  )
}

/**
 * A calendar date — design 1ah's "Startdato" and "Slutdato".
 *
 * `type="date"` rather than a written-out day/month/year triple or a JavaScript date
 * picker. Three reasons, in the order they matter here:
 *
 *   * it is the control the **phone** already has, and §15 (phase 12) calls the phone
 *     the primary admin device — a native wheel beats three text fields at 375 px;
 *   * its value is `YYYY-MM-DD`, which is exactly what the column stores and exactly
 *     what `lib/time/calendar.ts` calls a civil date, so nothing converts anything;
 *   * it needs no JavaScript at all. Where the browser has no date control the element
 *     degrades to a text field, and the server parses the value either way — a date
 *     that is not a real calendar date is refused with a sentence, not a stack trace.
 *
 * The field is not given a `min` or a `max`. A window in the past is a legitimate thing
 * to type — §7d asks the administration to *warn* about one at publish, which is a very
 * different thing from making it unenterable — and a browser-enforced bound would be a
 * rule the server did not state.
 */
export function DateField({
  id,
  name,
  label,
  defaultValue,
  hint,
  error,
}: Omit<FieldProps, 'inputMode' | 'autoComplete' | 'maxLength' | 'labelledBy' | 'required' | 'type'>) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error === undefined ? undefined : true}
        className={controlClass(error !== undefined, 'min-h-12 px-3 tabular-nums')}
        defaultValue={defaultValue}
        id={id}
        name={name}
        type="date"
      />
    </FieldShell>
  )
}

/**
 * A time of day — design 1ad's "20:00" beside the expiry date.
 *
 * `type="time"` for the same three reasons `DateField` is `type="date"`: it is the
 * control the phone already has, its value is exactly the `HH:MM` the domain calls a
 * civil time (`lib/time/calendar.ts`), and it needs no JavaScript — where the browser has
 * no time control it degrades to a text field and the server parses the value either way.
 *
 * No `min`, no `max` and no `step`. "In the future" depends on the date beside it and on
 * the server's clock, so a browser-enforced bound would be a rule the server did not
 * state — and would be wrong for every time of day on any later date.
 */
export function TimeField({
  id,
  name,
  label,
  defaultValue,
  hint,
  error,
}: Omit<FieldProps, 'inputMode' | 'autoComplete' | 'maxLength' | 'labelledBy' | 'required' | 'type'>) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error === undefined ? undefined : true}
        className={controlClass(error !== undefined, 'min-h-12 px-3 tabular-nums')}
        defaultValue={defaultValue}
        id={id}
        name={name}
        type="time"
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
  labelledBy,
}: Omit<FieldProps, 'inputMode' | 'autoComplete' | 'type'> & { rows?: number }) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        aria-describedby={describedBy(id, hint, error)}
        aria-labelledby={labelledBy}
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
}: Omit<FieldProps, 'inputMode' | 'autoComplete' | 'maxLength' | 'type'> & {
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
