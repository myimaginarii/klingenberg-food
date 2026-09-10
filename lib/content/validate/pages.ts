import { array, isBlank, object, photo, slug, text, unique } from './fields'
import { at, readableName, type Problem } from './problems'

/**
 * What a usable page document is — `pages/home.json`, `pages/about.json`,
 * `pages/takeaway.json`, and the shared `award.json`.
 *
 * These files are mostly prose, and prose is left alone. Nothing here counts
 * sentences, bans a dash, requires a keyword or objects to a Danish letter: the
 * restaurant writes the words. What is checked is the *scaffolding* the renderers
 * assume — the objects a loader reaches into without asking first, the lists it maps
 * over, the ids it uses as React keys and element ids, the one label without which a
 * button would be blank, and the photographs.
 *
 * THE AWARD IS NOT ANALYSED. `award.json` holds the confirmed competition result, and
 * it will be read-only in Pages CMS for exactly that reason. Phase 3 does not try to
 * decide whether a sentence about a competition is true — that is what "read-only"
 * is for. It only keeps the two fields the two award bands print from going empty.
 */

/**
 * A panel: an object a loader reaches straight into, holding prose and a photograph.
 *
 * The Forside's hero, its Om os excerpt, its award band, and Om os's own team and
 * method bands are all this same shape, so they are all read the same way. `keys` names
 * the prose the panel carries; every one of them may also carry a `photo`, and none of
 * the prose is required — an empty band is a band the restaurant emptied.
 */
function panel(
  problems: Problem[],
  where: string,
  value: unknown,
  ...keys: readonly string[]
): void {
  const shape = [...keys, 'photo'].map((key) => `"${key}"`).join(', ')

  const block = object(problems, where, value, `{ ${shape} }`)
  if (block === null) return

  for (const key of keys) text(problems, at(where, key), block[key])
  photo(problems, at(where, 'photo'), block.photo)
}

export function validateHomePage(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  panel(problems, at(where, 'hero'), document.hero, 'heading', 'intro')

  if (!isBlank(document.award)) panel(problems, at(where, 'award'), document.award)

  const featuredWhere = at(where, 'featured')
  const featured = object(problems, featuredWhere, document.featured, '{ "dishIds", "note" }')
  if (featured !== null) {
    validateFeaturedDishIds(problems, at(featuredWhere, 'dishIds'), featured.dishIds)
    text(problems, at(featuredWhere, 'note'), featured.note)
  }

  panel(problems, at(where, 'aboutExcerpt'), document.aboutExcerpt, 'heading', 'text')

  return problems
}

/**
 * "Tre fra menuen" names dishes by id.
 *
 * How many is the restaurant's choice — the section renders whichever dishes the list
 * points at, and renders nothing at all when the list is empty, so removing the
 * section is a supported edit rather than a broken page. What is not a choice: each id
 * has to be written once (the cards are keyed by it, and the same dish twice would be
 * the same card twice), and each has to name a dish that exists — which is checked
 * against the menu in `./index.ts`, because it is a question about two files.
 */
function validateFeaturedDishIds(problems: Problem[], where: string, value: unknown): void {
  if (isBlank(value)) return

  const ids = array(problems, where, value, '[ "odin", "frigg", "ragnar" ]')
  if (ids === null) return

  const written: { value: string; where: string }[] = []

  ids.forEach((id, index) => {
    const idWhere = at(where, index + 1)
    const dishId = slug(problems, idWhere, id)
    if (dishId !== null) written.push({ value: dishId, where: idWhere })
  })

  unique(problems, written, 'Forsiden viser hver ret én gang.')
}

export function validateAboutPage(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  text(problems, at(where, 'heading'), document.heading)
  photo(problems, at(where, 'venuePhoto'), document.venuePhoto)
  panel(problems, at(where, 'team'), document.team, 'text')
  panel(problems, at(where, 'method'), document.method, 'heading', 'text')

  if (!isBlank(document.story)) {
    const storyWhere = at(where, 'story')
    const story = array(problems, storyWhere, document.story, '[ "...", "..." ]')

    story?.forEach((paragraph, index) => {
      text(problems, at(storyWhere, `afsnit ${index + 1}`), paragraph, { required: true })
    })
  }

  return problems
}

export function validateTakeawayPage(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  text(problems, at(where, 'heading'), document.heading)
  text(problems, at(where, 'intro'), document.intro)
  text(problems, at(where, 'phoneNote'), document.phoneNote)
  photo(problems, at(where, 'photo'), document.photo)

  // The page's one button. A button with nothing written on it is not a state the
  // design has, so the label is required rather than defaulted.
  text(problems, at(where, 'ctaLabel'), document.ctaLabel, { required: true })

  if (isBlank(document.sections)) return problems

  const sectionsWhere = at(where, 'sections')
  const sections = array(problems, sectionsWhere, document.sections)
  if (sections === null) return problems

  const ids: { value: string; where: string }[] = []

  sections.forEach((entry, index) => {
    const sectionWhere = at(sectionsWhere, readableName(entry, 'heading', `afsnit ${index + 1}`))
    const section = object(problems, sectionWhere, entry)
    if (section === null) return

    const id = slug(problems, at(sectionWhere, 'id'), section.id)
    if (id !== null) ids.push({ value: id, where: at(sectionWhere, 'id') })

    text(problems, at(sectionWhere, 'heading'), section.heading)
    text(problems, at(sectionWhere, 'body'), section.body)
  })

  unique(
    problems,
    ids,
    'Id’et bliver til afsnittets adresse på siden, så to afsnit kan ikke dele det.',
  )

  return problems
}

export function validateAward(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  text(problems, at(where, 'title'), document.title, { required: true })
  text(problems, at(where, 'text'), document.text, { required: true })

  return problems
}
