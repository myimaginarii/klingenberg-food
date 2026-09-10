import { contentPath, listContentJson, readContentJson } from '../load/source'

import { validateAnnouncement } from './announcement'
import { validateContact } from './contact'
import { validateHours } from './hours'
import { menuDishIds, validateMenu, validateMonthlyBurger, validateWeeklySpecial } from './menu'
import { validateNewsArticle } from './news'
import { validateAboutPage, validateAward, validateHomePage, validateTakeawayPage } from './pages'
import { add, at, type Problem } from './problems'

/**
 * The whole of `content/site/`, checked in one pass — what `npm run check:content` runs.
 *
 * Each document is read through the same door the site reads it through
 * (`lib/content/load/source.ts`) and handed to the same validator the matching loader
 * calls, so there is one statement of what valid content is and this is simply all of
 * it at once. What this pass adds on top is the questions no single file can answer.
 *
 * CROSS-DOCUMENT RULES, and why there are only two kinds.
 *
 * There are eight small JSON files and one directory, not a database, so nothing here
 * builds a reference graph. Two relationships actually exist between files, and both
 * are checked:
 *
 *   * **The Forside names dishes by id.** `featured.dishIds` points into `menu.json`.
 *     At render time a dish that has gone is simply left out — the design shows cards,
 *     never a hole (§7e) — which is right on the page and wrong in a repository: it
 *     means a mistyped id is a card that quietly stops appearing. So the reference is
 *     checked here, where it can be reported, rather than made fatal in the loader,
 *     where it would change what the page does.
 *   * **Every photograph names a file.** That one is not written below because it does
 *     not need to be: each `photo` field is resolved against `public/photos/` and the
 *     generated manifest as it is validated, by the same functions the loaders use.
 *
 * A file that cannot be read or is not valid JSON is reported as a problem like any
 * other, rather than thrown: the point of this pass is to say everything that is wrong
 * in one go.
 */

/** The tracked documents, in the order an editor would think of them. */
const DOCUMENTS = [
  { segments: ['menu.json'], validate: validateMenu },
  { segments: ['weekly-special.json'], validate: validateWeeklySpecial },
  { segments: ['monthly-burger.json'], validate: validateMonthlyBurger },
  { segments: ['hours.json'], validate: validateHours },
  { segments: ['contact.json'], validate: validateContact },
  { segments: ['award.json'], validate: validateAward },
  { segments: ['announcement.json'], validate: validateAnnouncement },
  { segments: ['pages', 'home.json'], validate: validateHomePage },
  { segments: ['pages', 'about.json'], validate: validateAboutPage },
  { segments: ['pages', 'takeaway.json'], validate: validateTakeawayPage },
] as const satisfies readonly {
  segments: readonly string[]
  validate: (file: unknown, where: string) => Problem[]
}[]

export function validateSiteContent(): Problem[] {
  const problems: Problem[] = []
  const read = new Map<string, unknown>()

  for (const document of DOCUMENTS) {
    const where = contentPath(...document.segments)
    let file
    try {
      file = readContentJson<unknown>(...document.segments)
    } catch {
      add(
        problems,
        where,
        'Filen kunne ikke læses. Enten mangler den, eller også er den ikke gyldig JSON — ' +
          'tjek for et komma eller en klamme for meget.',
      )
      continue
    }

    read.set(document.segments.join('/'), file)
    problems.push(...document.validate(file, where))
  }

  for (const slug of listContentJson('news')) {
    const where = contentPath('news', `${slug}.json`)
    try {
      problems.push(...validateNewsArticle(slug, readContentJson<unknown>('news', `${slug}.json`), where))
    } catch {
      add(problems, where, 'Filen kunne ikke læses — den er ikke gyldig JSON.')
    }
  }

  const menu = read.get('menu.json')
  const home = read.get('pages/home.json')
  if (menu !== undefined && home !== undefined) {
    problems.push(...validateFeaturedReferences(home, menu))
  }

  return problems
}

/** The Forside's dish ids must name dishes the menu actually has. */
function validateFeaturedReferences(home: unknown, menu: unknown): Problem[] {
  const problems: Problem[] = []

  const dishIds = (home as { featured?: { dishIds?: unknown } })?.featured?.dishIds
  if (!Array.isArray(dishIds)) return problems

  const onTheMenu = new Set(menuDishIds(menu))
  const where = at(contentPath('pages', 'home.json'), 'featured', 'dishIds')

  dishIds.forEach((id, index) => {
    if (typeof id !== 'string' || onTheMenu.has(id)) return

    add(
      problems,
      at(where, index + 1),
      `Der findes ingen ret med id'et "${id}" i menuen (${contentPath('menu.json')}). ` +
        'Forsiden ville vise et kort mindre uden at sige hvorfor. Ret id’et, eller vælg ' +
        'en anden ret.',
    )
  })

  return problems
}
