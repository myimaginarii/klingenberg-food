#!/usr/bin/env node
/**
 * Stage a composed publication, and refuse to commit anything outside the two
 * publication roots.
 *
 * WHAT THIS IS FOR. `compose-publication.mjs` decides what may cross the boundary and
 * writes it into a working tree. This is the check made *after* that, on what git
 * actually sees on disk, immediately before the commit exists: the last door, and the
 * one a bug in the composer would have to get past. The composer asserts its own
 * result from the tree listings it computed; this asserts the real index against the
 * real base commit. Two independent statements of the same invariant, which is the
 * only reason the second one is worth writing.
 *
 * IT STAGES EVERYTHING, ON PURPOSE. `git add -A` — not the two roots by name. Staging
 * only the roots would make the assertion below vacuous: it could not fail, because
 * nothing else would ever be in the index to fail it. Staging the whole tree is what
 * gives the check something to catch — a composer that wrote outside its allow-list, a
 * validation step that edited a tracked file, anything at all that differs from the
 * base commit and is not owner content. `public/media/` and `generated/` are ignored
 * by `.gitignore` (they are build products of `public/photos/`, written before every
 * build), so the ordinary image build cannot trip this.
 *
 * THE ALLOW-LIST IS IMPORTED, NEVER RESTATED. {@link publicationRootOf} is the
 * composer's own boundary test. There is one allow-list in this repository and this
 * file is not a second copy of it.
 *
 * USAGE
 *
 *     node scripts/cms/stage-publication.mjs --base <sha> [--repo <dir>]
 *
 * `--base` is the immutable commit the publication is composed on top of, and must be
 * the commit the working tree is at. Exits 0 whether or not there is anything to
 * publish — "nothing to publish" is a successful outcome, reported as `changed=false`
 * on `$GITHUB_OUTPUT` — and 1 when a path outside the publication roots is staged.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { PUBLICATION_ROOTS, publicationRootOf } from './compose-publication.mjs'

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

/** The paths among `paths` that lie outside every publication root — the ones that may not be committed. */
export function escapedPaths(paths) {
  return paths.filter((path) => publicationRootOf(path) === null)
}

/**
 * Stage the whole working tree and report the paths the commit would change.
 *
 * Throws — before the caller can commit anything — if the base commit is not the one
 * the tree is at, or if any staged path lies outside the publication roots.
 */
export function stagePublication({ repo, base }) {
  const head = git(repo, ['rev-parse', 'HEAD']).trim()
  if (head !== base) {
    throw new Error(`${repo} is at ${head}, not at the base commit ${base}.`)
  }

  git(repo, ['add', '-A'])

  const staged = git(repo, ['diff', '--cached', '--name-only', '-z', base, '--'])
    .split('\0')
    .filter((path) => path !== '')

  const escaped = escapedPaths(staged)
  if (escaped.length > 0) {
    throw new Error(
      `Refusing to commit: ${escaped.length} staged path(s) outside ${PUBLICATION_ROOTS.join(', ')}:\n  ${escaped.join('\n  ')}`,
    )
  }

  return { base, staged, changed: staged.length > 0 }
}

function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      repo: { type: 'string', default: process.cwd() },
    },
  })

  if (values.base === undefined) {
    console.error('stage-publication: --base <sha> is required (the commit the publication sits on).')
    process.exit(2)
  }

  const repo = resolve(values.repo)

  let result
  try {
    result = stagePublication({ repo, base: values.base })
  } catch (error) {
    console.error(`stage-publication: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }

  if (result.changed) {
    for (const path of result.staged) console.log(`  ${path}`)
    console.log(
      `${result.staged.length} path(s) staged, all inside ${PUBLICATION_ROOTS.map((root) => `${root}/`).join(', ')}.`,
    )
  } else {
    console.log(`Nothing to publish: ${values.base} already carries this content.`)
  }

  if (process.env.GITHUB_OUTPUT !== undefined) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=${result.changed}\ncount=${result.staged.length}\n`,
    )
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
