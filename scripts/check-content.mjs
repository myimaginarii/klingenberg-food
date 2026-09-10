#!/usr/bin/env node
/**
 * `npm run check:content` — every editable content file, checked before anything is built.
 *
 * WHAT IT IS FOR. After Pages CMS lands, the restaurant edits `content/site/` from a
 * browser and a commit deploys the site. This is the gate between those two things: a
 * change that would break a page has to fail here, with a sentence somebody can act
 * on, rather than three minutes later inside a build log or — worse — quietly, as a
 * card that stopped appearing. It runs from a clean checkout, locally, in CI, and
 * before a production build.
 *
 * WHAT IT IS NOT. It is not a second validator. Every rule it applies is the one the
 * loaders apply (`lib/content/validate/`), called through the same door the site reads
 * content through, so `check:content` and `next build` cannot disagree about whether a
 * menu is usable. The only thing that lives here is the reporting: collect every
 * problem instead of stopping at the first, print them, and exit non-zero.
 *
 * WHY IT IS AN .mjs AROUND TYPESCRIPT. The rules have to be shared with the loaders,
 * and the loaders are TypeScript. Node runs this repository's TypeScript directly
 * (type stripping); the small resolve hook below teaches it the `@/` alias and the
 * extensionless relative imports the codebase uses. It is the same hook
 * `scripts/images/build-static-derivatives.mjs` already uses, for the same reason, and
 * it is why this needs no dependency, no build step and no bundler.
 *
 * A failure prints the problems and nothing else — no stack trace. A stack trace is
 * for whoever wrote the validator; the audience here wrote the menu.
 */

import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The repository this script belongs to — where its own imports resolve from. */
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
    // The repository's TypeScript is ES modules; saying so spares Node a reparse.
    return resolved.url.endsWith('.ts') ? { ...resolved, format: 'module-typescript' } : resolved
  },
})

const { validateSiteContent } = await import('../lib/content/validate/index.ts')
const { formatProblems } = await import('../lib/content/validate/problems.ts')

let problems
try {
  problems = validateSiteContent()
} catch (error) {
  // Nothing in the validators is meant to throw — they collect. If one does, it is a
  // fault in this repository rather than in the content, and it says so.
  console.error('check:content could not run. This is a fault in the checker, not in the content.')
  console.error(error)
  process.exit(2)
}

if (problems.length === 0) {
  console.log('Indholdet i content/site/ er i orden.')
  process.exit(0)
}

const count = problems.length === 1 ? '1 fejl' : `${problems.length} fejl`

console.error(`Indholdet kan ikke bruges (${count}):`)
console.error('')
console.error(formatProblems(problems))
console.error('')
console.error('Ret felterne ovenfor og kør "npm run check:content" igen.')
process.exit(1)
