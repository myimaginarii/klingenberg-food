#!/usr/bin/env node
/**
 * Compose the tree a publication PR should contain: the owner's content, over the
 * repository's code, for two directories and nothing else.
 *
 * WHAT THIS IS FOR. Pages CMS writes the restaurant's edits to the long-lived
 * `content` branch. Nothing there is ever deployed: production is built from `main`.
 * Getting an edit from one to the other is a *publication* — a commit on top of `main`
 * that carries the owner's content and not one byte else. This script composes that
 * commit's tree and refuses to compose anything wider.
 *
 * THE TRUST BOUNDARY, stated once:
 *
 *     main     trusted   code, configuration, workflows, CI, the CMS's own .pages.yml
 *     content  untrusted owner-authored data, written by a browser, reviewed by nobody
 *
 * Exactly two directories cross it, and they are named in {@link PUBLICATION_ROOTS}:
 * `content/site/` (the JSON the loaders read) and `public/photos/` (the photograph
 * sources the image build measures). Everything else in the publication tree comes
 * from `main`, whatever the `content` branch happens to say about it — so an edit that
 * changed a workflow, `.pages.yml`, `package.json`, `app/`, `tests/` or
 * `content/launch/` cannot reach production through this door, because this door only
 * ever *selects* those two prefixes. The allow-list is what decides; the long list of
 * things that must not cross is a consequence of it, not a second rule to maintain.
 *
 * IT IS A FULL SNAPSHOT, NOT A PATCH. The two directories are taken from the content
 * commit *entirely*: every path under them in the composed tree is one the content
 * commit has, and no path it lacks survives. That is what makes a deletion, a rename
 * and an unpublished-then-republished article all propagate with no special case —
 * a rename is simply a path the snapshot lacks and a path it adds.
 *
 * IT READS GIT OBJECTS, NOT THE FILESYSTEM. Both trees are read with `git ls-tree`, so
 * every path and every file mode is checked *before* anything is written anywhere. A
 * symbolic link in the content branch is refused as a mode in a tree listing rather
 * than discovered as a link on disk after a checkout has already materialised it. It
 * is also why the bytes are exact: `git cat-file blob` is the stored blob, byte for
 * byte, with no end-of-line conversion, no re-serialised JSON and no added trailing
 * newline. Copying the *working tree* instead would be wrong on a machine configured
 * with `core.autocrlf=true`, where every CMS file on disk carries CRLF that the blob
 * does not — a publication that rewrote every line of every file it touched.
 *
 * WHAT A PUBLICATION INPUT IS, NARROWLY. One mode: `100644`, a plain non-executable
 * regular file. A symbolic link and a submodule are not files; an executable is one the
 * composed tree could not honestly promise, because the checkout this writes does not
 * carry the bit. And under `public/photos/` the name itself must be a photograph the
 * site can render — one file, directly in the directory, named by the rule
 * `lib/images/photos.ts` already holds every stored `file` value to. Both are shape
 * checks at the edge, and neither replaces what comes later: `npm run check:content`
 * still validates the content, and the image build still decides whether a file is
 * genuinely readable image data.
 *
 * USAGE
 *
 *     node scripts/cms/compose-publication.mjs --content <ref> [--main <ref>]
 *                                              [--repo <dir>] [--into <dir>] [--json]
 *
 * Without `--into` it is a dry run: it prints what the publication would change and
 * exits 0 (or refuses, and exits 1). With `--into <dir>` it also writes the two
 * directories into that working tree, which must already be checked out at the main
 * ref and clean under both roots. Nothing else in that tree is touched, and when
 * there is nothing to publish nothing at all is written.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not validate content — `npm run
 * check:content` does, through the same loaders the site reads with, and it runs
 * against the composed tree afterwards. It does not touch `public/media/` or
 * `generated/images.json`: those are build products of `public/photos/`, written by
 * `scripts/images/build-static-derivatives.mjs`, and a publication input they are not.
 * It does not commit, push, or open anything.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

// Node runs this repository's TypeScript directly (type stripping). Saying the format
// out loud spares it a reparse — the same hook, for the same reason, as
// `scripts/check-content.mjs` and `scripts/images/build-static-derivatives.mjs`.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context)
    return resolved.url.endsWith('.ts') ? { ...resolved, format: 'module-typescript' } : resolved
  },
})

// The news slug shape is imported, never restated: the file name a publication accepts
// has to be exactly the one the loader turns into an address (`lib/content/load/news.ts`).
const { NEWS_SLUG_PATTERN } = await import('../../lib/news/slug.ts')

// The photograph file-name shape, likewise imported rather than restated. `lib/images/
// photos.ts` is already the gate the loaders and the image build parse a stored `file`
// value through; `isPhotoFileName` is that same rule asked of a name on disk, so the
// door here and the vocabulary the site renders cannot drift apart.
const { isPhotoFileName, PHOTO_EXTENSIONS, PHOTO_SOURCE_DIRECTORY } = await import(
  '../../lib/images/photos.ts'
)

/** Where the photograph sources are tracked: `public/photos`, named by the module above. */
const PHOTO_DIRECTORY = `public/${PHOTO_SOURCE_DIRECTORY}`

/**
 * THE POSITIVE ALLOW-LIST. The only two prefixes owner-authored data may occupy.
 * A path is a publication input if and only if it lies under one of these.
 */
export const PUBLICATION_ROOTS = Object.freeze(['content/site', PHOTO_DIRECTORY])

/** One file per article, and the file name is the address (`lib/content/load/news.ts`). */
const NEWS_DIRECTORY = 'content/site/news'

/**
 * The one dotfile a publication may carry. `content/site/news/.gitkeep` is tracked on
 * purpose: it is how an empty article directory exists in git at all. Every other
 * dot-prefixed name is refused, which is what stops a `.gitattributes` (it could set
 * filters over the trusted tree), a `.github` directory or a nested `.git` from
 * arriving inside an allowed prefix.
 */
const TRACKED_DOTFILE = '.gitkeep'

/** A plain, unremarkable file name. No dot-prefix, no leading `-`, no colon, no space. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * The one mode a publication input may carry: a plain, non-executable regular file.
 *
 * A symbolic link (120000) and a submodule (160000) are not files at all. An executable
 * regular file (100755) is one, but not one a CMS has any reason to produce — the two
 * roots hold JSON and photographs — and accepting it would make the composed tree and
 * the checkout disagree: {@link applyPublication} writes blobs with `writeFileSync`,
 * which does not carry the bit across. Narrowing the mode is the fix; a `chmod` would
 * only teach this door to reproduce a permission nobody wants published.
 */
const PUBLICATION_FILE_MODE = '100644'

/** Photographs are a megabyte at most; this is a bound, not a budget. */
const MAX_BUFFER = 64 * 1024 * 1024

function git(repo, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', repo, ...args], { encoding, maxBuffer: MAX_BUFFER })
}

/** The commit a ref names, as a full SHA. Throws, naming the ref, if it resolves to nothing. */
export function resolveCommit(repo, ref) {
  try {
    return git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  } catch (cause) {
    throw new Error(`No commit named "${ref}" in ${repo}.`, { cause })
  }
}

/**
 * Every file in one commit's tree: path → `{ mode, oid }`.
 *
 * `-z` so a path arrives as its own bytes rather than git's quoted form, and
 * `--full-tree` so the answer never depends on the directory this is run from.
 */
export function readTree(repo, commit) {
  const listing = git(repo, ['ls-tree', '-r', '-z', '--full-tree', commit])
  const entries = new Map()

  for (const record of listing.split('\0')) {
    if (record === '') continue
    const tab = record.indexOf('\t')
    const [mode, , oid] = record.slice(0, tab).split(' ')
    entries.set(record.slice(tab + 1), { mode, oid })
  }

  return entries
}

/** The allow-listed root a path lies under, or `null` — the whole of the boundary test. */
export function publicationRootOf(path) {
  return PUBLICATION_ROOTS.find((root) => path.startsWith(`${root}/`)) ?? null
}

/**
 * Why this path may not be published, or `null` when it may.
 *
 * The order matters: the allow-list first, because a path outside it is not a
 * publication input at all; then the mode, because a symbolic link is refused as a
 * link rather than as a name; then the shape of every segment; then the news rule.
 */
export function publicationPathProblem(path, mode) {
  if (publicationRootOf(path) === null) {
    return `it is not under ${PUBLICATION_ROOTS.map((root) => `${root}/`).join(' or ')}`
  }

  if (mode !== PUBLICATION_FILE_MODE) {
    const what =
      mode === '120000'
        ? 'a symbolic link'
        : mode === '160000'
          ? 'a submodule'
          : mode === '100755'
            ? 'executable'
            : `mode ${mode}`
    return `it is ${what}, and a publication input is a plain non-executable file (${PUBLICATION_FILE_MODE})`
  }

  if (isAbsolute(path) || path.startsWith('/')) return 'it is an absolute path'
  if (path.includes('\\')) return 'it contains a backslash'

  const segments = path.split('/')
  for (const [index, segment] of segments.entries()) {
    if (segment === '') return 'it has an empty path segment'
    if (segment === '.' || segment === '..') return `it has a "${segment}" path segment`
    // The one tracked dotfile, and only as a file name — never as a directory.
    if (segment === TRACKED_DOTFILE && index === segments.length - 1) continue
    if (!SAFE_SEGMENT.test(segment)) {
      return `"${segment}" is not a plain name (letters, digits, dot, dash, underscore, not dot-prefixed)`
    }
  }

  if (path.startsWith(`${NEWS_DIRECTORY}/`)) {
    const name = path.slice(NEWS_DIRECTORY.length + 1)
    if (name.includes('/')) {
      return `${NEWS_DIRECTORY}/ holds one file per article and no subdirectories`
    }
    if (name !== TRACKED_DOTFILE) {
      if (!name.endsWith('.json')) return 'a news article is a .json file'
      if (!NEWS_SLUG_PATTERN.test(name.slice(0, -'.json'.length))) {
        return `"${name}" is not <slug>.json — lower-case letters, digits and single hyphens`
      }
    }
  }

  if (path.startsWith(`${PHOTO_DIRECTORY}/`)) {
    const name = path.slice(PHOTO_DIRECTORY.length + 1)
    if (name.includes('/')) {
      return `${PHOTO_DIRECTORY}/ holds one file per photograph and no subdirectories`
    }
    // The site's own photograph vocabulary, asked of the name rather than restated:
    // a lower-case slug and one of the four raster extensions. It is what refuses
    // `foo.svg`, `foo.html`, `foo.js`, `My Photo.png`, `foo_bar.png` — and `.gitkeep`,
    // which this directory does not track, because it is never empty.
    if (!isPhotoFileName(name)) {
      return `"${name}" is not <navn>.${PHOTO_EXTENSIONS.join('|')} — lower-case letters, digits and single hyphens`
    }
  }

  return null
}

/**
 * The publication tree: `main`, with both allow-listed roots replaced wholesale by the
 * content commit's.
 *
 * Refuses — before anything is written — if any incoming path fails
 * {@link publicationPathProblem}, collecting every problem rather than stopping at the
 * first. Then asserts the result independently: every path that differs from `main`
 * must lie under an allow-listed root. That second check cannot fail given the first,
 * which is the point of having it — it is the invariant this script exists to hold, so
 * it is stated as an assertion rather than left as a property of the code above it.
 */
export function composePublication({ repo, mainRef = 'origin/main', contentRef }) {
  const mainSha = resolveCommit(repo, mainRef)
  const contentSha = resolveCommit(repo, contentRef)

  const base = readTree(repo, mainSha)
  const source = readTree(repo, contentSha)

  const problems = []
  const incoming = new Map()

  for (const [path, entry] of source) {
    if (publicationRootOf(path) === null) continue
    const problem = publicationPathProblem(path, entry.mode)
    if (problem === null) incoming.set(path, entry)
    else problems.push(`${path}: ${problem}`)
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to compose a publication from ${contentRef} — ` +
        `${problems.length} path(s) may not be published:\n  ${problems.join('\n  ')}`,
    )
  }

  const publication = new Map()
  for (const [path, entry] of base) {
    if (publicationRootOf(path) === null) publication.set(path, entry)
  }
  for (const [path, entry] of incoming) publication.set(path, entry)

  const changes = { added: [], removed: [], modified: [] }
  for (const [path, entry] of publication) {
    const before = base.get(path)
    if (before === undefined) changes.added.push(path)
    else if (before.oid !== entry.oid || before.mode !== entry.mode) changes.modified.push(path)
  }
  for (const path of base.keys()) {
    if (!publication.has(path)) changes.removed.push(path)
  }
  for (const list of Object.values(changes)) list.sort()

  const escaped = [...changes.added, ...changes.removed, ...changes.modified].filter(
    (path) => publicationRootOf(path) === null,
  )
  if (escaped.length > 0) {
    throw new Error(
      `Refusing to publish: ${escaped.length} changed path(s) outside ${PUBLICATION_ROOTS.join(', ')}:\n  ${escaped.join('\n  ')}`,
    )
  }

  const count = changes.added.length + changes.removed.length + changes.modified.length
  return { mainSha, contentSha, incoming, publication, changes, changed: count > 0 }
}

/**
 * Write the two roots into a working tree that is already at the main commit.
 *
 * The roots are removed and then written back from the content commit's blobs, which
 * is how a deletion and a rename take effect: nothing merges, the snapshot replaces.
 * Two conditions are checked first — the tree is at the main commit, and it is clean
 * under both roots — so this can neither publish onto the wrong base nor quietly
 * discard somebody's local edit. Each destination is resolved and required to stay
 * inside the target directory: the second lock on the door
 * {@link publicationPathProblem} already holds shut.
 */
export function applyPublication({ repo, into, mainSha, incoming }) {
  const target = resolve(into)

  const head = git(target, ['rev-parse', 'HEAD']).trim()
  if (head !== mainSha) {
    throw new Error(`${target} is at ${head}, not at the main commit ${mainSha}.`)
  }

  const dirty = git(target, ['status', '--porcelain', '--', ...PUBLICATION_ROOTS]).trim()
  if (dirty !== '') {
    throw new Error(`${target} has uncommitted changes under the publication roots:\n${dirty}`)
  }

  for (const root of PUBLICATION_ROOTS) {
    rmSync(join(target, root), { recursive: true, force: true })
  }

  for (const [path, entry] of incoming) {
    const file = resolve(target, path)
    const inside = relative(target, file)
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      throw new Error(`Refusing to write outside ${target}: ${path}`)
    }
    mkdirSync(dirname(file), { recursive: true })
    // The stored blob, byte for byte: no encoding, no line-ending conversion.
    writeFileSync(file, git(repo, ['cat-file', 'blob', entry.oid], null))
  }
}

/** The dry run's report, for a human reading a log. */
function formatReport({ mainSha, contentSha, changes, changed }, { mainRef, contentRef }) {
  const lines = [
    `main    ${mainSha}  (${mainRef})`,
    `content ${contentSha}  (${contentRef})`,
    '',
  ]

  if (!changed) {
    lines.push('Nothing to publish: the content branch matches main under')
    lines.push(`${PUBLICATION_ROOTS.map((root) => `  ${root}/`).join('\n')}`)
    return lines.join('\n')
  }

  for (const path of changes.added) lines.push(`A  ${path}`)
  for (const path of changes.removed) lines.push(`D  ${path}`)
  for (const path of changes.modified) lines.push(`M  ${path}`)
  lines.push('')
  lines.push(
    `${changes.added.length} added, ${changes.removed.length} deleted, ${changes.modified.length} modified — all inside ${PUBLICATION_ROOTS.map((root) => `${root}/`).join(', ')}.`,
  )

  return lines.join('\n')
}

function main() {
  const { values } = parseArgs({
    options: {
      content: { type: 'string' },
      main: { type: 'string', default: 'origin/main' },
      repo: { type: 'string', default: process.cwd() },
      into: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  })

  if (values.content === undefined) {
    console.error('compose-publication: --content <ref> is required (the CMS branch or SHA).')
    process.exit(2)
  }

  const options = { repo: resolve(values.repo), mainRef: values.main, contentRef: values.content }

  let composed
  try {
    composed = composePublication(options)
  } catch (error) {
    console.error(`compose-publication: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }

  if (values.into !== undefined && composed.changed) {
    try {
      applyPublication({ repo: options.repo, into: values.into, ...composed })
    } catch (error) {
      console.error(`compose-publication: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }
  }

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          main: composed.mainSha,
          content: composed.contentSha,
          roots: PUBLICATION_ROOTS,
          changed: composed.changed,
          ...composed.changes,
        },
        null,
        2,
      ),
    )
  } else {
    console.log(formatReport(composed, options))
    if (values.into !== undefined) {
      console.log(
        composed.changed
          ? `Written into ${resolve(values.into)}.`
          : `${resolve(values.into)} left untouched.`,
      )
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
