import { FieldGroupError } from '@/components/admin/Field'
import {
  MAX_CUSTOM_LABEL_LENGTH,
  MAX_DISH_LABELS,
  STANDARD_DISH_LABELS,
} from '@/lib/menu/labels'

/**
 * "Mærkater (valgfrit)" — design 1r, plus the confirmed custom-label decision.
 *
 * 1r draws four chips that toggle: Populær · Ny · Stærk · Vegetar. Those stay the
 * primary control and are drawn exactly as the frame draws them. Beneath them sits the
 * one addition this phase makes — a small field for the short descriptive labels the
 * approved frames already print ("Pulled pork" on Glade Gris in 1h, "Kylling" and
 * "Størst" on the Forside cards) — written in the field-and-chip language the design
 * already contains rather than in a new one.
 *
 * There is no colour picker, no icon, no ordering control and no label library. A label
 * is a short piece of text; tone is decided at render time by the four known values
 * (`components/site/menu/DishBadge.tsx`) and everything else is neutral.
 *
 * WHY THE TOGGLES ARE REAL CHECKBOXES
 *
 * They look like chips and behave like checkboxes: a visually hidden `<input>` inside
 * its own `<label>`, with the chip drawn by `peer-checked`. That means space and tab
 * work, the state is announced, the form submits without a line of JavaScript, and the
 * focus ring the design specifies lands on the chip a person can see.
 *
 * WHY THE CUSTOM LABELS ARE PRE-FILLED
 *
 * Every label the dish already has is rendered into the form, so saving the form saves
 * them back. That is what makes the phase brief's rule true in the ordinary case:
 * changing the price of Glade Gris cannot remove "Pulled pork", because the form
 * carries it. `buildDishLabels` then guarantees it in the general case, by preserving
 * both the text and the order of labels the dish already had.
 */
export function LabelFields({
  standard,
  custom,
  error,
  fieldNames,
}: {
  /** The standard labels currently on the dish. */
  standard: readonly string[]
  /** The custom labels currently on the dish, in their stored order. */
  custom: readonly string[]
  error?: string
  fieldNames: { standard: string; custom: string }
}) {
  const selected = new Set(standard)

  // One field per existing label, plus one empty slot to add another — never more than
  // the column itself allows.
  const slots = Math.min(MAX_DISH_LABELS, custom.length + 1)

  return (
    <div className="flex flex-col gap-4">
      <fieldset
        aria-describedby={error === undefined ? 'maerkater-hjaelp' : 'maerkater-hjaelp maerkater-fejl'}
      >
        <legend className="text-meta text-neutral-ink mb-2 font-medium">
          Mærkater (valgfrit)
        </legend>

        <div className="flex flex-wrap gap-2">
          {STANDARD_DISH_LABELS.map((label) => (
            <label className="cursor-pointer" key={label}>
              <input
                className="peer sr-only"
                defaultChecked={selected.has(label)}
                name={fieldNames.standard}
                type="checkbox"
                value={label}
              />
              {/* The tick is a pseudo-element on the chip itself, so it is drawn by the
                  sibling selector `peer-checked` rather than by a nested element the
                  combinator could not reach — and it is decoration, so a screen reader
                  never reads it instead of the checkbox's own state. */}
              <span className="rounded-badge border-field-border text-neutral-ink peer-checked:bg-brand-700 peer-checked:border-brand-700 peer-checked:before:mr-1.5 peer-checked:before:content-['✓'] peer-focus-visible:outline-focus min-h-tap inline-flex items-center border px-4 text-meta font-medium peer-checked:font-semibold peer-checked:text-white peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2">
                {label}
              </span>
            </label>
          ))}
        </div>

        <p className="text-ink-3 text-micro mt-2" id="maerkater-hjaelp">
          {`Der er plads til ${MAX_DISH_LABELS} mærkater i alt — både de faste og jeres egne.`}
        </p>

        <FieldGroupError error={error} id="maerkater-fejl" />
      </fieldset>

      <fieldset aria-describedby="egne-maerkater-hjaelp">
        <legend className="text-meta text-neutral-ink mb-2 font-medium">
          Egne mærkater (valgfrit)
        </legend>

        <div className="flex flex-wrap gap-2">
          {Array.from({ length: slots }, (_, index) => {
            const id = `egen-maerkat-${String(index)}`

            return (
              <div key={id}>
                <label className="sr-only" htmlFor={id}>
                  {`Egen mærkat ${String(index + 1)}`}
                </label>
                <input
                  autoComplete="off"
                  className="rounded-badge bg-field-bg border-field-border text-ink min-h-tap w-40 border-[1.5px] px-4 text-meta"
                  defaultValue={custom[index] ?? ''}
                  id={id}
                  maxLength={MAX_CUSTOM_LABEL_LENGTH}
                  name={fieldNames.custom}
                  placeholder="Fx Pulled pork"
                  type="text"
                />
              </div>
            )
          })}
        </div>

        <p className="text-ink-3 text-micro mt-2" id="egne-maerkater-hjaelp">
          {`Korte ord, højst ${MAX_CUSTOM_LABEL_LENGTH} tegn — fx Pulled pork, Kylling eller Størst. Ryd feltet for at fjerne en mærkat.`}
        </p>
      </fieldset>
    </div>
  )
}
