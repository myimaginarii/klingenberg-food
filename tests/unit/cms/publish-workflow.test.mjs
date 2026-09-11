import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  botLoginFor,
  botNoreplyEmail,
  publicationBody,
  repositorySlug,
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
const workflow = readFileSync(WORKFLOW_PATH, 'utf8')

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

/** The workflow's `run:` script lines, with backslash continuations joined into one line each. */
function shellLines() {
  return workflow
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .map((line) => line.trim())
}

describe('the publication workflow file', () => {
  it('is dispatched by hand, and by nothing else', () => {
    const on = topLevelBlock('on')

    expect(on).toMatch(/^\s+workflow_dispatch:/m)
    // Phase 5D's change, and it is not here yet: a push to `content` must not be able
    // to publish until this workflow has been dispatched by hand and proved.
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
  const body = publicationBody({ contentSha: 'c'.repeat(40), mainSha: 'm'.repeat(40) })

  it('states where the publication came from and what it may contain', () => {
    expect(body).toContain('Pages CMS')
    expect(body).toContain('c'.repeat(40))
    expect(body).toContain('m'.repeat(40))
    expect(body).toContain('content/site/**')
    expect(body).toContain('public/photos/**')
    expect(body).toContain('check:content')
  })

  it('is the same body for the same two commits', () => {
    // No timestamp, no run number: two publications of one snapshot read identically.
    expect(publicationBody({ contentSha: 'c'.repeat(40), mainSha: 'm'.repeat(40) })).toBe(body)
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
