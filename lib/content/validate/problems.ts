/**
 * What a content problem is, and how it is said — phase 3 of the CMS migration.
 *
 * Everything under `content/site/` is edited by the restaurant, and after Pages CMS
 * lands it will be edited from a browser by somebody who does not read TypeScript.
 * So a refusal here is not a stack trace and not a schema path: it is a sentence in
 * Danish that names the file, the thing inside it, and what a usable value looks like.
 *
 *     content/site/menu.json → Burgere → Odin → price
 *       Prisen skrives i kroner, f.eks. "89" eller "89,50". Fik: 89.
 *
 * A {@link Problem} is that pair and nothing more — no code, no severity, no cause
 * chain. There is one kind of problem (the content is wrong and the build must stop),
 * so a hierarchy would be a hierarchy of one.
 *
 * WHY PROBLEMS ARE COLLECTED RATHER THAN THROWN. A validator returns every problem it
 * finds, so `npm run check:content` can list all of them at once: an editor who has
 * mistyped three prices should see three lines, not fix one and run again. The
 * loaders turn that list into a single throw ({@link assertValid}) at the moment they
 * read the file, which is what keeps a malformed document from ever reaching a page.
 */

/** One thing that is wrong with the tracked content. */
export type Problem = {
  /** `content/site/menu.json → Burgere → Odin → price` — the file, then the way in. */
  readonly where: string
  /** One or two Danish sentences: what is wrong, and what a valid value looks like. */
  readonly message: string
}

/** The way into a value, as an error prints it. The first part is always the file. */
export function at(...parts: readonly (string | number)[]): string {
  return parts.join(' → ')
}

/**
 * How an entry inside a list is named on the way in: by whatever the editor already
 * wrote there — "Burgere", "Odin", "2026-12-24" — falling back to its position when
 * that field is still empty. An index is a poor address for a person reading a list.
 */
export function readableName(entry: unknown, key: string, fallback: string): string {
  const name = (entry as Record<string, unknown> | null | undefined)?.[key]
  return typeof name === 'string' && name.trim().length > 0 ? name : fallback
}

/** Record a problem. A plain array is the whole collector; nothing else is needed. */
export function add(problems: Problem[], where: string, message: string): void {
  problems.push({ where, message })
}

/** The value as it should be quoted back to the person who wrote it. */
export function shown(value: unknown): string {
  if (value === undefined) return 'ingenting'
  return JSON.stringify(value) ?? String(value)
}

/** Every problem as one readable block of text, in the order they were found. */
export function formatProblems(problems: readonly Problem[]): string {
  return problems.map((problem) => `${problem.where}\n  ${problem.message}`).join('\n\n')
}

/**
 * Throw if the content is not usable — the form the loaders need.
 *
 * One error carrying every problem, rather than one error per problem: a build that
 * stops should say everything it knows, and `cause`-chaining sentences an editor has
 * to read would only hide the later ones.
 */
export function assertValid(problems: readonly Problem[]): void {
  if (problems.length === 0) return

  const count = problems.length === 1 ? '1 fejl' : `${problems.length} fejl`
  throw new Error(`Indholdet kan ikke bruges (${count}):\n\n${formatProblems(problems)}`)
}
