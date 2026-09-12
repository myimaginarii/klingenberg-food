import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  botLoginFor,
  botNoreplyEmail,
  openPublication,
  publicationBody,
  quiescePublication,
  repositorySlug,
  supersededBody,
  supersedePublication,
} from '../../../scripts/cms/publication-github.mjs'
import { escapedPaths, stagePublication } from '../../../scripts/cms/stage-publication.mjs'

/**
 * The publication workflow — `.github/workflows/cms-publish.yml` — and the two small
 * scripts it leans on.
 *
 * WHAT IS WORTH ASSERTING ABOUT A YAML FILE, and what is not. Most of this workflow is
 * ordinary plumbing that a test could only restate. A handful of its properties are
 * not: they are the difference between a door and a hole, and every one of them is a
 * single edit away from being gone with nothing else to notice. Those are the ones
 * below — the trigger it does *not* have, the permission it does *not* grant, the push
 * it may *not* make, and the fact that each safety step is actually invoked. The file
 * is read as text rather than parsed, because adding a YAML parser to assert four
 * regular expressions would be a worse trade than the regular expressions.
 *
 * `stagePublication` is the last door before a commit exists, so it is exercised over
 * real git repositories rather than asserted about: a fixture whose content changed,
 * one whose code changed, one that changed nothing, and one carrying the build products
 * `.gitignore` excludes — which is what makes staging the *whole* tree safe, and
 * therefore what makes the assertion capable of failing at all.
 */

const WORKFLOW_PATH = join(process.cwd(), '.github', 'workflows', 'cms-publish.yml')
// Line endings normalised first, as the sibling workflow suites do: this project is
// developed with `core.autocrlf=true`, so the working-tree copy is CRLF on Windows and
// LF in CI, and the step-name searches below are anchored on `\n`.
const workflow = readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n/g, '\n')

/**
 * A top-level block of the workflow: from `key:` at column 0 to the next key at column
 * 0, with comment lines dropped. The comments are prose about the rules and would
 * otherwise be matched by assertions meant for the rules themselves.
 */
function topLevelBlock(key) {
  const start = workflow.search(new RegExp(`^${key}:`, 'm'))
  expect(start, `${key}: is missing`).toBeGreaterThanOrEqual(0)
  const rest = workflow.slice(start + key.length + 1)
  const end = rest.search(/^[a-z]/m)
  return (end === -1 ? rest : rest.slice(0, end))
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
}

/**
 * One step of the `publish` job, as text: from its `- name:` line to the next one.
 *
 * Enough to ask what a step is gated on, which is the question the supersession rules
 * turn on — a guard that runs only when the run is already succeeding guards nothing.
 */
function stepBlock(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`)
  expect(start, `there is no step named "${name}"`).toBeGreaterThanOrEqual(0)
  const rest = workflow.slice(start + 1)
  const end = rest.indexOf('\n      - name: ')
  // Without the comments: a block runs up to the next step's `- name:`, so it would
  // otherwise carry that step's prose, and the prose here is about the rules.
  return (end === -1 ? rest : rest.slice(0, end))
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
}

/** Where a step begins in the file, for asking which of two steps runs first. */
function stepAt(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`)
  expect(start, `there is no step named "${name}"`).toBeGreaterThanOrEqual(0)
  return start
}

/** The workflow's `run:` script lines, with backslash continuations joined into one line each. */
function shellLines() {
  return workflow
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .map((line) => line.trim())
}

describe('the publication workflow file', () => {
  it('is reached by a dispatch, and by nothing else', () => {
    const on = topLevelBlock('on')

    expect(on).toMatch(/^\s+workflow_dispatch:/m)
    // Not `push: branches: [content]`, now or later. For a `push`, GitHub reads the
    // workflow files from the commit that was pushed, so a push to `content` can only
    // start workflows that exist on `content` — and this file is main's. A CMS save
    // reaches it through `cms-content-trigger.yml`, the doorbell that does live on
    // `content` and holds nothing but the right to ask for this workflow on `main`.
    expect(on).not.toMatch(/push:/)
    expect(on).not.toMatch(/content/)
    expect(on).not.toMatch(/pull_request:/)
    expect(on).not.toMatch(/schedule:/)
  })

  it('never lets two publications race', () => {
    const concurrency = topLevelBlock('concurrency')

    expect(concurrency).toMatch(/^\s+group:\s*cms-publish\s*$/m)
    expect(concurrency).toMatch(/^\s+cancel-in-progress:\s*true\s*$/m)
  })

  it('grants the workflow token nothing', () => {
    // One `permissions:` key in the file, and it is empty. `permission-contents:` and
    // `permission-pull-requests:` are inputs to the App-token action, not grants to
    // `GITHUB_TOKEN`, and are deliberately not matched by this.
    expect(workflow.match(/^\s*permissions:/gm)).toHaveLength(1)
    expect(workflow).toMatch(/^permissions:\s*\{\}\s*$/m)

    for (const scope of ['contents', 'pull-requests', 'actions', 'workflows', 'id-token']) {
      expect(workflow, scope).not.toMatch(new RegExp(`^\\s*${scope}:\\s*write`, 'm'))
    }
  })

  it('names the App credentials rather than carrying them', () => {
    expect(workflow).toMatch(/client-id:\s*\$\{\{\s*vars\.CMS_PUBLISH_APP_CLIENT_ID\s*\}\}/)
    expect(workflow).toMatch(/private-key:\s*\$\{\{\s*secrets\.CMS_PUBLISH_APP_PRIVATE_KEY\s*\}\}/)

    // Nothing that looks like a key, and no client id sitting in the file next to the
    // reference that is supposed to be the only way to reach one.
    expect(workflow).not.toMatch(/-----BEGIN/)
    expect(workflow).not.toMatch(/\bIv1|\bIv23/)
  })

  it('pins every action it uses by commit SHA', () => {
    // The SHA is followed by a `# vX.Y.Z` comment recording which release it is.
    const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1])

    expect(uses.length).toBeGreaterThan(0)
    for (const action of uses) {
      expect(action, action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
    }
    expect(uses.some((action) => action.startsWith('actions/create-github-app-token@'))).toBe(true)
  })

  it('runs the composer and the two checks that guard it', () => {
    expect(workflow).toContain('scripts/cms/compose-publication.mjs')
    expect(workflow).toContain('npm run check:content')
    expect(workflow).toContain('scripts/cms/stage-publication.mjs')
    // The stale-content guard: the content branch is read a second time, after the
    // first resolution, and compared with the SHA this run composed.
    expect(workflow.match(/git fetch --no-tags origin/g)).toHaveLength(2)
  })

  it('publishes through one stable branch and never pushes to main', () => {
    expect(workflow).toMatch(/^\s*PUBLICATION_BRANCH:\s*cms-publish\s*$/m)
    expect(workflow).toMatch(/^\s*BASE_BRANCH:\s*main\s*$/m)

    const pushes = shellLines().filter((line) => line.includes('git push'))

    expect(pushes.length).toBeGreaterThan(0)
    for (const push of pushes) {
      expect(push, push).toContain('${PUBLICATION_BRANCH}')
      expect(push, push).not.toContain('BASE_BRANCH')
      expect(push, push).not.toMatch(/refs\/heads\/main|:main\b|\bmain:/)
      // A lease, or nothing: an unconditional force push would discard whatever moved
      // the branch instead of failing on it.
      expect(push, push).not.toMatch(/--force(?!-with-lease)/)
    }
    expect(pushes.some((push) => push.includes('--force-with-lease='))).toBe(true)
  })

  it('never interpolates an expression into a shell command', () => {
    // A `${{ ... }}` inside a `run:` body is substituted as text before bash sees it,
    // which turns any value GitHub hands back — an App slug, a URL — into script. Every
    // one of them is the whole value of a `with:` or `env:` key instead, so it reaches
    // the shell as an environment variable and is never parsed as code.
    for (const line of workflow.split('\n')) {
      if (!line.includes('${{')) continue
      expect(line, line).toMatch(/^\s*[A-Za-z_][\w-]*:\s*\$\{\{[^{}]*\}\}\s*$/)
    }
  })

  it('merges nothing itself', () => {
    // Auto-merge is requested; the merge is GitHub's, once the required checks pass.
    expect(workflow).not.toMatch(/\/merge\b/)
    expect(workflow).not.toContain('gh pr merge')
  })

  it('disarms the publication already in flight before it composes anything', () => {
    // The race this closes: the open publication is waiting on auto-merge, so it lands
    // by itself the moment its checks pass. Disarming it at the end — or only on the
    // paths that succeed — would leave the whole composing and validating window open
    // for an older snapshot to beat the newer one that this run exists to publish.
    const quiesce = stepAt('Disarm the publication already in flight')

    expect(quiesce).toBeLessThan(stepAt('Compose the publication'))
    expect(quiesce).toBeLessThan(stepAt('Validate the composed content'))
    expect(quiesce).toBeLessThan(stepAt('Install dependencies'))
    expect(stepBlock('Disarm the publication already in flight')).toContain(
      'publication-github.mjs quiesce',
    )
  })

  it('disarms it whatever this run turns out to be', () => {
    // Gated on nothing at all. A run that fails, or finds nothing to publish, must
    // still have taken auto-merge off the publication it supersedes.
    expect(stepBlock('Disarm the publication already in flight')).not.toMatch(/^\s+if:/m)
  })

  it('closes the publication a no-change save supersedes', () => {
    const supersede = stepBlock('Close the publication this save supersedes')

    expect(supersede).toContain('publication-github.mjs supersede')
    expect(supersede).toMatch(/if:\s*steps\.stage\.outputs\.changed\s*!=\s*'true'/)
    // And it is the only thing that happens on that path: no commit, no push, no PR.
    for (const step of ['Commit the publication', 'Push the publication branch']) {
      expect(stepBlock(step), step).toMatch(/if:\s*steps\.stage\.outputs\.changed\s*==\s*'true'/)
    }
  })

  it('re-arms auto-merge only after the newer snapshot is pushed', () => {
    const pr = stepBlock('Open or reuse the publication pull request')

    expect(pr).toContain('publication-github.mjs pr')
    expect(pr).toMatch(/if:\s*steps\.stage\.outputs\.changed\s*==\s*'true'/)
    expect(stepAt('Open or reuse the publication pull request')).toBeGreaterThan(
      stepAt('Push the publication branch'),
    )
    expect(stepAt('Open or reuse the publication pull request')).toBeGreaterThan(
      stepAt('Refuse to publish a stale snapshot'),
    )

    // And `pr` is the only command that can enable auto-merge, so this is the only
    // step that can.
    const enabling = shellLines().filter((line) => line.includes('publication-github.mjs pr'))
    expect(enabling).toHaveLength(1)
  })

  it('lets a failure stop the run rather than carry on to re-arm anything', () => {
    // The steps between the disarming and the re-arming are the ones that can fail:
    // invalid content, a path outside the roots, a stale snapshot. If any of them could
    // be stepped over, a failed run would end by arming a publication it had just
    // refused to replace. Nothing here is allowed to fail softly.
    expect(workflow).not.toContain('continue-on-error')
    expect(workflow).not.toMatch(/if:\s*(always|failure|cancelled)\(\)/)
  })
})

/**
 * The source a publication is read from — the security migration's Phase S2.
 *
 * Pages CMS is moving out of this repository into `myimaginarii/klingenberg-content`,
 * and during the move the publisher can read from either place. Everything asserted
 * here is a property that would be silently gone after a plausible edit: that the
 * selector is a word and not a repository name, that the external repository's objects
 * are fetched and never executed, that the SHA everything downstream uses is the one
 * resolved once, that the stale guard covers both sources, and — the one that matters
 * most while the migration is in flight — that the live automatic path is still the
 * internal branch, byte for byte.
 */
describe('the source a publication reads', () => {
  const RESOLVE = "Resolve the publication's two immutable commits"

  it('offers two fixed words, and defaults to the internal branch', () => {
    const on = topLevelBlock('on')

    expect(on).toMatch(/^\s+source:/m)
    expect(on).toMatch(/^\s+type:\s*choice\s*$/m)
    expect(on).toMatch(/^\s+default:\s*internal\s*$/m)
    expect(on.match(/^\s+- (internal|external)\s*$/gm)).toHaveLength(2)

    // No input carries a repository, an owner, a ref or a SHA. That is the whole
    // safety property of a word-shaped selector: there is nothing here for an
    // arbitrary name to arrive in.
    for (const forbidden of [/repository:/, /owner:/, /\bref:/, /\bsha:/i, /branch:/]) {
      expect(on, String(forbidden)).not.toMatch(forbidden)
    }
  })

  it('turns the word into a source before it resolves anything', () => {
    expect(stepBlock('Name the source this publication reads')).toContain(
      'scripts/cms/publication-source.mjs',
    )
    expect(stepAt('Name the source this publication reads')).toBeLessThan(stepAt(RESOLVE))
    expect(stepAt('Name the source this publication reads')).toBeLessThan(
      stepAt('Compose the publication'),
    )
  })

  it('keeps the external identity in the script, not in the workflow', () => {
    // The external owner, repository and branch are constants in
    // `publication-source.mjs`. If they were written here too there would be two
    // places to change and one of them would be missed.
    expect(stepBlock(RESOLVE)).not.toMatch(/klingenberg-content/)
    expect(stepBlock('Refuse to publish a stale snapshot')).not.toMatch(/klingenberg-content/)
  })

  it('fetches the external repository as objects, and never as a checkout', () => {
    const resolve = stepBlock(RESOLVE)

    // One branch, no tags, no submodule recursion, into a ref outside `refs/heads/`
    // that no push can carry and no branch checkout can land on.
    expect(resolve).toContain('fetch --no-tags --no-recurse-submodules')
    expect(resolve).toContain('"+refs/heads/${SOURCE_BRANCH}:${SOURCE_REF}"')
    expect(stepBlock('Name the source this publication reads')).not.toContain('refs/heads')

    // And the credential the publisher pushes with is not presented to it.
    expect(resolve).toContain('git -c "$SOURCE_HEADER_RESET" fetch')
  })

  it('never executes anything the external repository carries', () => {
    // One checkout in the file, and it is main's.
    expect(workflow.match(/uses:\s*actions\/checkout@/g)).toHaveLength(1)
    expect(stepBlock('Check out main')).toContain('ref: ${{ env.BASE_BRANCH }}')
    expect(workflow).not.toMatch(/working-directory:/)

    // The fetched objects are read. They are never made into a tree, and never
    // merged into one.
    const touching = shellLines().filter((line) => line.includes('SOURCE_REF'))
    expect(touching.length).toBeGreaterThan(0)
    for (const line of touching) {
      expect(line, line).not.toMatch(/git (checkout|switch|merge|rebase|cherry-pick|worktree|apply)/)
    }

    // Every program this workflow starts is one `main`'s checkout supplies.
    const programs = shellLines().filter((line) => /^(node|npm|npx) /.test(line))
    expect(programs.length).toBeGreaterThan(0)
    for (const line of programs) {
      expect(line, line).toMatch(/^(npm ci|npm run [\w:-]+|node scripts\/cms\/[\w-]+\.mjs\b)/)
    }
  })

  it('composes from the SHA it resolved once, not from a branch that can move', () => {
    const compose = stepBlock('Compose the publication')

    expect(stepBlock(RESOLVE)).toContain('content_sha="$(git rev-parse "${SOURCE_REF}")"')
    expect(compose).toContain('CONTENT_SHA: ${{ steps.refs.outputs.content }}')
    expect(compose).toContain('--content "$CONTENT_SHA"')
    // Not the ref, not the branch: the composer is given a commit and nothing that
    // could resolve to a different one a moment later.
    expect(compose).not.toContain('SOURCE_REF')
    expect(compose).not.toContain('SOURCE_BRANCH')
  })

  it('re-reads whichever source it composed from, before it pushes anything', () => {
    const stale = stepBlock('Refuse to publish a stale snapshot')

    // The external tip over the wire, the internal branch by fetch — and either way
    // compared against the SHA this run composed.
    expect(stale).toContain('ls-remote "$SOURCE_REMOTE" "refs/heads/${SOURCE_BRANCH}"')
    expect(stale).toContain(
      'git fetch --no-tags origin "+refs/heads/${CONTENT_BRANCH}:refs/remotes/origin/${CONTENT_BRANCH}"',
    )
    expect(stale).toContain('[ "$now" != "$CONTENT_SHA" ]')
    expect(stale.match(/exit 1/g)).toHaveLength(2)
    // An unreadable remote is not a pass: an empty answer stops the run.
    expect(stale).toContain('[ -z "$now" ]')

    expect(stepAt('Refuse to publish a stale snapshot')).toBeLessThan(
      stepAt('Push the publication branch'),
    )
  })

  it('carries the source into everything a person later reads', () => {
    // The commit, the pull request, and the pull request a superseded save closes.
    expect(stepBlock('Commit the publication')).toContain('Source repository: ${SOURCE_LABEL}')
    expect(stepBlock('Open or reuse the publication pull request')).toContain(
      '--source "$SOURCE_LABEL"',
    )
    expect(stepBlock('Close the publication this save supersedes')).toContain(
      '--source "$SOURCE_LABEL"',
    )
    // And the trailer `cms-publication-status.yml` recognises a publication by is
    // still there, unchanged.
    expect(stepBlock('Commit the publication')).toContain('Source content: ${short}')
    expect(stepBlock('Commit the publication')).toContain('"cms: publish content"')
  })

  it('leaves the internal path exactly as it was', () => {
    // The live source during S2. Both places the internal branch is read are the
    // lines they have always been, so nothing about the migration can change what a
    // save on `content` publishes.
    const internal = shellLines().filter((line) =>
      line.includes('git fetch --no-tags origin "+refs/heads/${CONTENT_BRANCH}'),
    )
    expect(internal).toHaveLength(2)
    for (const line of internal) {
      expect(line).toBe(
        'git fetch --no-tags origin "+refs/heads/${CONTENT_BRANCH}:refs/remotes/origin/${CONTENT_BRANCH}"',
      )
    }
    expect(workflow).toMatch(/^\s*CONTENT_BRANCH:\s*content\s*$/m)
  })

  it('is rung by a doorbell that asks for no source at all', () => {
    // The automatic path: `cms-content-trigger.yml` dispatches with no inputs, so the
    // publisher's declared default decides — and that default is `internal`. Cutting
    // over is therefore a deliberate change to one of these two files, never a
    // side effect of a save.
    const trigger = readFileSync(
      join(process.cwd(), '.github', 'workflows', 'cms-content-trigger.yml'),
      'utf8',
    ).replace(/\r\n/g, '\n')

    const dispatch = trigger
      .split('\n')
      .filter((line) => line.includes('gh workflow run'))
      .map((line) => line.trim())

    expect(dispatch).toHaveLength(1)
    expect(dispatch[0]).toBe('run: gh workflow run cms-publish.yml --ref main')
    expect(dispatch[0]).not.toMatch(/(^| )-(f|F|-field|-raw-field)\b/)
    expect(trigger).not.toMatch(/external/)
  })
})

describe('the publishing bot identity', () => {
  it('builds the noreply address GitHub attributes a commit by', () => {
    // The value Phase 5A observed, reproduced from the two fields the API returns.
    expect(botNoreplyEmail({ id: 327736984, login: 'klingenberg-food-publisher[bot]' })).toBe(
      '327736984+klingenberg-food-publisher[bot]@users.noreply.github.com',
    )
  })

  it('refuses an id that is not one', () => {
    for (const id of [undefined, null, '327736984', 0, -1, 1.5]) {
      expect(() => botNoreplyEmail({ id, login: 'x[bot]' }), String(id)).toThrow()
    }
  })

  it('derives the bot login from the App slug the token step reports', () => {
    expect(botLoginFor('klingenberg-food-publisher')).toBe('klingenberg-food-publisher[bot]')
    for (const slug of ['', undefined, null, 7]) {
      expect(() => botLoginFor(slug), String(slug)).toThrow(/App slug/)
    }
  })

  it('reads the owner and repository from the one variable the runner sets', () => {
    expect(repositorySlug('myimaginarii/klingenberg-food')).toEqual({
      owner: 'myimaginarii',
      repo: 'klingenberg-food',
    })
    for (const value of ['klingenberg-food', 'a/b/c', '']) {
      expect(() => repositorySlug(value), value).toThrow(/GITHUB_REPOSITORY/)
    }
  })
})

describe('the pull request body', () => {
  const INTERNAL = 'myimaginarii/klingenberg-food:content'
  const EXTERNAL = 'myimaginarii/klingenberg-content:main'
  const body = publicationBody({
    contentSha: 'c'.repeat(40),
    mainSha: 'm'.repeat(40),
    source: INTERNAL,
  })

  it('states where the publication came from and what it may contain', () => {
    expect(body).toContain('Pages CMS')
    expect(body).toContain('c'.repeat(40))
    expect(body).toContain('m'.repeat(40))
    expect(body).toContain('content/site/**')
    expect(body).toContain('public/photos/**')
    expect(body).toContain('check:content')
  })

  it('names the repository and branch the SHA belongs to, not just the SHA', () => {
    // The migration's one ambiguity, closed. Two repositories can now supply a
    // publication, so a body stating `c…c` alone would leave a reader unable to check
    // it against anything.
    expect(body).toContain(`${INTERNAL}@${'c'.repeat(40)}`)

    const external = publicationBody({
      contentSha: 'e'.repeat(40),
      mainSha: 'm'.repeat(40),
      source: EXTERNAL,
    })
    expect(external).toContain(`${EXTERNAL}@${'e'.repeat(40)}`)
    expect(external).not.toContain(INTERNAL)
  })

  it('refuses to state a snapshot it cannot attribute', () => {
    // Not defaulted to the internal branch: a caller that forgot the source would then
    // publish external content under a body claiming it came from `content`.
    for (const source of [undefined, '', null]) {
      expect(
        () => publicationBody({ contentSha: 'c'.repeat(40), mainSha: 'm'.repeat(40), source }),
        String(source),
      ).toThrow()
    }
  })

  it('is the same body for the same two commits', () => {
    // No timestamp, no run number: two publications of one snapshot read identically.
    expect(
      publicationBody({ contentSha: 'c'.repeat(40), mainSha: 'm'.repeat(40), source: INTERNAL }),
    ).toBe(body)
  })

  it('says which source a superseded publication was replaced from', () => {
    const closed = supersededBody({ contentSha: 'e'.repeat(40), source: EXTERNAL })
    expect(closed).toContain(`${EXTERNAL}@${'e'.repeat(40)}`)
    expect(() => supersededBody({ contentSha: 'e'.repeat(40) })).toThrow()
  })
})

/**
 * Supersession: how a newer CMS save beats an older publication.
 *
 * The bug these exist for. There is one publication branch and one publication pull
 * request, and it waits on auto-merge — armed, in the sense that GitHub lands it the
 * instant its checks go green, with nobody watching. The owner saves B; B's publication
 * opens and starts waiting. The owner then saves A again, which is what `main` already
 * has. The newer run finds nothing to publish and stops — and B, composed from content
 * the owner has since replaced, merges anyway. The older save wins.
 *
 * So a run disarms whatever is open before it does anything, and either re-arms it on
 * the newer snapshot or closes it. The three operations are exercised against a pair of
 * fake GitHub callers, which is the only way to state the thing that actually matters:
 * not what each call looks like, but which calls happen and in what order.
 */
describe('superseding an older publication', () => {
  const HEAD = 'cms-publish'
  const BASE = 'main'

  let repository

  beforeAll(() => {
    repository = process.env.GITHUB_REPOSITORY
    process.env.GITHUB_REPOSITORY = 'myimaginarii/klingenberg-food'
  })

  afterAll(() => {
    if (repository === undefined) delete process.env.GITHUB_REPOSITORY
    else process.env.GITHUB_REPOSITORY = repository
  })

  /** An open publication pull request as the list endpoint returns one. */
  function openPullRequest(number, { autoMerge = true } = {}) {
    return {
      number,
      node_id: `PR_kw${number}`,
      // Whatever GitHub would return; nothing here asserts on it, and writing the real
      // host would put an absolute URL somewhere §10d says one may not be.
      html_url: `[the pull request URL for #${number}]`,
      auto_merge: autoMerge ? { merge_method: 'SQUASH' } : null,
    }
  }

  /**
   * A stand-in for the two ways the helper talks to GitHub, recording every call.
   *
   * `graphqlErrors` names a mutation — `enable` or `disable` — and the messages GitHub
   * should answer it with, which is how the two tolerated replies and the intolerable
   * ones are told apart.
   */
  function fakeGitHub({ pulls = [], graphqlErrors = {} } = {}) {
    const calls = []

    const api = {
      async rest(path, { method = 'GET', body } = {}) {
        calls.push({ method, path, body })

        if (method === 'GET' && path.includes('/pulls?')) return pulls
        if (method === 'POST' && path.endsWith('/pulls')) {
          return { ...openPullRequest(101), ...body }
        }
        if (method === 'PATCH') {
          const number = Number(path.slice(path.lastIndexOf('/') + 1))
          return { ...openPullRequest(number), ...body }
        }
        throw new Error(`the fake was asked for ${method} ${path}`)
      },

      async graphql(query, variables) {
        const mutation = query.includes('disablePullRequestAutoMerge') ? 'disable' : 'enable'
        calls.push({ mutation, variables })

        const messages = graphqlErrors[mutation]
        if (messages === undefined) return { data: {} }
        return { errors: messages.map((message) => ({ message })) }
      },
    }

    return { api, calls }
  }

  /** The calls that changed something: the lookup is a GET and says nothing about intent. */
  const mutations = (calls) => calls.filter((call) => call.method !== 'GET')

  describe('disarming what is already in flight', () => {
    it('takes auto-merge off the one open publication', async () => {
      const { api, calls } = fakeGitHub({ pulls: [openPullRequest(7)] })

      expect(await quiescePublication({ head: HEAD, base: BASE }, api)).toEqual({
        found: true,
        number: 7,
        disabled: true,
      })

      // Looked up by exactly the pair that defines a publication, then disarmed —
      // and nothing else touched.
      expect(calls[0].path).toContain(`head=${encodeURIComponent(`myimaginarii:${HEAD}`)}`)
      expect(calls[0].path).toContain(`base=${BASE}`)
      expect(calls[0].path).toContain('state=open')
      expect(mutations(calls)).toEqual([
        { mutation: 'disable', variables: { pullRequestId: 'PR_kw7' } },
      ])
    })

    it('has nothing to do when no publication is open', async () => {
      const { api, calls } = fakeGitHub({ pulls: [] })

      expect(await quiescePublication({ head: HEAD, base: BASE }, api)).toEqual({
        found: false,
        number: '',
        disabled: false,
      })
      expect(mutations(calls)).toEqual([])
    })

    it('refuses to guess when more than one publication is open', async () => {
      const { api, calls } = fakeGitHub({ pulls: [openPullRequest(7), openPullRequest(8)] })

      await expect(quiescePublication({ head: HEAD, base: BASE }, api)).rejects.toThrow(
        /at most one/,
      )
      // Refusing means touching neither of them.
      expect(mutations(calls)).toEqual([])
    })

    it('accepts a publication that was already disarmed', async () => {
      const { api } = fakeGitHub({
        pulls: [openPullRequest(7, { autoMerge: false })],
        graphqlErrors: {
          disable: ['Pull request Auto merge is not enabled for this pull request'],
        },
      })

      expect(await quiescePublication({ head: HEAD, base: BASE }, api)).toEqual({
        found: true,
        number: 7,
        disabled: false,
      })
    })

    it('fails on any other answer from GitHub', async () => {
      const { api } = fakeGitHub({
        pulls: [openPullRequest(7)],
        graphqlErrors: { disable: ['Resource not accessible by integration'] },
      })

      // Fail closed: not knowing whether the older publication is still armed is not
      // a reason to go on composing a newer one.
      await expect(quiescePublication({ head: HEAD, base: BASE }, api)).rejects.toThrow(
        /Resource not accessible/,
      )
    })
  })

  describe('a save with nothing left to publish', () => {
    const contentSha = 'a'.repeat(40)
    const source = 'myimaginarii/klingenberg-food:content'

    it('closes the publication it supersedes', async () => {
      const { api, calls } = fakeGitHub({ pulls: [openPullRequest(7, { autoMerge: false })] })

      expect(await supersedePublication({ head: HEAD, base: BASE, contentSha, source }, api)).toEqual({
        found: true,
        number: 7,
        closed: true,
      })

      const [close, ...rest] = mutations(calls)
      expect(close.method).toBe('PATCH')
      expect(close.path).toMatch(/\/pulls\/7$/)
      expect(close.body.state).toBe('closed')
      expect(close.body.body).toContain(contentSha)
      // Closing it, and only closing it: nothing is merged, nothing is opened, and
      // auto-merge is certainly not turned back on.
      expect(rest).toEqual([])
    })

    it('touches nothing when no publication is open', async () => {
      const { api, calls } = fakeGitHub({ pulls: [] })

      expect(await supersedePublication({ head: HEAD, base: BASE, contentSha, source }, api)).toEqual({
        found: false,
        number: '',
        closed: false,
      })
      expect(mutations(calls)).toEqual([])
    })
  })

  describe('a save that does have something to publish', () => {
    const shas = {
      contentSha: 'c'.repeat(40),
      mainSha: 'm'.repeat(40),
      source: 'myimaginarii/klingenberg-food:content',
    }

    it('reuses the disarmed publication and re-arms it on the new snapshot', async () => {
      const { api, calls } = fakeGitHub({ pulls: [openPullRequest(7, { autoMerge: false })] })

      const result = await openPublication({ head: HEAD, base: BASE, ...shas }, api)

      expect(result).toMatchObject({ number: 7, created: false })

      const [update, enable, ...rest] = mutations(calls)
      // The body is updated to the new immutable SHAs *before* auto-merge goes back on,
      // and auto-merge goes back on the pull request that was just updated.
      expect(update.method).toBe('PATCH')
      expect(update.path).toMatch(/\/pulls\/7$/)
      expect(update.body.body).toContain(shas.contentSha)
      expect(enable).toEqual({
        mutation: 'enable',
        variables: { pullRequestId: 'PR_kw7', mergeMethod: 'SQUASH' },
      })
      expect(rest).toEqual([])
    })

    it('opens one when the last run closed the previous publication', async () => {
      const { api, calls } = fakeGitHub({ pulls: [] })

      expect(await openPublication({ head: HEAD, base: BASE, ...shas }, api)).toMatchObject({
        number: 101,
        created: true,
      })

      const [open, enable] = mutations(calls)
      expect(open.method).toBe('POST')
      expect(open.body).toMatchObject({ head: HEAD, base: BASE })
      expect(enable.mutation).toBe('enable')
    })
  })
})

describe('staging a publication', () => {
  const temporary = []

  const BASE = {
    '.gitignore': '/node_modules\n/public/media\n/generated\n',
    'content/site/menu.json': '{ "sections": [] }\n',
    'content/site/news/nyt-koekken.json': '{ "title": "Nyt køkken" }\n',
    'public/photos/home-hero.png': 'png-bytes-home-hero',
    'app/page.tsx': 'export default function Page() {\n  return null\n}\n',
    '.github/workflows/ci.yml': 'name: CI\n',
  }

  function git(repo, args) {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  }

  function write(root, path, contents) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }

  /** A repository at one commit holding {@link BASE}, then `edits` applied to the working tree. */
  function fixture(edits = {}) {
    const root = mkdtempSync(join(tmpdir(), 'staging-'))
    temporary.push(root)

    git(root, ['init', '-q', '-b', 'main'])
    git(root, ['config', 'user.email', 'fixture@example.test'])
    git(root, ['config', 'user.name', 'Fixture'])
    git(root, ['config', 'commit.gpgsign', 'false'])
    git(root, ['config', 'core.autocrlf', 'false'])

    for (const [path, contents] of Object.entries(BASE)) write(root, path, contents)
    git(root, ['add', '-A'])
    git(root, ['commit', '-qm', 'base'])

    const base = git(root, ['rev-parse', 'HEAD']).trim()

    for (const [path, contents] of Object.entries(edits)) {
      if (contents === null) rmSync(join(root, path))
      else write(root, path, contents)
    }
    return { repo: root, base }
  }

  afterAll(() => {
    for (const directory of temporary) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
    }
  })

  it('stages an edit inside the publication roots', () => {
    const { repo, base } = fixture({ 'content/site/menu.json': '{ "sections": ["frokost"] }\n' })

    expect(stagePublication({ repo, base })).toMatchObject({
      changed: true,
      staged: ['content/site/menu.json'],
    })
  })

  it('stages a new photograph and a deleted article', () => {
    const { repo, base } = fixture({
      'public/photos/dish-odin.png': 'png-bytes-dish-odin',
      'content/site/news/nyt-koekken.json': null,
    })

    const { changed, staged } = stagePublication({ repo, base })

    expect(changed).toBe(true)
    expect([...staged].sort()).toEqual([
      'content/site/news/nyt-koekken.json',
      'public/photos/dish-odin.png',
    ])
  })

  it('refuses to let anything outside the roots be committed', () => {
    const { repo, base } = fixture({
      'app/page.tsx': 'export const hostile = 1\n',
      'content/site/menu.json': '{ "sections": ["aften"] }\n',
    })

    expect(() => stagePublication({ repo, base })).toThrow(/app\/page\.tsx/)
    expect(() => stagePublication({ repo, base })).toThrow(/Refusing to commit/)
  })

  it('refuses a new workflow file, which is the whole point of the check', () => {
    const { repo, base } = fixture({ '.github/workflows/exfiltrate.yml': 'name: new\n' })

    expect(() => stagePublication({ repo, base })).toThrow(/\.github\/workflows\/exfiltrate\.yml/)
  })

  it('reports nothing to publish when the tree matches the base commit', () => {
    const { repo, base } = fixture()

    expect(stagePublication({ repo, base })).toMatchObject({ changed: false, staged: [] })
  })

  it('is not disturbed by the build products .gitignore excludes', () => {
    // `npm run check:content` writes both of these before this ever runs. Staging the
    // whole tree has to stay safe in their presence, or the assertion would have to be
    // narrowed to the roots — and a check that can only look at the roots can never
    // catch anything leaving them.
    const { repo, base } = fixture({
      'public/media/home-hero/640.webp': 'a derivative',
      'generated/images.json': '{}\n',
    })

    expect(stagePublication({ repo, base })).toMatchObject({ changed: false, staged: [] })
  })

  it('refuses a base commit the tree is not at', () => {
    const { repo } = fixture({ 'content/site/menu.json': '{ "sections": ["nat"] }\n' })

    expect(() => stagePublication({ repo, base: '0'.repeat(40) })).toThrow(/not at the base commit/)
  })

  it('picks out exactly the paths that left the roots', () => {
    expect(
      escapedPaths([
        'content/site/menu.json',
        'app/page.tsx',
        'public/photos/home-hero.png',
        '.pages.yml',
        'content/launch/copy.md',
      ]),
    ).toEqual(['app/page.tsx', '.pages.yml', 'content/launch/copy.md'])
  })
})
