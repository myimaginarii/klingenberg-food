#!/usr/bin/env node
/**
 * The GitHub side of a publication: who it is committed as, and which pull request
 * carries it.
 *
 * Two commands, because a publication needs GitHub twice and at two different moments:
 *
 *     identity   before the commit — the publishing App's bot account, as a git identity
 *     pr         after the push    — one pull request, reused or created, set to auto-merge
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
 *     node scripts/cms/publication-github.mjs identity --app-slug <slug>
 *     node scripts/cms/publication-github.mjs pr --head <branch> --base <branch> \
 *                                                --content-sha <sha> --main-sha <sha>
 */

import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { PUBLICATION_ROOTS } from './compose-publication.mjs'

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
 */
export function publicationBody({ contentSha, mainSha }) {
  return [
    'Generated from Pages CMS content by `.github/workflows/cms-publish.yml`. Nothing here was written by hand.',
    '',
    `- Source content: \`${contentSha}\` (the \`content\` branch)`,
    `- Composed on: \`${mainSha}\` (\`main\` when this publication was built)`,
    `- Publishable paths: ${PUBLICATION_ROOTS.map((root) => `\`${root}/**\``).join(' and ')}, and nothing else — every other path in this branch is \`main\`'s own.`,
    '- `npm run check:content` passed against this tree, and no path outside those roots differs from `main`, before this pull request was opened.',
    '',
    'The required checks decide whether it lands: auto-merge is enabled, and nothing merges it otherwise.',
  ].join('\n')
}

/** The one open pull request from `head` to `base`, or `null`. Refuses to guess if there is more than one. */
async function findOpenPullRequest({ owner, repo, head, base }) {
  const open = await rest(
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`,
  )

  if (open.length > 1) {
    throw new Error(
      `${open.length} open pull requests from ${head} to ${base} (#${open.map((pull) => pull.number).join(', #')}); there must be at most one.`,
    )
  }
  return open[0] ?? null
}

/** Ask GitHub to merge the pull request when — and only when — its required checks pass. */
async function enableAutoMerge(pullRequest) {
  const { errors } = await graphql(
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

async function openPublication({ head, base, contentSha, mainSha }) {
  const { owner, repo } = repositorySlug()
  const body = publicationBody({ contentSha, mainSha })

  const existing = await findOpenPullRequest({ owner, repo, head, base })
  let pullRequest

  if (existing === null) {
    pullRequest = await rest(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: { title: PR_TITLE, head, base, body },
    })
    console.log(`Opened #${pullRequest.number} — ${head} → ${base}.`)
  } else {
    // Reused, not replaced: the branch already carries the new snapshot, so all the
    // pull request needs is a body that names the content it now holds.
    pullRequest = await rest(`/repos/${owner}/${repo}/pulls/${existing.number}`, {
      method: 'PATCH',
      body: { body },
    })
    console.log(`Reusing #${pullRequest.number} — ${head} → ${base}.`)
  }

  await enableAutoMerge(pullRequest)

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
    },
  })

  const [command] = positionals

  if (command === 'identity') {
    const identity = await resolveIdentity(values['app-slug'])
    emit({ login: identity.login, email: identity.email })
    return
  }

  if (command === 'pr') {
    const missing = ['head', 'base', 'content-sha', 'main-sha'].filter(
      (option) => values[option] === undefined,
    )
    if (missing.length > 0) {
      console.error(`publication-github: pr needs ${missing.map((o) => `--${o}`).join(', ')}.`)
      process.exit(2)
    }

    const result = await openPublication({
      head: values.head,
      base: values.base,
      contentSha: values['content-sha'],
      mainSha: values['main-sha'],
    })
    emit({ number: result.number, url: result.url, created: result.created })
    return
  }

  console.error('publication-github: expected "identity" or "pr".')
  process.exit(2)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`publication-github: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
}
