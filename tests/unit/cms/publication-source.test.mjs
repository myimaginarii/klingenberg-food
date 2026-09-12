import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  describeSource,
  EXTERNAL_CONTENT_BRANCH,
  EXTERNAL_CONTENT_REF,
  EXTERNAL_CONTENT_REPOSITORY,
  externalContentUrl,
  INTERNAL_CONTENT_BRANCH,
  PUBLICATION_SOURCES,
  publicationSource,
  unauthenticatedHeaderOption,
} from '../../../scripts/cms/publication-source.mjs'

/**
 * Which repository a publication reads from — `scripts/cms/publication-source.mjs`.
 *
 * The whole point of this module is that a dispatch chooses between two names and
 * cannot supply a third thing. So what is asserted here is mostly what the function
 * *refuses*: a repository name, a fork, a ref, a SHA, a word it does not know. The one
 * positive assertion that matters as much is the default — the doorbell dispatches
 * with no inputs, and an omitted source must be the internal branch and never the
 * external repository, or the migration would cut itself over.
 */

const REPOSITORY = 'myimaginarii/klingenberg-food'
// A reserved-TLD host (RFC 2606): a fixture server, and never a real address in source.
const SERVER = 'https://github.test'
const OPTIONS = { repository: REPOSITORY, serverUrl: SERVER }

describe('the two sources, and only two', () => {
  it('is a closed list of words', () => {
    expect([...PUBLICATION_SOURCES]).toEqual(['internal', 'external'])
    expect(Object.isFrozen(PUBLICATION_SOURCES)).toBe(true)
  })

  it('refuses any word it does not know', () => {
    for (const name of [
      'Internal',
      'EXTERNAL',
      'content',
      'main',
      'myimaginarii/klingenberg-content',
      'myimaginarii/klingenberg-content@main',
      'refs/heads/main',
      'a'.repeat(40),
      '../..',
      'internal external',
      0,
      true,
    ]) {
      expect(() => publicationSource(name, OPTIONS), String(name)).toThrow(
        /not a publication source/,
      )
    }
  })

  it('is the internal branch when a dispatch names nothing', () => {
    // The doorbell sends no inputs at all. An omitted source therefore decides what
    // every automatic publication reads, and it has to be the live one.
    for (const absent of [undefined, null, '']) {
      expect(publicationSource(absent, OPTIONS).kind, String(absent)).toBe('internal')
    }
  })
})

describe('the internal source', () => {
  const source = publicationSource('internal', OPTIONS)

  it('is this repository, on the branch Pages CMS writes to', () => {
    expect(source).toMatchObject({
      kind: 'internal',
      repository: REPOSITORY,
      branch: INTERNAL_CONTENT_BRANCH,
      remote: 'origin',
      ref: `refs/remotes/origin/${INTERNAL_CONTENT_BRANCH}`,
      label: `${REPOSITORY}:${INTERNAL_CONTENT_BRANCH}`,
    })
    expect(INTERNAL_CONTENT_BRANCH).toBe('content')
  })

  it('presents no credential decision, because it fetches from origin', () => {
    // `origin` is already the authenticated remote the checkout set up; there is no
    // header to reset and nothing anonymous to arrange.
    expect(source.headerReset).toBe('')
  })

  it('refuses a repository name that is not one', () => {
    for (const repository of ['klingenberg-food', 'a/b/c', '', 'a/b c']) {
      expect(
        () => publicationSource('internal', { ...OPTIONS, repository }),
        repository,
      ).toThrow(/GITHUB_REPOSITORY/)
    }
  })
})

describe('the external source', () => {
  const source = publicationSource('external', OPTIONS)

  it('is one repository and one branch, fixed in the module', () => {
    expect(EXTERNAL_CONTENT_REPOSITORY).toBe('myimaginarii/klingenberg-content')
    expect(EXTERNAL_CONTENT_BRANCH).toBe('main')
    expect(source).toMatchObject({
      kind: 'external',
      repository: 'myimaginarii/klingenberg-content',
      branch: 'main',
      label: 'myimaginarii/klingenberg-content:main',
    })
  })

  it('cannot be pointed at another repository by anything a caller passes', () => {
    // `repository` is the *trusted* repository's own name, used for the internal
    // label. It has no reach over the external identity at all.
    const spoofed = publicationSource('external', {
      ...OPTIONS,
      repository: 'attacker/klingenberg-content',
    })
    expect(spoofed.repository).toBe(EXTERNAL_CONTENT_REPOSITORY)
    expect(spoofed.label).toBe(`${EXTERNAL_CONTENT_REPOSITORY}:${EXTERNAL_CONTENT_BRANCH}`)
    expect(Object.isFrozen(source)).toBe(true)
  })

  it('parks the fetched objects outside refs/heads', () => {
    // Outside `refs/heads/` so that a `git push origin HEAD:refs/heads/…` cannot carry
    // untrusted history and no branch checkout can land on it.
    expect(source.ref).toBe(EXTERNAL_CONTENT_REF)
    expect(source.ref).toMatch(/^refs\/cms\//)
    expect(source.ref.startsWith('refs/heads/')).toBe(false)
    expect(source.ref.startsWith('refs/remotes/')).toBe(false)
  })
})

describe('reading the external repository without a credential', () => {
  it('builds the clone URL from the server the runner names', () => {
    // No host is written down, for the same reason `publication-github.mjs` takes its
    // API addresses from the environment.
    expect(externalContentUrl(SERVER)).toBe(`${SERVER}/${EXTERNAL_CONTENT_REPOSITORY}.git`)
    expect(externalContentUrl(`${SERVER}/`)).toBe(`${SERVER}/${EXTERNAL_CONTENT_REPOSITORY}.git`)
  })

  it('refuses a server address that is not an https origin', () => {
    for (const value of ['', 'github.test', 'http://github.test', `${SERVER}/a/path`, 'javascript:1']) {
      expect(() => externalContentUrl(value), value).toThrow(/GITHUB_SERVER_URL/)
    }
  })

  it('empties the header actions/checkout left behind, for that server', () => {
    // `actions/checkout` writes the App installation token into git config as
    // `http.<server>/.extraheader`. Git documents an empty value as resetting the
    // list, which is what makes the fetch genuinely anonymous.
    expect(unauthenticatedHeaderOption(SERVER)).toBe(`http.${SERVER}/.extraheader=`)
    expect(publicationSource('external', OPTIONS).headerReset).toBe(
      `http.${SERVER}/.extraheader=`,
    )
  })

  it('carries no token, anywhere, in what it hands the workflow', () => {
    const source = publicationSource('external', OPTIONS)
    for (const value of Object.values(source)) {
      expect(String(value)).not.toMatch(/ghs_|ghp_|github_pat_|:\/\/[^/]*@/)
    }
  })
})

describe('naming a published snapshot', () => {
  it('is the repository, the branch and the commit, in one spelling', () => {
    expect(describeSource({ label: 'myimaginarii/klingenberg-content:main', sha: 'a'.repeat(40) }))
      .toBe(`myimaginarii/klingenberg-content:main@${'a'.repeat(40)}`)
  })

  it('tells the two sources apart', () => {
    const sha = 'a'.repeat(40)
    const internal = describeSource({ label: publicationSource('internal', OPTIONS).label, sha })
    const external = describeSource({ label: publicationSource('external', OPTIONS).label, sha })

    expect(internal).toBe(`${REPOSITORY}:content@${sha}`)
    expect(external).toBe(`${EXTERNAL_CONTENT_REPOSITORY}:main@${sha}`)
    expect(internal).not.toBe(external)
  })

  it('refuses a snapshot it cannot name', () => {
    expect(() => describeSource({ label: '', sha: 'a'.repeat(40) })).toThrow()
    expect(() => describeSource({ sha: 'a'.repeat(40) })).toThrow()
    for (const sha of ['', 'main', 'abc', 'z'.repeat(40), undefined]) {
      expect(() => describeSource({ label: 'a/b:c', sha }), String(sha)).toThrow()
    }
  })
})

describe('the environment it reads when nothing is passed', () => {
  let saved

  beforeAll(() => {
    saved = { repo: process.env.GITHUB_REPOSITORY, server: process.env.GITHUB_SERVER_URL }
  })

  afterAll(() => {
    for (const [name, value] of [
      ['GITHUB_REPOSITORY', saved.repo],
      ['GITHUB_SERVER_URL', saved.server],
    ]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('says which variable is missing rather than inventing one', () => {
    delete process.env.GITHUB_REPOSITORY
    process.env.GITHUB_SERVER_URL = SERVER
    expect(() => publicationSource('internal')).toThrow(/GITHUB_REPOSITORY/)

    process.env.GITHUB_REPOSITORY = REPOSITORY
    delete process.env.GITHUB_SERVER_URL
    expect(() => publicationSource('external')).toThrow(/GITHUB_SERVER_URL/)
  })
})
