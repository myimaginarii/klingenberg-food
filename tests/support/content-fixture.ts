import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A copy of `content/site/` somewhere else, and the two questions worth asking of one.
 *
 * The loaders resolve their content from the **process working directory**
 * (`lib/content/load/source.ts`), which is what makes "what would this content render"
 * a question about a whole directory rather than about a value. So a suite that wants
 * to ask it — what does an untouched Pages CMS save change, what does the site look
 * like once the restaurant has actually published something — copies the tracked tree,
 * edits the copy, and runs the repository's own two entry points against it:
 *
 *   * {@link checkContent} is `npm run check:content`, the gate a commit passes.
 *   * {@link loadedContent} is `tests/support/load-content.mjs`, which prints every
 *     domain value the public site is built from, as JSON.
 *
 * Both are separate processes for that one reason, and both are honest: they are the
 * scripts CI runs, not a re-implementation of them. Nothing here writes to the
 * repository — a caller registers {@link removeContentFixtures} in `afterAll` and the
 * temporary trees go away with it.
 */

const ROOT = process.cwd()
const PROBE = join(ROOT, 'tests', 'support', 'load-content.mjs')
const CHECK = join(ROOT, 'scripts', 'check-content.mjs')

const roots: string[] = []

/** Reading and writing one file of a fixture, by its path inside the copy. */
export type ContentFiles = {
  read: (path: string) => unknown
  write: (path: string, value: unknown) => void
}

/**
 * A copy of the real content in a temporary directory, with an edit applied to it.
 * Answers the copy's root, which is the `cwd` the two questions below are asked in.
 */
export function contentFixture(edit: (files: ContentFiles) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'content-fixture-'))
  roots.push(root)

  mkdirSync(join(root, 'content'), { recursive: true })
  cpSync(join(ROOT, 'content', 'site'), join(root, 'content', 'site'), { recursive: true })
  mkdirSync(join(root, 'generated'), { recursive: true })
  cpSync(join(ROOT, 'generated', 'images.json'), join(root, 'generated', 'images.json'))

  edit({
    read: (path) => JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown,
    write: (path, value) => writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`),
  })

  return root
}

/** Run `check:content` over a directory the way CI and a person both run it. */
export function checkContent(cwd: string): { status: number; stderr: string } {
  try {
    execFileSync(process.execPath, [CHECK], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stderr?: string }
    return { status: failure.status ?? -1, stderr: failure.stderr ?? '' }
  }
}

/** What a directory's content loads to, as the JSON the probe prints. */
export function loadedContent(cwd: string): string {
  return execFileSync(process.execPath, [PROBE], { cwd, encoding: 'utf8' })
}

/** Every fixture this process made. Register in `afterAll`. */
export function removeContentFixtures(): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
}
