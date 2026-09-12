import {
  BURGER_MENU_SECTION_ID,
  MENU_CATEGORY_KINDS,
  TAPAS_GROUP_IDS,
  TAPAS_GROUP_MODES,
  type MenuCategoryKind,
} from '@/lib/content/types'
import { WEEKDAY_KEYS } from '@/lib/time/calendar'

import {
  array,
  date,
  flag,
  isAbsent,
  isBlank,
  object,
  oneOf,
  photo,
  price,
  slug,
  text,
  unique,
  uniqueTexts,
  whole,
} from './fields'
import { add, at, readableName, type Problem } from './problems'

/**
 * What a usable menu is — `menu.json`, `tapas.json`, `weekly-special.json`,
 * `monthly-burger.json`.
 *
 * Every rule here is one the *renderer* actually depends on. The restaurant is meant
 * to add and remove dishes, add and remove sections, change every price and reorder
 * the whole card without asking anybody, so nothing about today's menu is written
 * down: not nine sections, not forty-six dishes, not a name, not a price, not an
 * order. Those are regression expectations for the migration and live where they
 * belong, in `tests/unit/content/static-site.test.ts`.
 *
 * WHAT IS ACTUALLY REQUIRED, and why each one is not an opinion:
 *
 *   * **A section id is an address.** `lib/menu/view.ts` makes it the anchor
 *     `#menu-<id>` that the sticky category bar links to, so it has to be a slug and
 *     it has to be unique — two sections sharing one id give the bar two chips that
 *     jump to the same place.
 *   * **A dish id is an identity.** React keys every card by it, on the menu and in
 *     the Forside's "Tre fra menuen" band. Uniqueness is checked across the whole
 *     document rather than within one section, because both surfaces draw from the
 *     whole menu.
 *   * **`kind` and the tapas vocabulary are closed sets** the renderer switches on.
 *     A name outside them silently produces the wrong body.
 *   * **A section whose body is another document holds no dishes, and there is at most
 *     one of it.** `weekly_special` draws Ugens ret and `tapas` draws the board;
 *     `MenuCategorySection` replaces the whole section body in both cases, so a dish
 *     left in such a section is a dish nobody would ever see, and a second such
 *     section would print the same one document twice. Zero of either is allowed —
 *     removing the section removes that body from the menu, which the renderer
 *     handles by drawing nothing. Neither restriction is fixed here: lifting one
 *     means changing the renderer.
 *   * **One section id is reserved.** `BURGER_MENU_SECTION_ID` is the section Månedens
 *     burger is drawn at the end of, and the one section whose intro has its prices
 *     joined to "kr." Both address it by id, so a menu without that id is a menu that
 *     silently lost Månedens burger. This is the only id written down anywhere: it is
 *     a requirement the application really has, not today's menu being frozen, and no
 *     other section's id is checked against anything but the slug grammar.
 *
 * A section with no dishes is deliberately fine: `ugens-ret` has none today, and an
 * editor building a new section starts from an empty one. "No dishes" is written two
 * ways — `"dishes": []` by hand, and no `dishes` key at all by Pages CMS, which leaves
 * an empty list out of the file — and both are the same section.
 */

/**
 * The two section kinds whose body is one other document, and which document that is.
 *
 * Written once because three rules read it: a section of this kind holds no dishes,
 * there is at most one of it, and the sentence a mistake gets has to name the file the
 * restaurant would go and edit instead.
 */
type SingleDocumentKind = Exclude<MenuCategoryKind, 'dishes'>

const SINGLE_DOCUMENT_BODIES: Record<SingleDocumentKind, { what: string; file: string }> = {
  weekly_special: { what: 'Ugens ret', file: 'content/site/weekly-special.json' },
  tapas: { what: 'tapasbordet', file: 'content/site/tapas.json' },
}

export function validateMenu(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  text(problems, at(where, 'allergenNote'), document.allergenNote)

  const categories = array(problems, at(where, 'categories'), document.categories)
  if (categories === null) return problems

  if (categories.length === 0) {
    add(
      problems,
      at(where, 'categories'),
      'Menuen skal have mindst én sektion — f.eks. "Burgere" eller "Drikkevarer".',
    )
    return problems
  }

  const sectionIds: { value: string; where: string }[] = []
  const dishIds: { value: string; where: string }[] = []
  /** The sections claiming each single-document body, so a second one can be named. */
  const claimed = new Map<SingleDocumentKind, string[]>()
  /** The sections carrying the reserved id, with the body each of them asked for. */
  const reserved: ReservedSection[] = []

  categories.forEach((entry, index) => {
    const label = readableName(entry, 'name', `sektion ${index + 1}`)
    const sectionWhere = at(where, label)

    const category = object(problems, sectionWhere, entry)
    if (category === null) return

    const id = slug(problems, at(sectionWhere, 'id'), category.id)
    if (id !== null) sectionIds.push({ value: id, where: at(sectionWhere, 'id') })

    text(problems, at(sectionWhere, 'name'), category.name, { required: true })
    text(problems, at(sectionWhere, 'intro'), category.intro)
    text(problems, at(sectionWhere, 'note'), category.note)

    let kind: MenuCategoryKind | null = 'dishes'
    if (!isBlank(category.kind)) {
      kind = oneOf(
        problems,
        at(sectionWhere, 'kind'),
        category.kind,
        MENU_CATEGORY_KINDS,
        'Udelades betyder "dishes".',
      )
    }
    if (kind !== null && kind !== 'dishes') {
      claimed.set(kind, [...(claimed.get(kind) ?? []), label])
    }

    if (id === BURGER_MENU_SECTION_ID) reserved.push({ where: sectionWhere, kind })

    // A section with no `dishes` key at all is a section with no dishes. Pages CMS
    // leaves an empty list out of the file it writes, so an untouched save turns
    // `"dishes": []` into nothing — which is what Ugens ret and Tapasbordet, the two
    // sections that never hold dishes, look like after the restaurant has saved the
    // menu once. The two spellings are the same section, and the loader reads them the
    // same way (`?? []`).
    //
    // `isAbsent` rather than the usual `isBlank`, so validator and loader cannot
    // disagree about a third spelling: `""` is what an emptied *control* writes, and
    // `dishes` is an object list rather than a control. Nothing writes `""` here, so it
    // stays what it has always been — not a list.
    let dishes: unknown[] = []
    if (!isAbsent(category.dishes)) {
      const written = array(problems, at(sectionWhere, 'dishes'), category.dishes)
      if (written === null) return
      dishes = written
    }

    dishes.forEach((dishEntry, dishIndex) => {
      const dishWhere = at(sectionWhere, readableName(dishEntry, 'name', `ret ${dishIndex + 1}`))
      const dish = object(problems, dishWhere, dishEntry)
      if (dish === null) return

      const dishId = slug(problems, at(dishWhere, 'id'), dish.id)
      if (dishId !== null) dishIds.push({ value: dishId, where: at(dishWhere, 'id') })

      text(problems, at(dishWhere, 'name'), dish.name, { required: true })
      text(problems, at(dishWhere, 'description'), dish.description)
      text(problems, at(dishWhere, 'secondaryNote'), dish.secondaryNote)
      price(problems, at(dishWhere, 'price'), dish.price)
      date(problems, at(dishWhere, 'soldOutOn'), dish.soldOutOn)
      flag(problems, at(dishWhere, 'featured'), dish.featured)
      photo(problems, at(dishWhere, 'photo'), dish.photo)
      validateLabels(problems, at(dishWhere, 'labels'), dish.labels)

      // The board used to be a field on this dish. Nothing reads it now, so a leftover
      // one would be content nobody would ever see again — said plainly, once, rather
      // than left to be discovered as three missing lists on the menu.
      if (dish.tapas !== undefined) {
        add(
          problems,
          at(dishWhere, 'tapas'),
          'Tapasbordet er ikke længere et felt på en ret. Det står i sit eget dokument ' +
            '(content/site/tapas.json), og afsnittet, der viser det, har "kind": "tapas". ' +
            'Fjern feltet her — indholdet i det bliver ikke vist nogen steder.',
        )
      }
    })

    if (kind !== null && kind !== 'dishes' && dishes.length > 0) {
      const body = SINGLE_DOCUMENT_BODIES[kind]
      add(
        problems,
        at(sectionWhere, 'dishes'),
        `Denne sektion viser ${body.what} (${body.file}) i stedet for en liste af retter — ` +
          'retterne her ville ikke blive vist nogen steder. Flyt dem til en anden sektion, ' +
          `eller vælg en anden type afsnit end "${kind}".`,
      )
    }
  })

  unique(
    problems,
    sectionIds,
    'Id’et er sektionens adresse i menuens kategorilinje, så to sektioner kan ikke dele det.',
  )
  unique(
    problems,
    dishIds,
    'Id’et er rettens faste identitet, og både menuen og forsiden bruger det som nøgle, så det ' +
      'skal være unikt i hele menuen.',
  )

  for (const [kind, sections] of claimed) {
    if (sections.length < 2) continue
    const body = SINGLE_DOCUMENT_BODIES[kind]
    add(
      problems,
      at(where, 'categories'),
      `Kun én sektion kan have "kind": "${kind}". Den viser ${body.what}, som er ét dokument ` +
        `(${body.file}). Sektionerne der har det nu: ${sections.join(', ')}.`,
    )
  }

  checkReservedSection(problems, where, reserved)

  return problems
}

/** A section carrying the reserved id, and the body its `kind` asked the renderer for. */
type ReservedSection = { where: string; kind: MenuCategoryKind | null }

/**
 * The reserved section — the one technical id the menu may not rename away.
 *
 * Two parts of the site look this section up by id rather than by heading: Månedens
 * burger is drawn at the end of it (`MenuCategorySection`), and its introduction is the
 * one piece of menu prose whose prices are joined to "kr."
 * (`lib/content/load/menu.ts`). Renaming the id or deleting the section leaves a menu
 * that is still perfectly well-formed and quietly no longer shows Månedens burger,
 * which is exactly the kind of silence this file exists to end.
 *
 * Only two things are held: that the id is somewhere in the document, and that the
 * section carrying it draws ordinary dishes — the only body `MonthlyBurgerCard` is
 * drawn inside. The heading, the introduction, the note, the dishes and the section's
 * position are untouched, and every other section's id stays the restaurant's own. A
 * second section with the id needs nothing here: the id is a section's address, and
 * `unique` above already refuses two sections sharing one.
 */
function checkReservedSection(
  problems: Problem[],
  where: string,
  reserved: readonly ReservedSection[],
): void {
  if (reserved.length === 0) {
    add(
      problems,
      at(where, 'categories'),
      `Menuen skal have et afsnit, hvis korte navn til systemet er "${BURGER_MENU_SECTION_ID}". ` +
        'Det er dér, Månedens burger bliver vist, og det er det eneste afsnit, hvor priserne i ' +
        'indledningen holdes sammen med "kr.". Afsnittet må gerne hedde noget andet på siden og ' +
        'må gerne flyttes op eller ned på menuen, og retterne i det kan ændres frit — men det ' +
        `tekniske id "${BURGER_MENU_SECTION_ID}" må ikke laves om, og afsnittet må ikke slettes.`,
    )
    return
  }

  for (const section of reserved) {
    if (section.kind === null || section.kind === 'dishes') continue

    const body = SINGLE_DOCUMENT_BODIES[section.kind]
    add(
      problems,
      at(section.where, 'kind'),
      `Afsnittet med det korte navn "${BURGER_MENU_SECTION_ID}" skal være et afsnit med ` +
        'almindelige retter ("kind": "dishes"), for det er dér, Månedens burger bliver vist. ' +
        `Som "${section.kind}" viser afsnittet ${body.what} (${body.file}) i stedet, og ` +
        'Månedens burger ville forsvinde fra menuen. Læg det andet dokument i sit eget afsnit.',
    )
  }
}

/**
 * Labels are **not** a closed vocabulary, and this deliberately does not make one.
 *
 * `DishLabelBadge` gives four names their own colour (Populær, Ny, Stærk, Vegetar) and
 * draws every other label in the neutral tone — which is how "Pulled pork" is already
 * rendered today. A label the restaurant invents tomorrow is therefore a supported
 * label, and refusing it here would be this phase inventing a restriction the site
 * does not have. What is checked is only what would break: a label has to be text, it
 * has to say something, and the same chip must not be printed twice on one card.
 */
function validateLabels(problems: Problem[], where: string, value: unknown): void {
  if (isBlank(value)) return

  const labels = array(problems, where, value, '[ "Populær", ... ]')
  if (labels === null) return

  uniqueTexts(problems, where, labels, 'Den samme mærkat kan kun stå én gang på en ret.')
}

/**
 * The tapas board — `tapas.json`: a price, one small line and three lists (§4,
 * decision 3).
 *
 * It is its own document rather than a field on a dish, so an ordinary dish carries
 * nothing of it and the editor that opens it shows nothing else. Which section draws
 * it is `menu.json`'s answer, given by that section's `kind`.
 *
 * `TapasTable` prints the group headings and the items, and uses each item as its
 * React key, so an item repeated inside a group is a real fault rather than a
 * duplicate word. `mode` and `choose` are the board's own bookkeeping: a list you
 * choose from states how many, and a list that is always on the table does not. The
 * price is optional in the same way every other price on the site is — an empty one
 * simply prints no price — and the group ids stay a closed set because the renderer
 * singles out `base` and lays the other lists out beside it.
 */
export function validateTapas(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const board = object(problems, where, file)
  if (board === null) return problems

  price(problems, at(where, 'price'), board.price)
  text(problems, at(where, 'secondaryNote'), board.secondaryNote)

  const groups = array(problems, at(where, 'groups'), board.groups)
  if (groups === null) return problems

  if (groups.length === 0) {
    add(problems, at(where, 'groups'), 'Et tapasbord skal have mindst én liste.')
    return problems
  }

  const ids: { value: string; where: string }[] = []

  groups.forEach((entry, index) => {
    const groupWhere = at(where, 'groups', index + 1)
    const group = object(problems, groupWhere, entry)
    if (group === null) return

    const id = oneOf(problems, at(groupWhere, 'id'), group.id, TAPAS_GROUP_IDS)
    if (id !== null) ids.push({ value: id, where: at(groupWhere, 'id') })

    text(problems, at(groupWhere, 'heading'), group.heading, { required: true })

    const mode = oneOf(
      problems,
      at(groupWhere, 'mode'),
      group.mode,
      TAPAS_GROUP_MODES,
      '"fixed" er det der altid er med, "choose" er det man vælger imellem.',
    )

    if (mode === 'choose') {
      if (isBlank(group.choose)) {
        add(
          problems,
          at(groupWhere, 'choose'),
          'En liste man vælger fra skal sige hvor mange der vælges — f.eks. "choose": 7.',
        )
      } else {
        whole(problems, at(groupWhere, 'choose'), group.choose, 1)
      }
    } else if (mode === 'fixed' && !isBlank(group.choose)) {
      add(
        problems,
        at(groupWhere, 'choose'),
        'Denne liste er altid med på bordet ("mode": "fixed"), så der vælges ikke et antal fra ' +
          'den. Fjern "choose", eller sæt listen til "mode": "choose".',
      )
    }

    const items = array(problems, at(groupWhere, 'items'), group.items, '[ "Oliven", ... ]')
    if (items === null) return

    if (items.length === 0) {
      add(problems, at(groupWhere, 'items'), 'Listen skal indeholde mindst én ting.')
      return
    }

    uniqueTexts(
      problems,
      at(groupWhere, 'items'),
      items,
      'Den samme linje kan kun stå én gang i en liste.',
    )
  })

  unique(problems, ids, 'Et tapasbord kan kun have én liste af hver slags.')

  return problems
}

/**
 * Ugens ret — `weekly-special.json`.
 *
 * `active: false` is the empty state the site has been in since launch, and it stays
 * valid whatever else the file says: the message fields sit on disk unread, exactly as
 * the loader describes. What is *present* still has to be the right kind of value, so
 * a price typed wrong today is caught today rather than on the day somebody publishes
 * the week.
 */
export function validateWeeklySpecial(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  const active = flag(problems, at(where, 'active'), document.active, { required: true })

  text(problems, at(where, 'name'), document.name, { required: active === true })
  text(problems, at(where, 'description'), document.description)
  price(problems, at(where, 'priceSmall'), document.priceSmall)
  price(problems, at(where, 'priceLarge'), document.priceLarge)
  date(problems, at(where, 'soldOutOn'), document.soldOutOn)
  photo(problems, at(where, 'photo'), document.photo)

  // `WeeklySpecial` prints "Uge 42" from this one number; `isoYear` is stored beside it
  // and never rendered anywhere, so it is carried rather than checked.
  if (!isBlank(document.isoWeek)) whole(problems, at(where, 'isoWeek'), document.isoWeek, 1, 53)

  validateWeekdays(problems, at(where, 'days'), document.days)

  if (!isBlank(document.saturday)) {
    const saturdayWhere = at(where, 'saturday')
    const saturday = object(problems, saturdayWhere, document.saturday)

    if (saturday !== null) {
      const enabled = flag(problems, at(saturdayWhere, 'enabled'), saturday.enabled, {
        required: true,
      })
      text(problems, at(saturdayWhere, 'name'), saturday.name, { required: enabled === true })
      text(problems, at(saturdayWhere, 'description'), saturday.description)
      text(problems, at(saturdayWhere, 'deadline'), saturday.deadline)
      price(problems, at(saturdayWhere, 'price'), saturday.price)
      date(problems, at(saturdayWhere, 'soldOutOn'), saturday.soldOutOn)
    }
  }

  return problems
}

/**
 * The weekdays a dish is served on.
 *
 * `formatServingDays` builds the "Onsdag · torsdag · fredag" line by keeping the keys
 * it recognises and dropping the rest, so a misspelled day does not show up wrong —
 * it does not show up at all, which is the kind of silence this phase exists to end.
 */
function validateWeekdays(problems: Problem[], where: string, value: unknown): void {
  if (isBlank(value)) return

  const days = array(problems, where, value, '[ "wed", "thu", "fri" ]')
  if (days === null) return

  const seen: { value: string; where: string }[] = []

  days.forEach((day, index) => {
    const dayWhere = at(where, index + 1)
    const key = oneOf(problems, dayWhere, day, WEEKDAY_KEYS)
    if (key !== null) seen.push({ value: key, where: dayWhere })
  })

  unique(problems, seen, 'Hver ugedag kan kun stå én gang.')
}

/**
 * Månedens burger — `monthly-burger.json`.
 *
 * `active: false` is the approved empty card, and it stays valid. An active burger
 * needs a name, because the domain type requires one and a card with no name is not a
 * state the design has. The window's two ends have to be real dates and have to be the
 * right way round: a start after its end is a window that never opens, and §7d's
 * comparison would simply hide the burger forever without saying why.
 */
export function validateMonthlyBurger(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  const active = flag(problems, at(where, 'active'), document.active, { required: true })

  text(problems, at(where, 'name'), document.name, { required: active === true })
  text(problems, at(where, 'description'), document.description)
  price(problems, at(where, 'price'), document.price)
  photo(problems, at(where, 'photo'), document.photo)
  flag(problems, at(where, 'showOnHomepage'), document.showOnHomepage)

  const startsOn = date(problems, at(where, 'startsOn'), document.startsOn)
  const endsOn = date(problems, at(where, 'endsOn'), document.endsOn)
  date(problems, at(where, 'soldOutOn'), document.soldOutOn)

  if (startsOn !== null && endsOn !== null && startsOn > endsOn) {
    add(
      problems,
      at(where, 'endsOn'),
      `Slutdatoen (${endsOn}) ligger før startdatoen (${startsOn}), så burgeren ville aldrig ` +
        'blive vist. Byt de to datoer om.',
    )
  }

  return problems
}
