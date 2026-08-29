import { notFound } from 'next/navigation'

import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { AvailabilityUndo } from '@/components/admin/menu/AvailabilityUndo'
import { CategoryChips } from '@/components/admin/menu/CategoryChips'
import { DishEditorPanel } from '@/components/admin/menu/DishEditorPanel'
import { DishList } from '@/components/admin/menu/DishList'
import { MenuPendingNotice } from '@/components/admin/menu/MenuPendingNotice'
import { MenuStatusNotice } from '@/components/admin/menu/MenuStatusNotice'
import { WeeklySpecialNotice } from '@/components/admin/menu/WeeklySpecialNotice'
import { requireStaff } from '@/lib/auth/guards'
import { readOpeningHours } from '@/lib/content/hours'
import { readAdminMenuContent } from '@/lib/content/menu-admin'
import {
  assignableCategories,
  describeAvailability,
  groupDishesBySection,
  mayHoldDishes,
} from '@/lib/menu/admin'
import { isMenuPublishable } from '@/lib/menu/pending'
import { readPendingChanges } from '@/lib/publishing/pending'
import type { IsoDate } from '@/lib/time/calendar'

import { setDishAvailability } from './availability-actions'
import { AVAILABILITY_FORM } from './availability-form'
import { createDish } from './create-actions'
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
import { EDITOR_ANCHOR, MENU_PARAM, menuHref } from './routes'
import { saveDishDraft } from './save-actions'

/**
 * Rediger menu — design 1r (desktop) and 1y (mobile); technical plan §6, §15 (phase 5).
 *
 * SCOPE. The list, the section navigation with its counts, the Kladde states, the
 * editor panel, creating a dish, moving one between sections, preview and publish
 * (phase 5B), plus the immediate Tilgængelig / Udsolgt control with its computed reset
 * label and its ~10-second Fortryd (phase 5C). Deliberately **not** here, and not
 * stubbed either: delete, drag-reorder, and the Tapas list editor. Each of those is its
 * own interaction with its own rules, and drawing an inert version of one would be
 * worse than not drawing it.
 *
 * THE TWO PATHS, SIDE BY SIDE
 *
 * Everything on this screen except the availability control writes a draft and waits
 * for Offentliggør (§6). The availability control writes the hjemmeside immediately and
 * offers Fortryd for about ten seconds. The distinction is drawn rather than explained:
 * a pending change puts its row in the warning tone and says what is waiting, and the
 * immediate change produces a green strip that says what is already live.
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
            restoreSoldOut={undoSoldOut === '1'}
            section={activeSection.category.slug}
            version={undoVersion}
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
                now={now}
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
            </div>
          ) : null}
        </div>
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
