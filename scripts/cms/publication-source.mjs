#!/usr/bin/env node
/**
 * Which repository a publication reads the restaurant's edits from — and the fact that
 * there are exactly two answers, both written down here.
 *
 * WHY THIS EXISTS. Pages CMS used to write into this repository, on the long-lived
 * `content` branch. The security migration moves it into a repository of its own, so
 * that the account which can write the restaurant's edits has no reach at all over the
 * code, the workflows or the App key that publishes them. During the migration the
 * publisher has to be able to read from either place: the internal branch is still the
 * live source and still what the doorbell rings for, while the external repository is
 * selected by hand, by a person, to prove the new path before anything is cut over.
 *
 * THE SOURCE IS A CHOICE BETWEEN TWO NAMES, NEVER A REPOSITORY NAME. The workflow input
 * is `internal` or `external` and nothing else; the owner, the repository and the branch
 * are constants in this file. A dispatch cannot ask for `some/other-repo`, cannot ask
 * for a fork, cannot ask for a tag, a pull request ref or an arbitrary SHA — there is no
 * input that would carry one. That is the whole reason the selector is a word rather
 * than a ref: a ref is a value an attacker could supply, and a word is not.
 *
 * THE EXTERNAL REPOSITORY IS DATA, NOT CODE. Nothing here checks it out, runs it, or
 * reads anything from it but git objects. `remote` is a URL the publisher *fetches
 * objects from*; `ref` is where those objects are parked — deliberately outside
 * `refs/heads/`, so no push can ever carry it and no checkout can land on it. What may
 * then cross into a publication is decided where it has always been decided, by the
 * positive allow-list in `compose-publication.mjs`: `content/site/**` and
 * `public/photos/**`, and not one byte else. A `.pages.yml`, a `README.md`, a
 * `package.json`, a workflow or a hook in the external repository is not excluded by a
 * rule naming it — it is simply never selected.
 *
 * THE FETCH IS UNAUTHENTICATED, ON PURPOSE. The external repository is public, so read
 * access needs no credential; and the publisher holds one — the App installation token
 * `actions/checkout` leaves in this repository's git config as an `Authorization` header
 * for every URL on the GitHub host. {@link unauthenticatedHeaderOption} is the `git -c`
 * argument that empties that header for one command, so the token the publisher pushes
 * with is never presented to the repository the publisher does not trust.
 *
 * NO HOST IS WRITTEN DOWN. The server address comes from `GITHUB_SERVER_URL`, which the
 * runner sets, for the same reason `publication-github.mjs` takes its two API addresses
 * from `GITHUB_API_URL` and `GITHUB_GRAPHQL_URL`.
 *
 * USAGE
 *
 *     node scripts/cms/publication-source.mjs --source internal|external
 *
 * Prints the resolved source and, under GitHub Actions, writes it to `$GITHUB_OUTPUT`
 * as `kind`, `repository`, `branch`, `remote`, `ref`, `header_reset` and `label`.
 */

import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

/** The two answers. Not a list a caller may extend: a list a caller must choose from. */
export const PUBLICATION_SOURCES = Object.freeze(['internal', 'external'])

/** The branch Pages CMS writes to inside this repository — the source being migrated away from. */
export const INTERNAL_CONTENT_BRANCH = 'content'

/** The repository Pages CMS is being moved to. Fixed here; no input can name another. */
export const EXTERNAL_CONTENT_REPOSITORY = 'myimaginarii/klingenberg-content'

/** The one branch of it that is ever read. Fixed here; no input can name another. */
export const EXTERNAL_CONTENT_BRANCH = 'main'

/**
 * Where the external repository's objects are parked once fetched.
 *
 * Outside `refs/heads/` deliberately. A `git push origin HEAD:refs/heads/…` pushes what
 * is reachable from `HEAD`, and a branch checkout can only name a head — so untrusted
 * history sitting here can be read by `git ls-tree` and `git cat-file` (which is all a
 * publication needs of it) and can be neither pushed nor checked out by accident.
 */
export const EXTERNAL_CONTENT_REF = 'refs/cms/external-content'

/** `<owner>/<repo>`, as a label. Not an authorisation check — the shape of a name in a body line. */
const SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

function required(name, value = process.env[name]) {
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set; this command runs inside GitHub Actions.`)
  }
  return value
}

/** A server URL with any trailing slashes removed, so one slash is joined onto it and not two. */
function serverOrigin(serverUrl) {
  const trimmed = String(serverUrl).replace(/\/+$/, '')
  if (!/^https:\/\/[^/\s]+$/.test(trimmed)) {
    throw new Error(`GITHUB_SERVER_URL is "${serverUrl}", not an https origin.`)
  }
  return trimmed
}

/** The read-only clone URL of the external content repository, on the server the runner names. */
export function externalContentUrl(serverUrl = required('GITHUB_SERVER_URL')) {
  return `${serverOrigin(serverUrl)}/${EXTERNAL_CONTENT_REPOSITORY}.git`
}

/**
 * The `git -c` argument that drops the checkout's `Authorization` header for one command.
 *
 * `actions/checkout` writes the installation token into this repository's local git
 * config as `http.<server>/.extraheader`, which git then sends to every URL on that
 * server — including the external repository's. Git documents an empty value as
 * resetting the header list, so this makes the fetch genuinely anonymous rather than
 * merely unnecessary to authenticate.
 */
export function unauthenticatedHeaderOption(serverUrl = required('GITHUB_SERVER_URL')) {
  return `http.${serverOrigin(serverUrl)}/.extraheader=`
}

/**
 * The source a dispatch selected, as the facts the workflow needs to read it.
 *
 * An unrecognised name is refused rather than guessed at. An absent one is `internal`:
 * the doorbell dispatches with no inputs at all, and the source that must survive an
 * omission is the live one.
 */
export function publicationSource(
  name,
  { repository = required('GITHUB_REPOSITORY'), serverUrl = required('GITHUB_SERVER_URL') } = {},
) {
  const selected = name === undefined || name === null || name === '' ? 'internal' : name

  if (!PUBLICATION_SOURCES.includes(selected)) {
    throw new Error(
      `"${selected}" is not a publication source; it is one of ${PUBLICATION_SOURCES.join(', ')}.`,
    )
  }

  if (selected === 'internal') {
    if (!SLUG.test(repository)) {
      throw new Error(`GITHUB_REPOSITORY is "${repository}", not "<owner>/<repo>".`)
    }
    return Object.freeze({
      kind: 'internal',
      repository,
      branch: INTERNAL_CONTENT_BRANCH,
      remote: 'origin',
      ref: `refs/remotes/origin/${INTERNAL_CONTENT_BRANCH}`,
      headerReset: '',
      label: `${repository}:${INTERNAL_CONTENT_BRANCH}`,
    })
  }

  return Object.freeze({
    kind: 'external',
    repository: EXTERNAL_CONTENT_REPOSITORY,
    branch: EXTERNAL_CONTENT_BRANCH,
    remote: externalContentUrl(serverUrl),
    ref: EXTERNAL_CONTENT_REF,
    headerReset: unauthenticatedHeaderOption(serverUrl),
    label: `${EXTERNAL_CONTENT_REPOSITORY}:${EXTERNAL_CONTENT_BRANCH}`,
  })
}

/**
 * How a published snapshot is named everywhere a person reads it: the repository, the
 * branch, and the immutable commit. One spelling, so a commit message, a pull request
 * body and a job summary cannot describe the same publication three different ways.
 */
export function describeSource({ label, sha }) {
  if (typeof label !== 'string' || label === '') throw new Error('A source has a label.')
  if (!/^[0-9a-f]{7,40}$/.test(String(sha))) throw new Error(`"${sha}" is not a commit.`)
  return `${label}@${sha}`
}

function emit(entries) {
  for (const [key, value] of Object.entries(entries)) console.log(`${key}: ${value}`)
  if (process.env.GITHUB_OUTPUT !== undefined) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(entries)
        .map(([key, value]) => `${key}=${value}` + '\n')
        .join(''),
    )
  }
}

function main() {
  const { values } = parseArgs({ options: { source: { type: 'string' } } })

  let source
  try {
    source = publicationSource(values.source)
  } catch (error) {
    console.error(`publication-source: ${error instanceof Error ? error.message : error}`)
    process.exit(2)
  }

  emit({
    kind: source.kind,
    repository: source.repository,
    branch: source.branch,
    remote: source.remote,
    ref: source.ref,
    header_reset: source.headerReset,
    label: source.label,
  })
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
