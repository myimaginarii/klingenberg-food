import Link from 'next/link'

import { requireStaff } from '@/lib/auth/guards'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { readEditableEntity, type EditableEntity } from '@/lib/publishing/editable'
import { previewTargetForEntity } from '@/lib/drafts/targets'

import { HOME_ADMIN_PATH } from '../forsiden/routes'
import { AdminShell, Card, Notice, SubmitButton } from '../ui'
import { saveContentDraft } from './actions'
import { CONTENT_EDITORS, type ContentEditor } from './editors'

/**
 * Rediger indhold — technical plan §6, §15 (phase 4).
 *
 * PHASE 4 SCOPE. Four small forms, one per entity, built to exercise the flow this
 * phase exists to build rather than to be the approved editors: saving to a draft, the
 * Kladde badge, preview, the version token that makes concurrent edits safe, and the
 * Owner-only refusal a Staff member sees rather than a silent no-op.
 *
 * An entity a person may not change is listed and locked rather than hidden, so the
 * administration looks the same to everybody and the difference is explained. The
 * server refuses it in any case: `saveEntityDraft` re-checks the role, and RLS re-checks
 * it again through the caller's own JWT.
 */
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; felt?: string; besked?: string }>
}) {
  const profile = await requireStaff()
  const params = await searchParams

  const loaded = await Promise.all(
    CONTENT_EDITORS.map(async (editor) => ({
      editor,
      entity: await readEditableEntity(editor.entity),
    })),
  )

  return (
    <AdminShell eyebrow="Indhold" title="Rediger indhold">
      <SaveReport status={params.status} message={params.besked} />

      <p className="text-ink-2 text-meta">
        Alt hvad du gemmer her er en kladde. Den offentlige side ændrer sig først, når
        ændringen offentliggøres fra{' '}
        <Link className="text-brand-700 underline" href="/admin">
          Oversigt
        </Link>
        .
      </p>

      {/* Forsiden has its own screen since phase 11A (1u); it is the Owner's (§5). */}
      {profile.role === 'owner' ? (
        <p className="text-ink-2 text-meta">
          Forsiden rettes på sin egen side:{' '}
          <Link className="text-brand-700 underline" href={HOME_ADMIN_PATH}>
            Rediger forsiden
          </Link>
          .
        </p>
      ) : null}

      {loaded.map(({ editor, entity }) => (
        <EntityEditor
          key={editor.entity}
          editor={editor}
          entity={entity}
          canEdit={mayChangeEntity(editor.entity, profile)}
        />
      ))}
    </AdminShell>
  )
}

function SaveReport({ status, message }: { status?: string; message?: string }) {
  if (status === undefined) return null

  switch (status) {
    case 'saved':
      return <Notice tone="success">Kladden er gemt. Den er ikke live endnu.</Notice>
    case 'conflict':
      return (
        <Notice tone="warning">
          Nogen andre har rettet dette. Din ændring blev ikke gemt — hent siden igen, så
          du retter i den nyeste version.
        </Notice>
      )
    case 'forbidden':
      return <Notice tone="error">Kun ejeren kan rette dette.</Notice>
    case 'invalid':
      return <Notice tone="error">{message ?? 'Kladden kunne ikke gemmes.'}</Notice>
    case 'not_found':
      return <Notice tone="error">Indholdet findes ikke længere.</Notice>
    default:
      return <Notice tone="error">Kladden kunne ikke gemmes. Prøv igen.</Notice>
  }
}

function EntityEditor({
  editor,
  entity,
  canEdit,
}: {
  editor: ContentEditor
  entity: EditableEntity | null
  canEdit: boolean
}) {
  return (
    <Card>
      <h2 className="text-heading font-semibold" id={editor.entity}>
        {editor.heading}
      </h2>
      <p className="text-ink-2 text-meta mt-2">{editor.description}</p>

      {entity === null ? (
        <p className="text-ink-2 text-meta mt-4">Indholdet kunne ikke hentes.</p>
      ) : (
        <>
          <p className="text-meta mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            {entity.hasDraft ? (
              <span className="text-warning-ink font-medium">
                <span aria-hidden="true">● </span>Kladde — ikke offentliggjort
              </span>
            ) : (
              <span className="text-ink-2">
                <span aria-hidden="true">● </span>Ingen kladde — alt er live
              </span>
            )}

            <a
              className="text-brand-700 min-h-tap inline-flex items-center underline"
              href={`/api/preview/start?maal=${previewTargetForEntity(editor.entity)}`}
            >
              Forhåndsvis
            </a>
          </p>

          {entity.draftMalformed ? (
            <div className="mt-3">
              <Notice tone="error">
                Den gemte kladde kan ikke læses og bliver ikke vist. Gem felterne igen
                for at erstatte den.
              </Notice>
            </div>
          ) : null}

          <form
            action={saveContentDraft}
            aria-label={`Rediger ${editor.heading}`}
            className="mt-4 flex flex-col gap-4"
          >
            <input type="hidden" name="entity" value={editor.entity} />
            <input type="hidden" name="version" value={entity.updatedAt} />

            {editor.fields.map((field) => {
              const fieldId = `${editor.entity}-${field.name}`
              const current = field.current(entity.values)

              return (
                <label className="flex flex-col gap-1" key={field.name} htmlFor={fieldId}>
                  <span className="text-meta text-neutral-ink font-medium">{field.label}</span>
                  {field.multiline ? (
                    <textarea
                      id={fieldId}
                      name={field.name}
                      rows={3}
                      defaultValue={current}
                      disabled={!canEdit}
                      className="bg-field-bg border-field-border rounded-field border p-3"
                    />
                  ) : (
                    <input
                      id={fieldId}
                      name={field.name}
                      type="text"
                      defaultValue={current}
                      disabled={!canEdit}
                      className="bg-field-bg border-field-border rounded-field min-h-tap border px-3"
                    />
                  )}
                </label>
              )
            })}

            {canEdit ? (
              <div>
                <SubmitButton>Gem kladde</SubmitButton>
              </div>
            ) : (
              <p className="text-warning-ink text-meta font-medium">
                <span aria-hidden="true">● </span>Kun ejeren kan rette dette.
              </p>
            )}
          </form>
        </>
      )}
    </Card>
  )
}
