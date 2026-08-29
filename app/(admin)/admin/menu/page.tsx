import { notFound } from 'next/navigation'

import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { CategoryChips } from '@/components/admin/menu/CategoryChips'
import { DishEditorPanel } from '@/components/admin/menu/DishEditorPanel'
import { DishList } from '@/components/admin/menu/DishList'
import { MenuPendingNotice } from '@/components/admin/menu/MenuPendingNotice'
import { MenuStatusNotice } from '@/components/admin/menu/MenuStatusNotice'
import { WeeklySpecialNotice } from '@/components/admin/menu/WeeklySpecialNotice'
import { requireStaff } from '@/lib/auth/guards'
import { readOpeningHours } from '@/lib/content/hours'
import { readAdminMenuContent } from '@/lib/content/menu-admin'
import { assignableCategories, groupDishesBySection, mayHoldDishes } from '@/lib/menu/admin'
import { isMenuPublishable } from '@/lib/menu/pending'
import { readPendingChanges } from '@/lib/publishing/pending'

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
 * PHASE 5B SCOPE. The list, the section navigation with its counts, the Kladde states,
 * the editor panel, creating a dish, moving one between sections, preview and publish.
 * Deliberately **not** here, and not stubbed either: the immediate Udsolgt toggle with
 * its 10-second Fortryd, delete, drag-reorder, and the Tapas list editor. Each of those
 * is its own interaction with its own rules, and drawing an inert version of one would
 * be worse than showing the state it already has.
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
 * All the state this screen has is in the URL (`./routes.ts`), so there is no client
 * component, no client state and nothing to keep in step with the server.
 */

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
                createHref={menuHref({ section: activeSection.category.slug, creating: true })}
                hours={hours}
                hrefForDish={(dishId) =>
                  menuHref({ section: activeSection.category.slug, dish: dishId })
                }
                now={new Date()}
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
                  categories={assignable}
                  closeHref={sectionHref(activeSection.category.slug)}
                  dishId={editing.id}
                  errorFor={errorFor}
                  fieldNames={DISH_FORM}
                  heading="Ret"
                  isNewDraft={editing.isNewDraft}
                  soldOut={editing.soldOutOn !== null}
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
