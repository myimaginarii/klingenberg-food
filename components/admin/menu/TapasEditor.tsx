import { TapasGroupEditor, type TapasGroupForm, type TapasGroupView } from './TapasGroupEditor'

/**
 * Tapas-indhold — the three lists, beneath the ordinary dish fields (phase 5F).
 *
 * It is a card in the editor column, a sibling of the dish panel rather than something
 * inside it, for a reason that is mechanical before it is aesthetic: HTML forms do not
 * nest, and each list is its own form posting to its own Server Action. The dish panel
 * keeps its own Gem and its own six fields; this keeps three lists and nothing else.
 *
 * It appears **only** on the dish whose `details` holds a Tapas document. Every ordinary
 * dish reads `tapas: null` and gets no card at all, so there is nothing here to hide,
 * disable or explain away on the other forty entries of the menu.
 *
 * It is deliberately not a mini-application. There is no tab strip, no accordion, no
 * preview of the public board and no second navigation: three labelled lists, in the
 * order the public menu prints them, in the administration's own visual language.
 */
export function TapasEditor({
  anchorId,
  dishId,
  version,
  section,
  form,
  groups,
}: {
  anchorId: string
  dishId: string
  /** The version this screen was rendered from — optimistic concurrency (§6). */
  version: string
  /** The section chip a save should reopen. Navigation only. */
  section: string | null
  form: TapasGroupForm
  /**
   * The three lists, ready to render — text, messages and the anchors each comes back
   * to. Composed by `tapas-form.ts`, so this component decodes nothing and looks
   * nothing up.
   */
  groups: readonly TapasGroupView[]
}) {
  return (
    <section
      aria-labelledby={`${anchorId}-titel`}
      className="bg-surface border-border rounded-card-lg shadow-admin-card mt-4 border p-4 md:p-5"
      id={anchorId}
    >
      <h2 className="text-heading font-sans font-semibold" id={`${anchorId}-titel`}>
        Tapas-indhold
      </h2>

      <p className="text-ink-2 mt-1 text-meta">
        De tre lister på tapasbordet. Gæsten vælger ved bordet — her står kun, hvad der er
        at vælge imellem.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {groups.map((group) => (
          <TapasGroupEditor
            dishId={dishId}
            form={form}
            group={group}
            key={group.id}
            section={section}
            version={version}
          />
        ))}
      </div>

      <p className="text-ink-3 mt-4 text-micro">
        Hver liste gemmes for sig. Gem laver en kladde — hjemmesiden ændrer sig først, når
        du trykker Offentliggør ændringer.
      </p>
    </section>
  )
}
