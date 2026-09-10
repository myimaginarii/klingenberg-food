import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The one door onto the tracked JSON under `content/site/`.
 *
 * Every loader in this directory reads through here and nothing else opens a file, so
 * "where does the site's content come from" has exactly one answer. The reads happen
 * while `next build` renders the export — the deployable artefact is `out/`, and no
 * browser ever asks for one of these files.
 *
 * The path is resolved from the process working directory, which is the repository
 * root for `next build`, `next dev` and `vitest` alike (they are all started by an npm
 * script). A failure is reported with the content path that failed rather than the
 * absolute one, because the person who has to fix it is looking at the repository.
 *
 * EACH FILE IS PARSED ONCE per process, and each loader builds its domain value once
 * ({@link once}). That is not only cheaper — it is what keeps the rendered output
 * identical to the module constants this replaced. The shell and a page both read the
 * opening hours, and React's payload serialiser writes the second occurrence of a value
 * it has already seen as a back-reference; two equal-but-separate objects would be
 * written out twice. The content is build-time constant and nothing mutates it, so one
 * value per file is the honest model as well as the small one.
 *
 * The consequence, stated so nobody has to discover it: these files are not part of
 * the module graph, so `next dev` neither watches them nor re-reads them. Editing
 * content while a development server is running needs that server restarted. A
 * deployment is unaffected — it is a fresh `next build` over a fresh checkout.
 */

const CONTENT_ROOT = join(process.cwd(), 'content', 'site')

const parsed = new Map<string, unknown>()

/** `content/site/<...>` — the path an error names, as the person fixing it sees it. */
export function contentPath(...segments: readonly string[]): string {
  return `content/site/${segments.join('/')}`
}

/** Parse one tracked JSON file. Throws, naming the file, if it is missing or invalid. */
export function readContentJson<T>(...segments: string[]): T {
  const key = contentPath(...segments)
  if (parsed.has(key)) return parsed.get(key) as T

  let value: T
  try {
    value = JSON.parse(readFileSync(join(CONTENT_ROOT, ...segments), 'utf8')) as T
  } catch (cause) {
    throw new Error(`Tracked content could not be read: ${key}`, { cause })
  }

  parsed.set(key, value)
  return value
}

/**
 * The file names, without their `.json` suffix, of one tracked content directory —
 * sorted, so the answer never depends on the filesystem's own ordering.
 *
 * A directory that does not exist is an empty list rather than a throw: an empty
 * collection is a valid state (there are no news articles), and a *missing* file that
 * something references is reported by the loader that references it, by name.
 */
export function listContentJson(...segments: string[]): string[] {
  let entries
  try {
    entries = readdirSync(join(CONTENT_ROOT, ...segments), { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort()
}

/**
 * A loader that builds its value the first time it is called and hands every later
 * caller that same value. A failure is not remembered: the next call tries again, so
 * an error names the file every time rather than once.
 */
export function once<T>(build: () => T): () => T {
  let built: { value: T } | null = null

  return () => {
    if (built === null) built = { value: build() }
    return built.value
  }
}
