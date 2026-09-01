import { AdminSectionBar, BarLink } from '@/components/admin/menu/AdminSectionBar'
import { NewsAdminList, type NewsAdminRow } from '@/components/admin/news/NewsAdminList'
import { NewsConfirmDialog } from '@/components/admin/news/NewsConfirmDialog'
import { NewsEditorForm } from '@/components/admin/news/NewsEditorForm'
import { NewsStateBadge } from '@/components/admin/news/NewsStateBadge'
import { NewsStatusNotice } from '@/components/admin/news/NewsStatusNotice'
import { requireStaff } from '@/lib/auth/guards'
import {
  readAdminArticle,
  readAdminNewsList,
  type AdminNewsArticle,
} from '@/lib/content/news-admin'
import {
  describeArticleAddress,
  describeDelete,
  describeNewsState,
  describePublish,
  describeSaveConsequence,
  describeUnpublish,
} from '@/lib/news/lifecycle'
import { NEWS_CATEGORIES } from '@/lib/schemas/news'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

import {
  decodeNewsErrors,
  emptyNewsForm,
  errorField,
  NEWS_ERROR_FIELD,
  NEWS_ERROR_MESSAGES,
  NEWS_FORM,
  newsFormValues,
  readNewsForm,
  type NewsErrorField,
} from './article-form'
import { deleteArticle } from './delete-actions'
import { publishArticle, unpublishArticle } from './publish-actions'
import {
  DELETE_BUTTON_ANCHOR,
  DELETE_DIALOG_ANCHOR,
  EDITOR_ANCHOR,
  NEWS_PARAM,
  newsHref,
  PUBLISH_BUTTON_ANCHOR,
  PUBLISH_DIALOG_ANCHOR,
  UNPUBLISH_BUTTON_ANCHOR,
  UNPUBLISH_DIALOG_ANCHOR,
} from './routes'
import { createArticle, saveArticle } from './save-actions'

/**
 * Nyheder — design 1s (editor, desktop) and 1z (list + editor, mobile); technical
 * plan §4, §6, §7f, §15 (phase 9A).
 *
 * SCOPE. The list, creating an article, editing one, publishing it per item through
 * 1s's confirmation, §7f's "Fjern fra hjemmesiden", and 1s's Slet with the 1r rule
 * (it always asks). Images are phase 10 — the editor renders the approved
 * non-functional slot and nothing else. The B/Link toolbar, autosave and the
 * `NewsArticle` JSON-LD are phase 9B.
 *
 * THE MODEL, ON ONE SCREEN
 *
 * News has no `draft` column (§4): an article is pending while `status = 'draft'`,
 * and an edit writes the row itself. The screen says that everywhere it matters —
 * the list's pill and date line, the badge in the bar, the sentence beside Gem
 * (`describeSaveConsequence`), and the two different save notices — because "a
 * published article's edit is live when saved" is the one thing about this model a
 * person must never have to discover.
 *
 * All the state this screen has is in the URL (`./routes.ts`): which article is
 * open, whether a new one is being written, which confirmation is on screen, what
 * the last action did, and what a refused save echoed back. There is nothing in the
 * browser to keep in step with the server, and the whole screen works with
 * JavaScript off — the confirmations are server-rendered blocks that scripting
 * promotes to modal dialogs (`ModalDialog`).
 *
 * `requireStaff()` is called here, in the page: news is Staff *and* Owner (§5), and
 * every Server Action this screen posts to calls it again for itself, with RLS
 * re-deciding underneath (§5, §8).
 */

/** A repeated parameter is a malformed request, not two answers: take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function searchParamsOf(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    for (const item of many(value)) search.append(key, item)
  }

  return search
}

export default async function NewsAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireStaff()

  const [params, articles] = await Promise.all([searchParams, readAdminNewsList()])

  const status = one(params[NEWS_PARAM.status])
  const creating = one(params[NEWS_PARAM.creating]) === '1'
  const editingId = one(params[NEWS_PARAM.article])

  const editing = editingId === undefined ? null : await readAdminArticle(editingId)
  const editorOpen = creating || editing !== null

  // Errors and the values that produced them come back from a refused save in the
  // query string. Only codes this application defined survive `decodeNewsErrors`, and
  // the values are re-read by the same parser the form is submitted through. A
  // conflict echoes too, so nothing typed is lost while the person compares versions.
  const errors = decodeNewsErrors(many(params[NEWS_ERROR_FIELD]))
  const echoed =
    errors.length > 0 || status === 'konflikt' ? readNewsForm(searchParamsOf(params)) : null

  const errorFor = (field: NewsErrorField): string | undefined => {
    const code = errors.find((candidate) => errorField(candidate) === field)
    return code === undefined ? undefined : NEWS_ERROR_MESSAGES[code]
  }

  // The one open confirmation, resolved against the server's own read — an id naming
  // nothing, or naming an article in the wrong state, produces no dialog at all.
  const confirmPublishId = one(params[NEWS_PARAM.confirmPublish])
  const confirmUnpublishId = one(params[NEWS_PARAM.confirmUnpublish])
  const confirmDeleteId = one(params[NEWS_PARAM.confirmDelete])

  const articleFor = async (id: string | undefined): Promise<AdminNewsArticle | null> => {
    if (id === undefined) return null
    if (editing !== null && editing.id === id) return editing
    return readAdminArticle(id)
  }

  const confirmingPublish = await articleFor(confirmPublishId)
  const confirmingUnpublish = confirmingPublish === null ? await articleFor(confirmUnpublishId) : null
  const confirmingDelete =
    confirmingPublish === null && confirmingUnpublish === null
      ? await articleFor(confirmDeleteId)
      : null

  /*
   * The confirmations are rendered whichever half of the screen is open, so a person
   * who arrives at `?slet=…` directly still meets a complete, operable confirmation
   * (the menu screen's own rule). Each renders only for an article the server
   * resolved, in a state the transition applies to — anything else is no dialog.
   */
  const dialogs = (
    <>
      {confirmingPublish === null || confirmingPublish.status !== 'draft' ? null : (
        <NewsConfirmDialog
          action={publishArticle}
          anchorId={PUBLISH_DIALOG_ANCHOR}
          articleId={confirmingPublish.id}
          articleTitle={confirmingPublish.title}
          cancelHref={newsHref({ article: confirmingPublish.id, focus: 'publish' })}
          cancelLabel="Tilbage"
          fieldNames={NEWS_FORM}
          prompt={describePublish(confirmingPublish.title)}
          version={confirmingPublish.updatedAt}
        />
      )}

      {confirmingUnpublish === null || confirmingUnpublish.status !== 'published' ? null : (
        <NewsConfirmDialog
          action={unpublishArticle}
          anchorId={UNPUBLISH_DIALOG_ANCHOR}
          articleId={confirmingUnpublish.id}
          articleTitle={confirmingUnpublish.title}
          cancelHref={newsHref({ article: confirmingUnpublish.id, focus: 'unpublish' })}
          cancelLabel="Behold den på hjemmesiden"
          destructive
          fieldNames={NEWS_FORM}
          prompt={describeUnpublish(confirmingUnpublish.title)}
          version={confirmingUnpublish.updatedAt}
        />
      )}

      {confirmingDelete === null ? null : (
        <NewsConfirmDialog
          action={deleteArticle}
          anchorId={DELETE_DIALOG_ANCHOR}
          articleId={confirmingDelete.id}
          articleTitle={confirmingDelete.title}
          cancelHref={newsHref({ article: confirmingDelete.id, focus: 'delete' })}
          cancelLabel="Behold nyheden"
          destructive
          fieldNames={NEWS_FORM}
          prompt={describeDelete(confirmingDelete)}
          version={confirmingDelete.updatedAt}
        />
      )}
    </>
  )

  if (editorOpen) {
    const heading = editing === null ? 'Ny nyhed' : 'Rediger nyhed'
    const todayIso = copenhagenDateOf(new Date())

    return (
      <>
        <AdminSectionBar backHref={newsHref()} backLabel="Nyheder" title={heading}>
          {editing === null ? null : <NewsStateBadge state={describeNewsState(editing)} />}
        </AdminSectionBar>

        <main className="mx-auto flex w-full max-w-[52rem] flex-col gap-4 px-gutter py-6 md:px-8">
          <NewsStatusNotice status={status} />

          {editing === null ? (
            <NewsEditorForm
              action={createArticle}
              address={null}
              anchorId={EDITOR_ANCHOR}
              categories={NEWS_CATEGORIES}
              consequence={describeSaveConsequence('draft')}
              errorFor={errorFor}
              fieldNames={NEWS_FORM}
              heading={heading}
              saveLabel="Gem kladde"
              values={echoed ?? emptyNewsForm(todayIso)}
            />
          ) : (
            <>
              <NewsEditorForm
                action={saveArticle}
                address={describeArticleAddress(editing)}
                anchorId={EDITOR_ANCHOR}
                articleId={editing.id}
                categories={NEWS_CATEGORIES}
                consequence={describeSaveConsequence(editing.status)}
                errorFor={errorFor}
                fieldNames={NEWS_FORM}
                heading={heading}
                saveLabel={editing.status === 'published' ? 'Gem ændringer' : 'Gem kladde'}
                values={echoed ?? newsFormValues(editing)}
                version={editing.updatedAt}
              />

              {/*
                1s's footer row: Slet on the left, the way to the hjemmeside on the
                right. Every control here is a **link** — pressing one navigates to a
                confirmation or a preview, and nothing has happened yet. The publish
                and removal themselves are forms inside the confirmations, carrying
                the version token the server just rendered.
              */}
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <a
                  className="rounded-field border-error text-error-ink hover:bg-error-surface bg-surface inline-flex min-h-tap items-center justify-center border-[1.5px] px-4 font-semibold"
                  href={newsHref({ article: editing.id, confirmDelete: editing.id })}
                  id={DELETE_BUTTON_ANCHOR}
                >
                  Slet
                </a>

                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <a
                    className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section bg-surface inline-flex min-h-tap items-center justify-center border-[1.5px] px-4 font-semibold"
                    href={`/api/preview/start?maal=nyhed&slug=${editing.slug}`}
                  >
                    Forhåndsvis på hjemmesiden
                  </a>

                  {editing.status === 'published' ? (
                    <a
                      className="rounded-field border-error text-error-ink hover:bg-error-surface bg-surface inline-flex min-h-tap items-center justify-center border-[1.5px] px-4 font-semibold"
                      href={newsHref({ article: editing.id, confirmUnpublish: editing.id })}
                      id={UNPUBLISH_BUTTON_ANCHOR}
                    >
                      Fjern fra hjemmesiden
                    </a>
                  ) : (
                    <a
                      className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field inline-flex min-h-tap items-center justify-center px-6 font-semibold text-white"
                      href={newsHref({ article: editing.id, confirmPublish: editing.id })}
                      id={PUBLISH_BUTTON_ANCHOR}
                    >
                      Offentliggør
                    </a>
                  )}
                </div>
              </div>
            </>
          )}

          {dialogs}
        </main>
      </>
    )
  }

  const rows: NewsAdminRow[] = articles.map((article) => ({
    id: article.id,
    title: article.title,
    href: newsHref({ article: article.id }),
    state: describeNewsState(article),
  }))

  return (
    <>
      <AdminSectionBar backHref="/admin" backLabel="Tilbage" title="Nyheder">
        <BarLink href="/api/preview/start?maal=nyheder">Forhåndsvis</BarLink>
        {/*
          1z's "+ Ny" — the bar's one filled control, drawn like every other screen's
          BarSubmit but a link: opening the editor is a navigation, and nothing has
          been created yet when it opens.
        */}
        <a
          className="rounded-field text-brand-700 inline-flex min-h-tap items-center bg-white px-4 text-meta font-semibold hover:bg-brand-50"
          href={newsHref({ creating: true })}
        >
          + Ny nyhed
        </a>
      </AdminSectionBar>

      <main className="mx-auto flex w-full max-w-[52rem] flex-col gap-4 px-gutter py-6 md:px-8">
        <NewsStatusNotice status={status} />

        <p className="text-ink-2 text-meta">
          Nyheder på hjemmesiden — lukkedage, nye retter og andet nyt. Kladder er kun
          synlige her, indtil de offentliggøres.
        </p>

        <NewsAdminList createHref={newsHref({ creating: true })} rows={rows} />

        {dialogs}
      </main>
    </>
  )
}
