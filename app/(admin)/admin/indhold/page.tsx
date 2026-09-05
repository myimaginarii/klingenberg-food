import Link from 'next/link'

import { requireStaff } from '@/lib/auth/guards'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { readEditableEntity, type EditableEntity } from '@/lib/publishing/editable'
import { previewTargetForEntity } from '@/lib/drafts/targets'

import { HOME_ADMIN_PATH } from '../forsiden/routes'
import { CONTACT_ADMIN_PATH } from '../kontakt/routes'
import { TAKEAWAY_ADMIN_PATH } from '../mad-ud-af-huset/routes'
import { RATE_LIMIT_MESSAGE, RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

import { AdminShell, Card, Notice, SubmitButton } from '../ui'
import { saveContentDraft } from './actions'
import { CONTENT_EDITORS, type ContentEditor } from './editors'

/**
 * Rediger indhold — technical plan §6, §15 (phase 4).
 *
 * PHASE 4 SCOPE. Small forms, one per entity still without an approved editor, built to
 * exercise the flow this phase exists to build rather than to be the approved editors:
 * saving to a draft, the Kladde badge, preview, and the version token that makes
 * concurrent edits safe. Since phase 11B only Om os is left here; Forsiden, Mad ud af
 * huset and Kontaktoplysninger have their own screens.
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

      {/* Forsiden (1u, phase 11A) and Kontaktoplysninger (1v, phase 11B) are the Owner's (§5). */}
      {profile.role === 'owner' ? (
        <p className="text-ink-2 text-meta">
          Forsiden rettes på sin egen side:{' '}
          <Link className="text-brand-700 underline" href={HOME_ADMIN_PATH}>
            Rediger forsiden
          </Link>
          . Kontaktoplysningerne ligeså:{' '}
          <Link className="text-brand-700 underline" href={CONTACT_ADMIN_PATH}>
            Kontaktoplysninger
          </Link>
          .
        </p>
      ) : null}
      {/* Mad ud af huset (1aj, phase 11B) has its own screen for Staff and Owner alike. */}
      <p className="text-ink-2 text-meta">
        Mad ud af huset rettes på sin egen side:{' '}
        <Link className="text-brand-700 underline" href={TAKEAWAY_ADMIN_PATH}>
          Mad ud af huset
        </Link>
        .
      </p>

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
    case RATE_LIMIT_STATUS:
      return <Notice tone="error">{RATE_LIMIT_MESSAGE}</Notice>
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
