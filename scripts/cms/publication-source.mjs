#!/usr/bin/env node
/**
 * Where a publication reads the restaurant's edits from — and the fact that there is
 * exactly one answer, written down here.
 *
 * WHY THIS EXISTS. Pages CMS writes into `myimaginarii/klingenberg-content`, a
 * repository that holds the restaurant's edits and nothing else, so the account which
 * can write them has no reach at all over the code, the workflows or the App key that
 * publishes them. Pages CMS used to write into this repository's own `content` branch;
 * the security migration (Phase S4A) retired that as a source, and nothing here can read
 * it any more.
 *
 * THE SOURCE IS FIXED, NOT CHOSEN. The owner, the repository and the branch are
 * constants in this file, and nothing a caller passes can change them: the function
 * takes no source name, the command takes no arguments, and the workflow declares no
 * inputs (Phase S4B-2B removed the last one, a one-word `source` selector). A dispatch
 * cannot ask for `some/other-repo`, a fork, a tag, a pull request ref or an arbitrary
 * SHA — there is nowhere for one to arrive.
 *
 * THE CONTENT REPOSITORY IS DATA, NOT CODE. Nothing here checks it out, runs it, or
 * reads anything from it but git objects. `remote` is a URL the publisher *fetches
 * objects from*; `ref` is where those objects are parked — deliberately outside
 * `refs/heads/`, so no push can ever carry it and no checkout can land on it. What may
 * then cross into a publication is decided where it has always been decided, by the
 * positive allow-list in `compose-publication.mjs`: `content/site/**` and
 * `public/photos/**`, and not one byte else. A `.pages.yml`, a `README.md`, a
 * `package.json`, a workflow or a hook in the content repository is not excluded by a
 * rule naming it — it is simply never selected.
 *
 * THE FETCH IS UNAUTHENTICATED, ON PURPOSE. The content repository is public, so read
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
 *     node scripts/cms/publication-source.mjs
 *
 * Prints the source and, under GitHub Actions, writes it to `$GITHUB_OUTPUT` as
 * `repository`, `branch`, `remote`, `ref`, `header_reset` and `label`. Any argument is
 * refused: the command has nothing to be told.
 */

import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

/** The repository Pages CMS writes to. Fixed here; no input can name another. */
export const EXTERNAL_CONTENT_REPOSITORY = 'myimaginarii/klingenberg-content'

/** The one branch of it that is ever read. Fixed here; no input can name another. */
export const EXTERNAL_CONTENT_BRANCH = 'main'

/**
 * Where the content repository's objects are parked once fetched.
 *
 * Outside `refs/heads/` deliberately. A `git push origin HEAD:refs/heads/…` pushes what
 * is reachable from `HEAD`, and a branch checkout can only name a head — so untrusted
 * history sitting here can be read by `git ls-tree` and `git cat-file` (which is all a
 * publication needs of it) and can be neither pushed nor checked out by accident.
 */
export const EXTERNAL_CONTENT_REF = 'refs/cms/external-content'

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

/** The read-only clone URL of the content repository, on the server the runner names. */
export function externalContentUrl(serverUrl = required('GITHUB_SERVER_URL')) {
  return `${serverOrigin(serverUrl)}/${EXTERNAL_CONTENT_REPOSITORY}.git`
}

/**
 * The `git -c` argument that drops the checkout's `Authorization` header for one command.
 *
 * `actions/checkout` writes the installation token into this repository's local git
 * config as `http.<server>/.extraheader`, which git then sends to every URL on that
 * server — including the content repository's. Git documents an empty value as
 * resetting the header list, so this makes the fetch genuinely anonymous rather than
 * merely unnecessary to authenticate.
 */
export function unauthenticatedHeaderOption(serverUrl = required('GITHUB_SERVER_URL')) {
  return `http.${serverOrigin(serverUrl)}/.extraheader=`
}

/**
 * The source a publication reads, as the facts the workflow needs to read it.
 *
 * Always the content repository's `main`. The only thing a caller supplies is the
 * server the runner is on, which decides the host of the URL and never the repository,
 * the branch or the ref.
 */
export function publicationSource({ serverUrl = required('GITHUB_SERVER_URL') } = {}) {
  return Object.freeze({
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
  let source
  try {
    // Strict and empty: `--source external`, or anything else, is an error, not ignored.
    parseArgs({ options: {}, strict: true, allowPositionals: false })
    source = publicationSource()
  } catch (error) {
    console.error(`publication-source: ${error instanceof Error ? error.message : error}`)
    process.exit(2)
  }

  emit({
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
