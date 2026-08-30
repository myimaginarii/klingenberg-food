import { notFound } from 'next/navigation'

import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { AvailabilityUndo } from '@/components/admin/menu/AvailabilityUndo'
import { CategoryChips } from '@/components/admin/menu/CategoryChips'
import { DeleteDishDialog } from '@/components/admin/menu/DeleteDishDialog'
import { DeleteUndo } from '@/components/admin/menu/DeleteUndo'
import { DishEditorPanel } from '@/components/admin/menu/DishEditorPanel'
import { DishList } from '@/components/admin/menu/DishList'
import { TapasEditor } from '@/components/admin/menu/TapasEditor'
import { MenuPendingNotice } from '@/components/admin/menu/MenuPendingNotice'
import { MenuStatusNotice } from '@/components/admin/menu/MenuStatusNotice'
import { WeeklySpecialNotice } from '@/components/admin/menu/WeeklySpecialNotice'
import { requireStaff } from '@/lib/auth/guards'
import { readOpeningHours } from '@/lib/content/hours'
import {
  readAdminMenuContent,
  readDeletedDish,
  readHomeFeaturedDishIds,
} from '@/lib/content/menu-admin'
import {
  assignableCategories,
  describeAvailability,
  groupDishesBySection,
  mayHoldDishes,
} from '@/lib/menu/admin'
import { describeDishDeleted, describeDishDeletion } from '@/lib/menu/delete'
import { isMenuPublishable } from '@/lib/menu/pending'
import { describeAvailabilityChange } from '@/lib/menu/sold-out'
import { readPendingChanges } from '@/lib/publishing/pending'
import type { IsoDate } from '@/lib/time/calendar'

import { setDishAvailability } from './availability-actions'
import { AVAILABILITY_FORM } from './availability-form'
import { createDish } from './create-actions'
import { setDishDeletion } from './delete-actions'
import { DELETE_FORM } from './delete-form'
import {
  decodeDishErrors,
  DISH_ERROR_FIELD,
  DISH_ERROR_MESSAGES,
  DISH_FORM,
  dishFormValues,
  emptyDishForm,
  errorField,
  readDishForm,
  type DishErrorField,
} from './dish-form'
import { publishMenuChanges } from './publish-actions'
import { moveDishInSection } from './reorder-actions'
import { REORDER_FORM } from './reorder-form'
import {
  DELETE_BUTTON_ANCHOR,
  DELETE_DIALOG_ANCHOR,
  EDITOR_ANCHOR,
  MENU_PARAM,
  menuHref,
  TAPAS_ANCHOR,
} from './routes'
import { saveDishDraft } from './save-actions'
import { editTapasList } from './tapas-actions'
import { readTapasEcho, TAPAS_ACTION, TAPAS_FORM, tapasEditorGroups } from './tapas-form'

/**
 * Rediger menu — design 1r (desktop) and 1y (mobile); technical plan §6, §15 (phase 5).
 *
 * SCOPE. The list, the section navigation with its counts, the Kladde states, the
 * editor panel, creating a dish, moving one between sections, preview and publish
 * (phase 5B), the immediate Tilgængelig / Udsolgt control with its computed reset label
 * and its ~10-second Fortryd (phase 5C), Slet ret with its confirmation and its own
 * ~10-second Fortryd (phase 5D), and reordering the dishes inside one section — handle,
 * touch, keyboard and a no-JavaScript fallback — as an ordinary draft change (phase 5E).
 * and the Tapas list editor — three content lists on the one dish whose `details` holds
 * a Tapas document, each a form of its own, each an ordinary draft change (phase 5F).
 *
 * THE TWO PATHS, SIDE BY SIDE
 *
 * Everything on this screen except the availability control and Slet ret writes a draft
 * and waits for Offentliggør (§6) — **reordering included**: dragging a row changes the
 * administration's list and the preview, and changes nothing a guest can see until
 * somebody publishes. Those two write the hjemmeside immediately and offer
 * Fortryd for about ten seconds. The distinction is drawn rather than explained: a
 * pending change puts its row in the warning tone and says what is waiting, and an
 * immediate change produces a green strip that says what is already live.
 *
 * The two immediate operations are two implementations, not one parameterised one. They
 * share the green strip (`UndoStrip`) and the ten-second timer (`AutoDismiss`), because
 * those are presentation; they share nothing else. Each has its own Server Action, its
 * own strictly-parsed field names, its own database function and its own audit action,
 * so what either of them can and cannot do is answerable by reading one file.
 *
 * `requireStaff()` is called here, in the page. `proxy.ts` also redirects an
 * unauthenticated visitor, but that is convenience — this call is the enforcement (§5),
 * and every Server Action this screen posts to calls it again for itself.
 *
 * WHAT IS READ, AND FROM WHERE
 *
 *   * the menu, from `lib/content/menu-admin.ts` — uncached, through this person's own
 *     JWT, drafts merged in. Never the public cached read (§6);
 *   * what is pending, from the `pending_changes` view — so the Kladde count is the
 *     database's answer rather than something this screen counted;
 *   * the published opening hours, from the ordinary cached read, because whether a
 *     dish currently *reads* as sold out on the hjemmeside depends on the same
 *     published schedule the public menu uses (§7b). That is display, not editing, and
 *     using the same source is exactly what stops the two from disagreeing.
 *
 * All the state this screen has is in the URL (`./routes.ts`), so there is nothing in
 * the browser to keep in step with the server. The one client component on the screen
 * is `AutoDismiss`, and it holds no state of the menu's: it takes a server-rendered
 * message away after ten seconds and does nothing else (1aa). Everything that decides
 * anything — including whether a Fortryd is offered, and whether pressing it is allowed
 * — is decided on the server from the URL and the database.
 */

/**
 * The availability control's binding: the immediate action, and the field names it
 * reads.
 *
 * Declared here rather than imported by the components, because a component in
 * `components/` reaching into `app/` would be the dependency the wrong way round — the
 * same reason `DishEditorPanel` takes `fieldNames` instead of importing `DISH_FORM`.
 * One object, so a row's switch, the editor's block and the Fortryd strip all submit
 * to the same place under the same names.
 */
const AVAILABILITY_FORM_BINDING = {
  action: setDishAvailability,
  fieldNames: AVAILABILITY_FORM,
} as const

/**
 * The deletion path's binding: its own action, its own field names.
 *
 * Separate from the availability binding on purpose. The two immediate operations look
 * alike and are not the same operation, and keeping their vocabularies apart is what
 * makes a forged submission unable to cross from one to the other — a form carrying
 * `udsolgt` cannot reach the deletion action, and one carrying `slettet` cannot reach
 * the availability one.
 */
const DELETE_FORM_BINDING = {
  action: setDishDeletion,
  fieldNames: DELETE_FORM,
} as const

/**
 * The reorder path's binding: its own action, its own field names.
 *
 * A third vocabulary, kept apart from the other two for the same reason they are kept
 * apart from each other — a form carrying `til` cannot reach the deletion or the
 * availability action, and neither of theirs can reach this one. It is also the one of
 * the three that writes a **draft** rather than the hjemmeside, which is why it is bound
 * to `saveEntityDraft` through `reorder-actions.ts` and to no cache-expiring path at all.
 */
const REORDER_FORM_BINDING = {
  action: moveDishInSection,
  fieldNames: REORDER_FORM,
} as const

/**
 * The Tapas editor's binding: a fourth action, a fourth vocabulary (phase 5F).
 *
 * Kept apart from the other three for the reason they are kept apart from each other —
 * a form carrying `tapas_handling` cannot reach the availability, deletion or reorder
 * actions, and none of theirs can reach this one. Like the reorder, it writes a
 * **draft** and expires no cache tag at all.
 *
 * `values` travels with the field names because the button values and the parser that
 * reads them are one vocabulary: the component renders `TAPAS_ACTION.up(2)` and the
 * action decodes the same string, so the two cannot spell a move differently.
 */
const TAPAS_FORM_BINDING = {
  action: editTapasList,
  fieldNames: TAPAS_FORM,
  values: TAPAS_ACTION,
} as const


/** A repeated parameter is a malformed request, not two answers: take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export default async function MenuAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireStaff()

  const [params, menu, hours, pending] = await Promise.all([
    searchParams,
    readAdminMenuContent(),
    readOpeningHours(),
    readPendingChanges(),
  ])

  const sections = groupDishesBySection(menu.categories, menu.dishes)
  if (sections.length === 0) notFound()

  const requestedSlug = one(params[MENU_PARAM.section])
  const activeSection =
    sections.find((section) => section.category.slug === requestedSlug) ?? sections[0]

  /* v8 ignore next -- `sections` is non-empty, so index 0 exists. */
  if (activeSection === undefined) notFound()

  const editing = menu.dishes.find((dish) => dish.id === one(params[MENU_PARAM.dish]))
  const creating = one(params[MENU_PARAM.creating]) === '1'
  const editorOpen = editing !== undefined || creating

  // Errors and the values that produced them come back from a refused save in the
  // query string. Only codes this application defined survive `decodeDishErrors`, and
  // the values are re-read with the same parser the form is submitted through.
  const errors = decodeDishErrors(many(params[DISH_ERROR_FIELD]))
  const echoed = errors.length > 0 ? readDishForm(searchParamsOf(params)) : null

  // The same round trip for a refused Tapas save: which list, what was typed, and what
  // was wrong with it. Read by the module that wrote it, and only for the one group the
  // refusal was about — the other two always render from the document the server read.
  const tapasEcho = readTapasEcho(searchParamsOf(params))

  const errorFor = (field: DishErrorField): string | undefined => {
    const code = errors.find((candidate) => errorField(candidate) === field)
    return code === undefined ? undefined : DISH_ERROR_MESSAGES[code]
  }

  const menuPending = pending.filter((change) => isMenuPublishable(change.entity))
  const assignable = assignableCategories(menu.categories)
  const sectionHref = (slug: string): string => menuHref({ section: slug })

  // One clock for the whole render, so the list, the editor panel and the Fortryd strip
  // cannot resolve the same dish against three different instants.
  const now = new Date()

  const availabilityOf = (dish: (typeof menu.dishes)[number]) =>
    describeAvailability(dish.soldOutOn as IsoDate | null, hours.schedule, hours.overrides, now)

  // The Fortryd offer, entirely from the URL the action redirected to. The dish is
  // looked up here so the strip can name it — the query string carries an id, never a
  // sentence — and an id that names nothing produces no strip at all.
  const undoDish = menu.dishes.find((dish) => dish.id === one(params[MENU_PARAM.undoDish]))
  const undoVersion = one(params[MENU_PARAM.undoVersion])
  const undoSoldOut = one(params[MENU_PARAM.undoSoldOut])

  /*
   * The deletion confirmation, and the Fortryd a deletion leaves behind.
   *
   * Both are read from the URL and both are resolved against the database rather than
   * believed: the confirmation is rendered for a dish this person can actually see, and
   * the strip for a dish that is actually deleted. An id naming neither produces no
   * dialog and no strip — the same rule the availability strip follows.
   *
   * `readHomeFeaturedDishIds()` is asked only while the confirmation is open, and only
   * to decide whether one sentence appears. It reads the published Forside document
   * through this staff member's own JWT; it cannot, and does not, write to it.
   */
  const confirming = menu.dishes.find(
    (dish) => dish.id === one(params[MENU_PARAM.confirmDelete]),
  )

  // Two reads, each performed only when the screen state that needs it is on. They are
  // never both on — a confirmation address carries no Fortryd offer and the reverse —
  // so this is two conditional queries rather than one parallel pair.
  const featuredDishIds = confirming === undefined ? [] : await readHomeFeaturedDishIds()

  const undoDeleteId = one(params[MENU_PARAM.undoDeleteDish])
  const undoDeleteVersion = one(params[MENU_PARAM.undoDeleteVersion])
  const deletedDish = undoDeleteId === undefined ? null : await readDeletedDish(undoDeleteId)

  return (
    <>
      <AdminSectionBar backHref="/admin" title="Rediger menu">
        <BarLink href="/api/preview/start?maal=menu">Forhåndsvis</BarLink>
        <form action={publishMenuChanges}>
          <BarSubmit>
            <span className="md:hidden">Offentliggør</span>
            <span className="hidden md:inline">Offentliggør ændringer</span>
          </BarSubmit>
        </form>
      </AdminSectionBar>

      <div className="bg-surface border-border border-b">
        <div className="mx-auto flex max-w-content flex-col gap-3 px-gutter py-3 md:flex-row md:items-center md:justify-between md:px-8">
          <CategoryChips
            activeSlug={activeSection.category.slug}
            hrefFor={sectionHref}
            sections={sections}
          />

          {/*
            1r puts "+ Tilføj ret" beside the chips. 1y does not: on a phone the way to
            add a dish is the dashed row at the end of the list, where a person is
            already looking after reading it. So the bar's copy of the control is
            desktop-only rather than a full-width burgundy block above the menu.
          */}
          {mayHoldDishes(activeSection.category) ? (
            <a
              className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap hidden shrink-0 items-center justify-center px-5 font-semibold text-white md:inline-flex"
              href={menuHref({ section: activeSection.category.slug, creating: true })}
            >
              + Tilføj ret
            </a>
          ) : null}
        </div>
      </div>

      <main className="mx-auto flex max-w-content flex-col gap-4 px-gutter py-6 md:px-8">
        <MenuStatusNotice status={one(params[MENU_PARAM.status])} />

        {/*
          1r draws this strip inside the list and 1y at the foot of the phone screen.
          It is rendered once, here, so it is on screen at both widths without
          scrolling — a message that lasts ten seconds should not have to be looked for.
        */}
        {undoDish === undefined || undoVersion === undefined || undoSoldOut === undefined ? null : (
          <AvailabilityUndo
            dishId={undoDish.id}
            dishName={undoDish.name}
            editorOpen={editing?.id === undoDish.id}
            form={AVAILABILITY_FORM_BINDING}
            // The strip reports what just happened, which is the opposite of what
            // Fortryd would restore.
            message={describeAvailabilityChange({
              dishName: undoDish.name,
              soldOut: undoSoldOut !== '1',
            })}
            restoreSoldOut={undoSoldOut === '1'}
            section={activeSection.category.slug}
            version={undoVersion}
          />
        )}

        {/*
          The deletion's own Fortryd strip. The dish it names is no longer in the list —
          `readAdminMenuContent` excludes deleted dishes — so it is read by id, and the
          sentence it carries is composed by the same module that composed the question
          the person answered a moment ago.
        */}
        {deletedDish === null || undoDeleteVersion === undefined ? null : (
          <DeleteUndo
            dishId={deletedDish.id}
            dishName={deletedDish.name}
            form={DELETE_FORM_BINDING}
            message={describeDishDeleted({
              dishName: deletedDish.name,
              isNewDraft: deletedDish.isNewDraft,
            })}
            section={activeSection.category.slug}
            version={undoDeleteVersion}
          />
        )}

        <MenuPendingNotice action={publishMenuChanges} pending={menuPending} />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
          {/*
            On a phone the editor *is* the screen (1y): the list steps aside rather than
            being squeezed beside a panel. From `md` up both are on screen at once, which
            is 1r's side panel.
          */}
          <div className={`min-w-0 lg:flex-[1.35] ${editorOpen ? 'hidden md:block' : ''}`}>
            {mayHoldDishes(activeSection.category) ? (
              <DishList
                availabilityForm={AVAILABILITY_FORM_BINDING}
                createHref={menuHref({ section: activeSection.category.slug, creating: true })}
                hours={hours}
                hrefForDish={(dishId) =>
                  menuHref({ section: activeSection.category.slug, dish: dishId })
                }
                movedDishId={one(params[MENU_PARAM.movedDish])}
                now={now}
                reorderForm={REORDER_FORM_BINDING}
                section={activeSection}
              />
            ) : (
              <WeeklySpecialNotice categoryName={activeSection.category.name} />
            )}
          </div>

          {editorOpen ? (
            <div className="min-w-0 lg:flex-1">
              {editing === undefined ? (
                <DishEditorPanel
                  action={createDish}
                  anchorId={EDITOR_ANCHOR}
                  categories={assignable}
                  closeHref={sectionHref(activeSection.category.slug)}
                  errorFor={errorFor}
                  fieldNames={DISH_FORM}
                  heading="Ny ret"
                  values={echoed ?? emptyDishForm(activeSection.category.id)}
                />
              ) : (
                <DishEditorPanel
                  action={saveDishDraft}
                  anchorId={EDITOR_ANCHOR}
                  availability={availabilityOf(editing)}
                  availabilityForm={AVAILABILITY_FORM_BINDING}
                  categories={assignable}
                  closeHref={sectionHref(activeSection.category.slug)}
                  deleteAnchorId={DELETE_BUTTON_ANCHOR}
                  deleteHref={menuHref({
                    section: activeSection.category.slug,
                    dish: editing.id,
                    confirmDelete: editing.id,
                  })}
                  dishId={editing.id}
                  dishName={editing.name}
                  errorFor={errorFor}
                  fieldNames={DISH_FORM}
                  heading="Ret"
                  isNewDraft={editing.isNewDraft}
                  section={activeSection.category.slug}
                  values={echoed ?? dishFormValues(editing)}
                  version={editing.updatedAt}
                />
              )}

              {/*
                Tapas-indhold, on the one dish that has a Tapas document and on no other
                (phase 5F). It is a sibling of the panel rather than part of it: HTML
                forms do not nest, and each list is its own form posting to its own
                Server Action — the same reason the availability block sits outside the
                panel's form.
              */}
              {editing === undefined || editing.tapas === null ? null : (
                <TapasEditor
                  anchorId={TAPAS_ANCHOR}
                  dishId={editing.id}
                  form={TAPAS_FORM_BINDING}
                  groups={tapasEditorGroups(editing.tapas, tapasEcho)}
                  section={activeSection.category.slug}
                  version={editing.updatedAt}
                />
              )}
            </div>
          ) : null}
        </div>

        {/*
          The confirmation. It is a `<dialog>`, so with JavaScript it is modal — focus
          moves in, focus is trapped, and clicking outside does not dismiss it (1ae) —
          and without JavaScript it is an ordinary block at the end of the screen, which
          the Slet ret link's own `#slet-bekraeft` fragment scrolls to. Either way the
          deletion itself is a form somebody has to submit.

          It is rendered here rather than inside the editor column so that a person who
          arrives at `?slet=…` directly still meets a complete, operable confirmation
          rather than one that depends on the panel being open.
        */}
        {confirming === undefined ? null : (
          <DeleteDishDialog
            anchorId={DELETE_DIALOG_ANCHOR}
            cancelHref={menuHref({
              section: activeSection.category.slug,
              dish: confirming.id,
              focusDelete: true,
            })}
            dishId={confirming.id}
            dishName={confirming.name}
            form={DELETE_FORM_BINDING}
            prompt={describeDishDeletion({
              dishName: confirming.name,
              isNewDraft: confirming.isNewDraft,
              featuredOnHomepage: featuredDishIds.includes(confirming.id),
            })}
            section={activeSection.category.slug}
            version={confirming.updatedAt}
          />
        )}
      </main>
    </>
  )
}

/**
 * The route's own search parameters as a `URLSearchParams`, so the echoed values can be
 * read back by exactly the function that submitted them (`readDishForm`).
 *
 * Repeated parameters — the custom labels, the error codes — are preserved, which is
 * why this is built by hand rather than by `new URLSearchParams(params)`.
 */
function searchParamsOf(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    for (const item of many(value)) search.append(key, item)
  }

  return search
}
