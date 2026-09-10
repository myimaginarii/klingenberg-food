#!/usr/bin/env node
/**
 * Every domain value the public site is built from, printed as JSON — a probe, not a
 * suite.
 *
 * `lib/content/load/source.ts` resolves `content/site/` from the process working
 * directory, so "what does this content load to" is a question that can only be asked
 * of a whole directory. This script asks it: run it with `cwd` pointing at the
 * repository and it prints the tracked site; run it with `cwd` pointing at a copy that
 * has been edited and it prints what that copy would render. Two runs and a deep
 * comparison are then a real answer to "does this edit change anything", rather than a
 * guess made one field at a time.
 *
 * `tests/unit/content/cms-empty-values.test.ts` is the caller. The resolve hook below
 * is `scripts/check-content.mjs`'s, for the same reason: the loaders are this
 * repository's TypeScript, and Node needs to be taught the `@/` alias and the
 * extensionless relative imports before it can run them.
 *
 * A loader that refuses the content throws, and the throw is the answer — the caller
 * sees a non-zero exit and the message.
 */

import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The repository this script belongs to — where its own imports resolve from. */
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = specifier.startsWith('@/')
      ? pathToFileURL(join(PROJECT, specifier.slice(2))).href
      : specifier
    let resolved
    try {
      resolved = nextResolve(mapped, context)
    } catch (error) {
      if (/\.(m?[jt]s)$/.test(mapped) || !/^(\.{1,2}\/|file:)/.test(mapped)) throw error
      resolved = nextResolve(`${mapped}.ts`, context)
    }
    return resolved.url.endsWith('.ts') ? { ...resolved, format: 'module-typescript' } : resolved
  },
})

const load = (module) => import(pathToFileURL(join(PROJECT, module)).href)

const [announcement, award, contact, hours, menu, news, pages] = await Promise.all([
  load('lib/content/load/announcement.ts'),
  load('lib/content/load/award.ts'),
  load('lib/content/load/contact.ts'),
  load('lib/content/load/hours.ts'),
  load('lib/content/load/menu.ts'),
  load('lib/content/load/news.ts'),
  load('lib/content/load/pages.ts'),
])

process.stdout.write(
  JSON.stringify({
    announcement: announcement.loadAnnouncement(),
    award: award.loadAward(),
    contact: contact.loadContact(),
    hours: hours.loadOpeningHours(),
    menu: menu.loadMenu(),
    news: news.loadNews(),
    home: pages.loadHomePage(),
    about: pages.loadAboutPage(),
    takeaway: pages.loadTakeawayPage(),
  }),
)
