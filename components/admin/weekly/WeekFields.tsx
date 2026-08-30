import { FieldGroupError } from '@/components/admin/Field'
import { formatWeekdayName } from '@/lib/hours/format'
import { WEEKDAY_KEYS } from '@/lib/time/calendar'
import { formatIsoWeekToken, type IsoWeek } from '@/lib/time/iso-week'

/**
 * The two controls 1ag's first card has that no other editor in this administration has:
 * the week number, and the days the dish is served on.
 *
 * Both are drawn exactly as the frame draws them — one dropdown labelled "Ugenummer",
 * and one row of seven day boxes under "Hvilke dage serveres den?" — and both are plain
 * form controls, so the card works with no JavaScript and the keyboard path is the
 * platform's rather than one written here.
 */

/**
 * "Ugenummer" — 1ag's dropdown.
 *
 * One control, as the frame draws it — a narrow dropdown of week numbers — but its
 * **value** carries the year as well as the number (`2026-W36`). A week number without
 * its year is ambiguous for the two weeks of the year it matters most: the last days of
 * December regularly belong to week 1 of the following year. The label shows the year
 * only when it differs from the current one, so an ordinary week reads "Uge 36" and a
 * week across the boundary reads "Uge 1 · 2027" — the extra words appear exactly where
 * they are needed and nowhere else, which is what keeps the control the width the frame
 * draws it at.
 *
 * The list is built by `isoWeekOptions` and always contains the week the row already
 * holds, so simply opening this editor can never silently replace a stored value.
 *
 * The explanation lives in {@link WeekNumberHint}, beneath the whole row rather than
 * under this column: a sentence set in a 144-px-wide column is a sentence nobody reads.
 * The field points at it with `aria-describedby` wherever it is rendered.
 */
export function WeekNumberField({
  id,
  name,
  options,
  selected,
  thisWeek,
  hintId,
  error,
}: {
  id: string
  name: string
  options: readonly IsoWeek[]
  /** The week the form is rendered from — live with any draft over it. */
  selected: IsoWeek | null
  /** This week in Copenhagen, so a week in another year is labelled with its year. */
  thisWeek: IsoWeek
  /** The element carrying {@link WeekNumberHint}, wherever the editor put it. */
  hintId: string
  error?: string
}) {
  const errorId = `${id}-fejl`
  const value = selected === null ? '' : formatIsoWeekToken(selected)

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-meta text-neutral-ink font-medium" htmlFor={id}>
        Ugenummer
      </label>

      <select
        aria-describedby={error === undefined ? hintId : `${hintId} ${errorId}`}
        aria-invalid={error === undefined ? undefined : true}
        className={`bg-field-bg rounded-field text-ink min-h-12 w-full border-[1.5px] px-3 tabular-nums ${
          error === undefined ? 'border-field-border' : 'border-error bg-surface'
        }`}
        defaultValue={value}
        id={id}
        name={name}
      >
        {options.map((option) => {
          const token = formatIsoWeekToken(option)
          const sameYear = option.year === thisWeek.year

          return (
            <option key={token} value={token}>
              {`Uge ${String(option.week)}`}
              {sameYear ? '' : ` · ${String(option.year)}`}
            </option>
          )
        })}
      </select>

      {error === undefined ? null : (
        <p
          className="text-error-ink text-meta flex items-center gap-1.5 font-medium"
          id={errorId}
        >
          <span
            aria-hidden="true"
            className="border-error size-3.5 shrink-0 rounded-full border-2"
          />
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * What the week number means, and what changing it will do — technical plan §7e item 5.
 *
 * Three short sentences, and each earns its place:
 *
 *   * **which week it is now**, because the dropdown no longer says so and a person
 *     writing next week's dish needs to know which one they are on;
 *   * **which week the hjemmeside is showing**, which is the difference between a draft
 *     and what a guest reads. §7e item 5 asks for exactly this: *"The editor shows the
 *     live week number next to the draft one so the difference is obvious."*;
 *   * **what changing it does**, before it happens. The rollover blanks the form, and a
 *     rule a person meets only after it has fired is a rule that looks like a bug.
 *
 * Rendered beneath the whole row and pointed at by the field, so it reads as a sentence
 * rather than as a column of two-word lines.
 */
export function WeekNumberHint({
  id,
  thisWeek,
  liveWeek,
}: {
  id: string
  thisWeek: IsoWeek
  /** The **published** week, or `null` when the row has never had one. */
  liveWeek: IsoWeek | null
}) {
  return (
    <p className="text-ink-3 text-micro" id={id}>
      {`Denne uge er uge ${String(thisWeek.week)}. `}
      {liveWeek === null ? '' : `Hjemmesiden viser uge ${String(liveWeek.week)}. `}
      Skifter du ugenummeret, starter du på et blankt skema — hjemmesiden ændrer sig
      først, når du offentliggør.
    </p>
  )
}

/**
 * "Hvilke dage serveres den?" — 1ag's row of seven boxes.
 *
 * Real checkboxes drawn as the frame's boxes, the same way `LabelFields` draws the
 * label chips: a visually hidden `<input>` inside its own `<label>`, with the box drawn
 * by `peer-checked`. Space and tab work, the state is announced, the form submits with
 * no JavaScript, and the 3 px focus ring lands on the box a person can see.
 *
 * The visible text is the three-letter Danish abbreviation the frame prints ("Ons"), and
 * the accessible name is the whole word, so a screen reader says "onsdag" rather than
 * spelling out a fragment.
 *
 * WHY IT WRAPS ON A PHONE
 *
 * 1ag draws one row of seven, at a desktop width. Seven boxes cannot be 44 px wide
 * inside a card at 375 px — the arithmetic gives 39 — and 1aa's minimum target size is
 * not a target the phone is exempt from; the phone is where a mis-tap costs the most
 * (§15, phase 12). Neither of the alternatives is honest either: shrinking them breaks
 * the rule, and putting the row in a horizontal scroller hides three days behind a
 * gesture on the one control where seeing all seven at once *is* the information.
 *
 * So it is a grid that is four wide on a phone and seven wide from `md`, which is the
 * frame's row at every width the frame is drawn at, and two comfortable rows below it.
 * The tab order and the markup are identical in both. (`md` and not `sm`: the theme
 * clears Tailwind's default breakpoints and declares only the three 1aa names.)
 */
export function ServingDaysField({
  name,
  selected,
  error,
}: {
  name: string
  selected: readonly string[]
  error?: string
}) {
  const chosen = new Set(selected)

  return (
    <fieldset aria-describedby={error === undefined ? undefined : 'dage-fejl'}>
      <legend className="text-meta text-neutral-ink mb-1.5 font-medium">
        Hvilke dage serveres den?
      </legend>

      <div className="grid grid-cols-4 gap-1.5 md:grid-cols-7">
        {WEEKDAY_KEYS.map((weekday) => (
          <label className="cursor-pointer" key={weekday}>
            <input
              className="peer sr-only"
              defaultChecked={chosen.has(weekday)}
              name={name}
              type="checkbox"
              value={weekday}
            />
            <span className="rounded-field border-field-border text-ink-3 peer-checked:bg-brand-700 peer-checked:border-brand-700 peer-focus-visible:outline-focus flex min-h-12 items-center justify-center border text-meta font-medium peer-checked:font-semibold peer-checked:text-white peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2">
              <span aria-hidden="true">{shortDay(weekday)}</span>
              <span className="sr-only">{formatWeekdayName(weekday, 'long')}</span>
            </span>
          </label>
        ))}
      </div>

      <FieldGroupError error={error} id="dage-fejl" />
    </fieldset>
  )
}

/** "Ons" — the frame's own abbreviation, capitalised as it draws it. */
function shortDay(weekday: (typeof WEEKDAY_KEYS)[number]): string {
  const short = formatWeekdayName(weekday, 'short')

  return short.charAt(0).toLocaleUpperCase('da-DK') + short.slice(1)
}
