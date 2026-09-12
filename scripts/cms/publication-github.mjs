#!/usr/bin/env node
/**
 * The GitHub side of a publication: who it is committed as, and which pull request
 * carries it.
 *
 * Four commands, because a publication needs GitHub at four different moments:
 *
 *     quiesce    first of all       — the publication already in flight, disarmed
 *     identity   before the commit  — the publishing App's bot account, as a git identity
 *     pr         after the push     — one pull request, reused or created, set to auto-merge
 *     supersede  when nothing to do — the publication already in flight, closed
 *
 * WHY A RUN BEGINS BY DISARMING THE PREVIOUS PUBLICATION. There is one publication
 * branch and at most one open publication pull request, and it waits on auto-merge —
 * which means it is armed: the moment its checks go green, GitHub lands it. A newer
 * CMS save must win against an older one, and it cannot win a race it does not enter.
 * So the first thing a run does, before it composes or validates anything, is take
 * auto-merge off whatever is open. From that moment the older snapshot cannot land on
 * its own, and every way this run can end is safe: it pushes the newer snapshot and
 * re-arms the pull request, or it finds nothing to publish and closes it, or it fails
 * — and a failed run leaves the older publication open but disarmed, which is a
 * decision waiting for a person rather than a merge waiting for a timer.
 *
 * `supersede` is the second half of that, for the case the stale guard cannot see: the
 * owner saved B, then saved A again, and A is what `main` already has. There is
 * nothing to publish and nothing to push — but B's pull request is still open, and
 * leaving it open would let the older save beat the newer one. It is closed instead.
 *
 * WHY THE IDENTITY IS LOOKED UP RATHER THAN WRITTEN DOWN. `main` is protected by a
 * ruleset that requires an extra approval for *unattributed* changes — a commit whose
 * author email GitHub cannot match to an account. A publication has no human approver
 * (the rule asks for zero reviews and three passing checks instead), so a commit that
 * failed to attribute would simply never merge. The bot's noreply address is built from
 * its numeric account id, and the only honest source of that id is GitHub: this asks
 * for it at run time, from the App slug the token step reports, so an App rename or a
 * reinstallation cannot leave a stale constant behind to quietly break merging.
 *
 * WHY AUTO-MERGE RATHER THAN A MERGE. Nothing here merges anything. Auto-merge hands
 * the decision back to the branch ruleset: GitHub merges the pull request if and only
 * if the three required checks pass, and otherwise leaves it open. That is the whole
 * safety property — the publication workflow cannot put anything on `main` that CI has
 * not agreed to, and it holds no permission that would let it try.
 *
 * CREDENTIALS AND ADDRESSES COME FROM THE ENVIRONMENT. The installation token arrives
 * as `GITHUB_APP_TOKEN` and is never a command-line argument, which would put it in the
 * process table and in any log that echoes a command. The two API addresses are the
 * `GITHUB_API_URL` and `GITHUB_GRAPHQL_URL` the runner already sets, so no host is
 * written down here.
 *
 * USAGE
 *
 *     node scripts/cms/publication-github.mjs quiesce   --head <branch> --base <branch>
 *     node scripts/cms/publication-github.mjs identity  --app-slug <slug>
 *     node scripts/cms/publication-github.mjs pr --head <branch> --base <branch> \
 *                                                --content-sha <sha> --main-sha <sha> \
 *                                                --source <owner/repo:branch>
 *     node scripts/cms/publication-github.mjs supersede --head <branch> --base <branch> \
 *                                                       --content-sha <sha> \
 *                                                       --source <owner/repo:branch>
 *
 * `--source` is the source the snapshot was read from, as `publication-source.mjs`
 * spells it. It is required, not defaulted: while Pages CMS is being migrated into a
 * repository of its own there are two places a publication can come from, and a body
 * that stated a SHA without saying whose would be a body nobody could check.
 */

import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { PUBLICATION_ROOTS } from './compose-publication.mjs'
import { describeSource } from './publication-source.mjs'

/**
 * How a publication lands once its checks pass.
 *
 * Squash, so `main` gains one commit per publication whatever the branch looked like,
 * and because it is the strategy this repository's ruleset allows and Phase 5A proved
 * end to end.
 */
const MERGE_METHOD = 'SQUASH'

/** The pull request's title. Stable: it is how an existing publication PR is recognised by a human. */
const PR_TITLE = 'CMS content publication'

/**
 * GitHub's reply when auto-merge is asked for on a pull request that could already be
 * merged right now. It is not a failure — there is simply nothing to wait for — and
 * the publication flow cannot normally reach it, because a fresh push always leaves
 * the required checks pending.
 */
const ALREADY_MERGEABLE = /clean status/i

/**
 * GitHub's reply when auto-merge is taken off a pull request that did not have it.
 * `quiesce` asks unconditionally rather than trusting the `auto_merge` field it read a
 * moment earlier, so this is the ordinary answer when the previous run already ended
 * with the pull request disarmed. Narrow on purpose: every other GraphQL error still
 * fails the run.
 */
const AUTO_MERGE_NOT_ENABLED = /auto[ -]?merge is not enabled/i

function required(name) {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set; this command runs inside GitHub Actions.`)
  }
  return value
}

async function rest(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${required('GITHUB_API_URL')}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${required('GITHUB_APP_TOKEN')}`,
      'x-github-api-version': '2022-11-28',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  const payload = text.trim() === '' ? null : JSON.parse(text)

  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${payload?.message ?? text}`)
  }
  return payload
}

async function graphql(query, variables) {
  const response = await fetch(required('GITHUB_GRAPHQL_URL'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${required('GITHUB_APP_TOKEN')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  const payload = await response.json()
  if (!response.ok) throw new Error(`GraphQL → ${response.status}: ${JSON.stringify(payload)}`)
  return payload
}

/**
 * The two ways this module talks to GitHub, in one object.
 *
 * Every exported operation takes it as its last argument and defaults to this, so a
 * test can hand the same code a pair of fakes and watch what it asks for, in what
 * order. There is no other reason for the indirection: nothing swaps it at run time.
 */
const githubApi = { rest, graphql }

/** The owner and repository this run belongs to, from the one variable the runner always sets. */
export function repositorySlug(value = required('GITHUB_REPOSITORY')) {
  const parts = value.split('/')
  if (parts.length !== 2 || parts.some((part) => part === '')) {
    throw new Error(`GITHUB_REPOSITORY is "${value}", not "<owner>/<repo>".`)
  }
  const [owner, repo] = parts
  return { owner, repo }
}

/**
 * The standard noreply address for a GitHub account, which is how a commit is attributed
 * to it: the numeric id, a `+`, the login, at GitHub's noreply host.
 */
export function botNoreplyEmail({ id, login }) {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`"${id}" is not a GitHub account id.`)
  return `${id}+${login}@users.noreply.github.com`
}

/** The bot login a GitHub App publishes under: its slug, with the suffix GitHub gives every App account. */
export function botLoginFor(appSlug) {
  if (typeof appSlug !== 'string' || appSlug === '') {
    throw new Error('The token step reported no App slug; the identity cannot be resolved.')
  }
  return `${appSlug}[bot]`
}

/** Ask GitHub for the App's bot account, and turn it into the git identity a commit is made with. */
export async function resolveIdentity(appSlug) {
  const login = botLoginFor(appSlug)
  const account = await rest(`/users/${encodeURIComponent(login)}`)

  if (account.type !== 'Bot') {
    throw new Error(`"${login}" is a ${account.type}, not a Bot account.`)
  }

  return { login: account.login, id: account.id, email: botNoreplyEmail(account) }
}

/**
 * The pull request's body: what produced it, what it was produced from, and what it is
 * allowed to contain.
 *
 * Both SHAs in full, because they are the only two facts that make a publication
 * reproducible. Nothing else — no timestamp, no run number, nothing that would differ
 * between two publications of the same content.
 *
 * `source` is the third fact, and it is required rather than defaulted: while the CMS
 * is being migrated out of this repository there are two places a publication can have
 * been read from, and a body that named neither would leave a reader guessing which
 * repository and which branch the SHA above belongs to.
 */
export function publicationBody({ contentSha, mainSha, source }) {
  return [
    'Generated from Pages CMS content by `.github/workflows/cms-publish.yml`. Nothing here was written by hand.',
    '',
    `- Source content: \`${describeSource({ label: source, sha: contentSha })}\``,
    `- Composed on: \`${mainSha}\` (\`main\` when this publication was built)`,
    `- Publishable paths: ${PUBLICATION_ROOTS.map((root) => `\`${root}/**\``).join(' and ')}, and nothing else — every other path in this branch is \`main\`'s own.`,
    '- `npm run check:content` passed against this tree, and no path outside those roots differs from `main`, before this pull request was opened.',
    '',
    'The required checks decide whether it lands: auto-merge is enabled, and nothing merges it otherwise.',
  ].join('\n')
}

/**
 * The body a superseded publication is closed with.
 *
 * The pull request it replaces states two SHAs it was composed from; this states why
 * those SHAs stopped mattering, so the closed pull request explains itself to whoever
 * finds it later without having to go and read a workflow run.
 */
export function supersededBody({ contentSha, source }) {
  return [
    'Superseded, and closed by `.github/workflows/cms-publish.yml`.',
    '',
    `A later CMS save left \`${describeSource({ label: source, sha: contentSha })}\`, which \`main\` already carries under the publishable paths: there is nothing left for this publication to publish.`,
    '',
    'Closing it is the point. Left open it would still be a route for the older content it was composed from to reach `main` after the newer save had replaced it.',
  ].join('\n')
}

/**
 * The one open pull request from `head` to `base`, or `null`.
 *
 * The single definition of "the current publication pull request" — `quiesce`, `pr` and
 * `supersede` all ask this, so all three mean the same thing by it. Refuses to guess if
 * there is more than one: two open publications is a state this workflow cannot create
 * and must not act on blindly.
 */
export async function findOpenPullRequest({ owner, repo, head, base }, api = githubApi) {
  const open = await api.rest(
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`,
  )

  if (open.length > 1) {
    throw new Error(
      `${open.length} open pull requests from ${head} to ${base} (#${open.map((pull) => pull.number).join(', #')}); there must be at most one.`,
    )
  }
  return open[0] ?? null
}

/**
 * Take auto-merge off a pull request, so nothing lands it but a person.
 *
 * Asked unconditionally, whatever `auto_merge` said on the object that was read a
 * moment ago: the field is a snapshot and the point of this call is that there is no
 * window left in which the pull request is still armed. The only tolerated failure is
 * GitHub saying it was not armed in the first place.
 */
async function disableAutoMerge(pullRequest, api = githubApi) {
  const { errors } = await api.graphql(
    `mutation ($pullRequestId: ID!) {
       disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
         pullRequest { number }
       }
     }`,
    { pullRequestId: pullRequest.node_id },
  )

  if (errors === undefined) {
    console.log(`Auto-merge disabled on #${pullRequest.number}.`)
    return { disabled: true }
  }

  const messages = errors.map((error) => error.message)
  if (messages.some((message) => AUTO_MERGE_NOT_ENABLED.test(message))) {
    console.log(`#${pullRequest.number} did not have auto-merge enabled; nothing to disable.`)
    return { disabled: false }
  }

  throw new Error(`Could not disable auto-merge on #${pullRequest.number}: ${messages.join('; ')}`)
}

/**
 * Disarm the publication already in flight, before this run composes anything.
 *
 * Called first, and gated on nothing: whether this run goes on to publish, to find
 * nothing to publish, or to fail, the older publication must not be able to merge
 * itself in the meantime. Re-arming is `pr`'s job and happens only once the newer
 * snapshot is on the branch.
 */
export async function quiescePublication({ head, base }, api = githubApi) {
  const { owner, repo } = repositorySlug()
  const existing = await findOpenPullRequest({ owner, repo, head, base }, api)

  if (existing === null) {
    console.log(`No open pull request from ${head} to ${base}; there is nothing in flight.`)
    return { found: false, number: '', disabled: false }
  }

  const { disabled } = await disableAutoMerge(existing, api)
  return { found: true, number: existing.number, disabled }
}

/**
 * Close the publication already in flight, because this run found nothing to publish.
 *
 * Auto-merge is off it already — `quiesce` ran at the top of this run — so this closes
 * a pull request that is going nowhere on its own. It is still the step that makes the
 * newer save win: an open publication is a publication that a person, or a re-run of
 * its checks, could still land.
 */
export async function supersedePublication({ head, base, contentSha, source }, api = githubApi) {
  const { owner, repo } = repositorySlug()
  const existing = await findOpenPullRequest({ owner, repo, head, base }, api)

  if (existing === null) {
    console.log(`No open pull request from ${head} to ${base}; there is nothing to supersede.`)
    return { found: false, number: '', closed: false }
  }

  await api.rest(`/repos/${owner}/${repo}/pulls/${existing.number}`, {
    method: 'PATCH',
    body: { state: 'closed', body: supersededBody({ contentSha, source }) },
  })
  console.log(`Closed #${existing.number}: it published content ${base} already carries.`)

  return { found: true, number: existing.number, closed: true }
}

/** Ask GitHub to merge the pull request when — and only when — its required checks pass. */
async function enableAutoMerge(pullRequest, api = githubApi) {
  const { errors } = await api.graphql(
    `mutation ($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
       enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
         pullRequest { number }
       }
     }`,
    { pullRequestId: pullRequest.node_id, mergeMethod: MERGE_METHOD },
  )

  if (errors === undefined) {
    console.log(`Auto-merge enabled on #${pullRequest.number} (${MERGE_METHOD}).`)
    return
  }

  const messages = errors.map((error) => error.message)
  if (messages.some((message) => ALREADY_MERGEABLE.test(message))) {
    console.log(
      `#${pullRequest.number} already has everything it needs to merge, so GitHub has nothing to wait for and auto-merge was not set.`,
    )
    return
  }

  throw new Error(`Could not enable auto-merge on #${pullRequest.number}: ${messages.join('; ')}`)
}

/**
 * One pull request for the snapshot now on the publication branch, and auto-merge back
 * on it.
 *
 * The re-arming is the last thing that happens, and only here: the branch already
 * carries the newer snapshot by the time this runs, so what auto-merge is enabled on is
 * what this run composed and validated — never the older publication `quiesce` disarmed.
 */
export async function openPublication({ head, base, contentSha, mainSha, source }, api = githubApi) {
  const { owner, repo } = repositorySlug()
  const body = publicationBody({ contentSha, mainSha, source })

  const existing = await findOpenPullRequest({ owner, repo, head, base }, api)
  let pullRequest

  if (existing === null) {
    pullRequest = await api.rest(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: { title: PR_TITLE, head, base, body },
    })
    console.log(`Opened #${pullRequest.number} — ${head} → ${base}.`)
  } else {
    // Reused, not replaced: the branch already carries the new snapshot, so all the
    // pull request needs is a body that names the content it now holds.
    pullRequest = await api.rest(`/repos/${owner}/${repo}/pulls/${existing.number}`, {
      method: 'PATCH',
      body: { body },
    })
    console.log(`Reusing #${pullRequest.number} — ${head} → ${base}.`)
  }

  await enableAutoMerge(pullRequest, api)

  return { number: pullRequest.number, url: pullRequest.html_url, created: existing === null }
}

function emit(entries) {
  for (const [key, value] of Object.entries(entries)) console.log(`${key}: ${value}`)
  if (process.env.GITHUB_OUTPUT !== undefined) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(entries)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    )
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'app-slug': { type: 'string' },
      head: { type: 'string' },
      base: { type: 'string' },
      'content-sha': { type: 'string' },
      'main-sha': { type: 'string' },
      // `<owner>/<repo>:<branch>`, from `publication-source.mjs`. Every body this
      // writes names it, so neither command may be run without one.
      source: { type: 'string' },
    },
  })

  const [command] = positionals

  /** Exits 2 unless every named option was given: a missing one is a mistake in the workflow, not a run to attempt. */
  function demand(...names) {
    const missing = names.filter((option) => values[option] === undefined)
    if (missing.length > 0) {
      console.error(
        `publication-github: ${command} needs ${missing.map((option) => `--${option}`).join(', ')}.`,
      )
      process.exit(2)
    }
  }

  if (command === 'identity') {
    const identity = await resolveIdentity(values['app-slug'])
    emit({ login: identity.login, email: identity.email })
    return
  }

  if (command === 'quiesce') {
    demand('head', 'base')
    const result = await quiescePublication({ head: values.head, base: values.base })
    emit({ found: result.found, number: result.number, disabled: result.disabled })
    return
  }

  if (command === 'supersede') {
    demand('head', 'base', 'content-sha', 'source')
    const result = await supersedePublication({
      head: values.head,
      base: values.base,
      contentSha: values['content-sha'],
      source: values.source,
    })
    emit({ found: result.found, number: result.number, closed: result.closed })
    return
  }

  if (command === 'pr') {
    demand('head', 'base', 'content-sha', 'main-sha', 'source')

    const result = await openPublication({
      head: values.head,
      base: values.base,
      contentSha: values['content-sha'],
      mainSha: values['main-sha'],
      source: values.source,
    })
    emit({ number: result.number, url: result.url, created: result.created })
    return
  }

  console.error('publication-github: expected "quiesce", "identity", "pr" or "supersede".')
  process.exit(2)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`publication-github: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
}
