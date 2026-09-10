import { contentPath, listContentJson, readContentJson } from '../load/source'

import { validateAnnouncement } from './announcement'
import { validateContact } from './contact'
import { validateHours } from './hours'
import { validateMenu, validateMonthlyBurger, validateWeeklySpecial } from './menu'
import { validateNewsArticle } from './news'
import { validateAboutPage, validateAward, validateHomePage, validateTakeawayPage } from './pages'
import { add, type Problem } from './problems'

/**
 * The whole of `content/site/`, checked in one pass — what `npm run check:content` runs.
 *
 * Each document is read through the same door the site reads it through
 * (`lib/content/load/source.ts`) and handed to the same validator the matching loader
 * calls, so there is one statement of what valid content is and this is simply all of
 * it at once. What this pass adds on top is the questions no single file can answer.
 *
 * CROSS-DOCUMENT RULES: there are none, and that is the design.
 *
 * There are eight small JSON files and one directory, not a database, so nothing here
 * builds a reference graph. One relationship used to exist — the Forside named three
 * dishes by id — and it was removed rather than checked harder: a dish now carries its
 * own "Vis på forsiden" flag, so deleting a dish removes it from the Forside and there
 * is nothing left to dangle. The only other relationship, **every photograph names a
 * file**, is not written below because it does not need to be: each `photo` field is
 * resolved against `public/photos/` and the generated manifest as it is validated, by
 * the same functions the loaders use.
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

  return problems
}
