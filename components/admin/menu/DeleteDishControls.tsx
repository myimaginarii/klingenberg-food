import Link from 'next/link'

/**
 * Slet ret — the control, and the fields every deletion submission carries.
 *
 * Design 1r draws "Slet ret" in the editor panel's footer row, on the left, in the
 * error tone, opposite Fortryd and Gem: a 46 px control with a red border and red text.
 * 1y draws the same row on the phone. The note beneath the frame states the whole rule:
 * *"Slet spørger altid: 'Slet Odin? Den forsvinder fra hjemmesiden.' — og kan fortrydes
 * i 10 sekunder bagefter."*
 *
 * WHY IT IS A LINK AND NOT A BUTTON
 *
 * Pressing it must not delete anything. Making it a link rather than a submit means the
 * destructive step *cannot* happen in one press — not because a script intercepts it,
 * but because navigating to a confirmation is all the control does. The deletion is a
 * separate form, on the confirmation, with its own submit. That holds with JavaScript
 * switched off, with a script error on the page, and with a double-tap on a phone.
 *
 * It also keeps the editor's markup honest: forms cannot nest, and Gem's form writes a
 * draft while this writes the hjemmeside immediately (§6). The availability control
 * solves the same problem by being a sibling form; this one solves it by not being a
 * form at all.
 *
 * The fields below are shared by the confirmation's own submit and by the Fortryd strip,
 * so a deletion and its undo cannot come to disagree about what a deletion submission
 * looks like — the same reason `AvailabilityFields` exists.
 */

/**
 * Where a deletion submission goes, and under which names.
 *
 * Passed in rather than imported: a component in `components/` reaching into `app/`
 * would be the dependency the wrong way round, and the screen that owns the action owns
 * the vocabulary it reads, in one file.
 */
export type DeleteForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly dishId: string
    readonly version: string
    readonly deleted: string
    readonly section: string
  }
}

/**
 * The hidden fields a deletion or a restore carries.
 *
 * `deleted` is the state being *asked for*. There is no field for anything else about
 * the dish, and none for whether it is featured on Forsiden: that is the server's to
 * determine from the published Forside document, and it decides a sentence rather than
 * a permission.
 */
export function DeleteFields({
  fieldNames,
  dishId,
  version,
  deleted,
  section,
}: {
  fieldNames: DeleteForm['fieldNames']
  dishId: string
  version: string
  deleted: boolean
  section?: string | null
}) {
  return (
    <>
      <input name={fieldNames.dishId} type="hidden" value={dishId} />
      <input name={fieldNames.version} type="hidden" value={version} />
      <input name={fieldNames.deleted} type="hidden" value={deleted ? '1' : '0'} />
      {section ? <input name={fieldNames.section} type="hidden" value={section} /> : null}
    </>
  )
}

/**
 * The editor panel's Slet ret control (1r footer row).
 *
 * Its accessible name carries the dish, so a screen reader meeting it in a panel that
 * looks like every other panel is told *which* dish this would remove. `id` is the
 * anchor the confirmation's Behold-knap navigates back to, which is how cancelling
 * returns the person — and the keyboard — to the control they came from.
 */
export function DeleteDishLink({
  href,
  dishName,
  anchorId,
}: {
  href: string
  dishName: string
  anchorId: string
}) {
  return (
    <Link
      className="rounded-field border-error text-error-ink hover:bg-error-surface min-h-tap inline-flex items-center border-[1.5px] px-4 font-semibold"
      href={href}
      id={anchorId}
    >
      Slet ret
      <span className="sr-only"> — {dishName}</span>
    </Link>
  )
}
