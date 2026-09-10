import { MENU_CATEGORY_KINDS, TAPAS_GROUP_IDS, TAPAS_GROUP_MODES } from '@/lib/content/types'
import { WEEKDAY_KEYS } from '@/lib/time/calendar'

import {
  array,
  date,
  flag,
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
 * What a usable menu is — `menu.json`, `weekly-special.json`, `monthly-burger.json`.
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
 *   * **One weekly-special section, at most.** The section renders *the* week's
 *     special, which is one document; two sections would print the same card twice.
 *     Zero is allowed — removing the section removes Ugens ret from the menu, which
 *     `MenuCategorySection` handles by rendering nothing.
 *   * **One tapas board per section, at most, and nothing beside it.**
 *     `MenuCategorySection` replaces the whole section body with the first dish that
 *     carries a tapas document, so a second board — and every ordinary dish beside it
 *     — would silently disappear. A `weekly_special` section replaces its body the
 *     same way. Both are refused here and neither is fixed here: lifting either
 *     restriction means changing the renderer, which this phase does not do.
 *
 * A section with no dishes is deliberately fine: `ugens-ret` has none today, and an
 * editor building a new section starts from an empty one.
 */

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
  const weeklySections: string[] = []

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

    if (!isBlank(category.kind)) {
      const kind = oneOf(
        problems,
        at(sectionWhere, 'kind'),
        category.kind,
        MENU_CATEGORY_KINDS,
        'Udelades betyder "dishes".',
      )
      if (kind === 'weekly_special') weeklySections.push(label)
    }

    const dishes = array(problems, at(sectionWhere, 'dishes'), category.dishes)
    if (dishes === null) return

    let tapasBoards = 0

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

      if (!isBlank(dish.tapas)) {
        tapasBoards += 1
        validateTapas(problems, at(dishWhere, 'tapas'), dish.tapas)
      }
    })

    if (category.kind === 'weekly_special' && dishes.length > 0) {
      add(
        problems,
        at(sectionWhere, 'dishes'),
        'Denne sektion viser Ugens ret (content/site/weekly-special.json) i stedet for en liste ' +
          'af retter — retterne her ville ikke blive vist nogen steder. Flyt dem til en anden ' +
          'sektion, eller fjern "kind": "weekly_special".',
      )
    }

    if (tapasBoards > 1 || (tapasBoards === 1 && dishes.length > 1)) {
      add(
        problems,
        at(sectionWhere, 'dishes'),
        'Et tapasbord fylder hele sektionen: når en ret har et "tapas"-felt, viser sektionen kun ' +
          'den ret, og de øvrige retter — og et ekstra tapasbord — bliver ikke vist. Læg dem i ' +
          'en anden sektion.',
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

  if (weeklySections.length > 1) {
    add(
      problems,
      at(where, 'categories'),
      'Kun én sektion kan have "kind": "weekly_special". Den viser Ugens ret, som er ét dokument ' +
        `(content/site/weekly-special.json). Sektionerne der har det nu: ${weeklySections.join(', ')}.`,
    )
  }

  return problems
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
 * The tapas board — three lists and a price (§4, decision 3).
 *
 * `TapasTable` prints the group headings and the items, and uses each item as its
 * React key, so an item repeated inside a group is a real fault rather than a
 * duplicate word. `mode` and `choose` are the board's own bookkeeping: a list you
 * choose from states how many, and a list that is always on the table does not.
 */
function validateTapas(problems: Problem[], where: string, value: unknown): void {
  const board = object(problems, where, value, '{ "groups": [ ... ] }')
  if (board === null) return

  const groups = array(problems, at(where, 'groups'), board.groups)
  if (groups === null) return

  if (groups.length === 0) {
    add(problems, at(where, 'groups'), 'Et tapasbord skal have mindst én liste.')
    return
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
