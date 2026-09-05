import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { PUBLIC_REVALIDATE_SECONDS } from '@/lib/cache/tags'
import { contentSecurityPolicy, HSTS_MAX_AGE_SECONDS, permissionsPolicy } from '@/lib/security/headers'

import { DRAFT_COOKIE, OWNER, signIn, STAFF } from './support/admin'
import { openDish } from './support/menu-admin'
import { openNewEditor } from './support/news-admin'

/**
 * The security headers, on the built site — phase 13B (brief §24, §37–§40).
 *
 * Read-only, so the `desktop` and `mobile` projects both run it. Two halves:
 *
 *   1. **Every representative response carries the policy**, and carries it
 *      *beside* the cache header the route already decided: the public pages keep
 *      `s-maxage=300`, the administration keeps its private no-store, a redirect and
 *      a 404 are covered too. The exact CSP is the builder's own output, so the
 *      unit-pinned policy and the served policy cannot drift.
 *   2. **The enforced CSP breaks nothing.** A guest walks the public site and a
 *      staff member walks the administration — the dashboard, the menu editor and
 *      its picker, the news editor, the image library, a Draft Mode preview — with
 *      the console and the network watched. A CSP violation is a console error in
 *      Chromium ("Refused to …"); a blocked resource is a failed request. Both lists
 *      must be empty.
 */

const PUBLIC_ROUTES = ['/', '/menu', '/nyheder', '/mad-ud-af-huset', '/find-os', '/om-os'] as const

/** The Supabase origin the built site was configured with — from `.env.local`, as the app reads it. */
function supabaseOrigin(): string | null {
  const envFile = resolve(process.cwd(), '.env.local')
  const fromEnv = process.env.NEXT_PUBLIC_SUPABASE_URL
  let value = fromEnv
  if (!value && existsSync(envFile)) {
    const match = /^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.*?)\s*$/m.exec(readFileSync(envFile, 'utf8'))
    value = match?.[1]
  }
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

const EXPECTED_CSP = contentSecurityPolicy({ production: true, supabaseOrigin: supabaseOrigin() })

function expectSecurityHeaders(headers: Record<string, string>, label: string): void {
  expect(headers['content-security-policy'], `${label} CSP`).toBe(EXPECTED_CSP)
  expect(headers['x-content-type-options'], `${label} nosniff`).toBe('nosniff')
  expect(headers['referrer-policy'], `${label} referrer`).toBe('strict-origin-when-cross-origin')
  expect(headers['permissions-policy'], `${label} permissions`).toBe(permissionsPolicy())
  expect(headers['x-frame-options'], `${label} frame`).toBe('DENY')
  expect(headers['strict-transport-security'], `${label} HSTS`).toBe(`max-age=${HSTS_MAX_AGE_SECONDS}`)
  expect(headers['content-security-policy-report-only'], `${label} is enforced, not report-only`).toBeUndefined()
  expect(headers['x-powered-by'], `${label} advertises no framework`).toBeUndefined()
}

async function get(request: APIRequestContext, path: string) {
  return request.get(path, { maxRedirects: 0 })
}

// ---------------------------------------------------------------------------
// 1. The policy on every representative response, beside the cache header
// ---------------------------------------------------------------------------

test('the production policy carries no eval, no wildcard and no report-only mode', () => {
  expect(EXPECTED_CSP).not.toContain('unsafe-eval')
  expect(EXPECTED_CSP).not.toMatch(/\*|https?:(?=[\s;]|$)/)
  expect(EXPECTED_CSP).toContain("frame-ancestors 'none'")
})

test('every public page carries the policy and keeps its five-minute cache header', async ({ request }) => {
  for (const path of PUBLIC_ROUTES) {
    const response = await get(request, path)
    expect(response.status(), `${path} is served`).toBe(200)
    expectSecurityHeaders(response.headers(), path)
    expect(response.headers()['cache-control'], `${path} Cache-Control survives`).toBe(
      `s-maxage=${PUBLIC_REVALIDATE_SECONDS}`,
    )
  }
})

test('a news article, the sitemap and a 404 carry the policy', async ({ request }) => {
  const list = await (await request.get('/nyheder')).text()
  const slug = /href="\/nyheder\/([^"/?#]+)"/.exec(list)?.[1]
  expect(slug, 'the news list links at least one article').toBeTruthy()

  const article = await get(request, `/nyheder/${slug}`)
  expect(article.status()).toBe(200)
  expectSecurityHeaders(article.headers(), `/nyheder/${slug}`)

  const sitemap = await get(request, '/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  expectSecurityHeaders(sitemap.headers(), '/sitemap.xml')

  const missing = await get(request, '/denne-side-findes-ikke')
  expect(missing.status()).toBe(404)
  expectSecurityHeaders(missing.headers(), '404')
})

test('the login page, the redirect away from /admin and the preview refusal carry the policy', async ({
  request,
}) => {
  const login = await get(request, '/admin/login')
  expect(login.status()).toBe(200)
  expectSecurityHeaders(login.headers(), '/admin/login')
  expect(login.headers()['x-robots-tag'], 'the admin stays unindexed').toBe('noindex, nofollow')
  expect(login.headers()['cache-control'], 'the admin stays uncached').toContain('no-store')

  const redirect = await get(request, '/admin')
  expect(redirect.status()).toBe(307)
  expectSecurityHeaders(redirect.headers(), '/admin (redirect)')
  expect(redirect.headers()['x-robots-tag']).toBe('noindex, nofollow')

  const preview = await get(request, '/api/preview/start?maal=forside')
  expect(preview.status()).toBe(303)
  expectSecurityHeaders(preview.headers(), '/api/preview/start (guest)')
})

test('the framework assets are served nosniff with their long-lived cache header intact', async ({
  request,
}) => {
  const html = await (await request.get('/menu')).text()
  const script = /src="(\/_next\/static\/[^"]+\.js)"/.exec(html)?.[1]
  const stylesheet = /href="(\/_next\/static\/[^"]+\.css)"/.exec(html)?.[1]
  expect(script, 'a framework script is referenced').toBeTruthy()
  expect(stylesheet, 'the stylesheet is referenced').toBeTruthy()

  for (const asset of [script!, stylesheet!]) {
    const response = await get(request, asset)
    expect(response.status(), asset).toBe(200)
    expect(response.headers()['x-content-type-options'], `${asset} nosniff`).toBe('nosniff')
    expect(response.headers()['cache-control'], `${asset} stays immutable`).toBe(
      'public, max-age=31536000, immutable',
    )
  }
})

// ---------------------------------------------------------------------------
// 2. The enforced CSP in a real browser
// ---------------------------------------------------------------------------

type Violation = { readonly where: string; readonly what: string }

/**
 * Everything the policy could break, as it happens: a CSP refusal is a console
 * error in Chromium, an uncaught exception is a page error, and a blocked resource
 * is a failed request. Navigations the walk itself abandons (`ERR_ABORTED`) are not
 * failures and are ignored.
 */
function watch(page: Page): Violation[] {
  const seen: Violation[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') seen.push({ where: page.url(), what: message.text() })
  })
  page.on('pageerror', (error) => seen.push({ where: page.url(), what: `pageerror: ${error.message}` }))
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    if (reason.includes('ERR_ABORTED')) return
    seen.push({ where: page.url(), what: `requestfailed ${request.url()}: ${reason}` })
  })
  return seen
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
}

test('a guest walks the public site under the enforced policy without a single violation', async ({ page }) => {
  const violations = watch(page)

  for (const path of PUBLIC_ROUTES) {
    await page.goto(path)
    await settle(page)
    // The page hydrated and rendered: the menu's images, the map, the footer.
    await expect(page.getByRole('contentinfo')).toBeVisible()
  }

  const firstArticle = page.getByRole('main').getByRole('link', { name: /Læs/ }).first()
  await page.goto('/nyheder')
  await settle(page)
  if ((await firstArticle.count()) > 0) {
    await firstArticle.click()
    await settle(page)
  }

  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
})

test('a staff member walks the administration — dashboard, editors, picker, library, preview — without a violation', async ({
  page,
}) => {
  const violations = watch(page)

  await signIn(page, STAFF)
  await settle(page)

  // The menu editor and its picker.
  await openDish(page, 'Burgere', 'Thor')
  await page.waitForURL(/ret=/)
  await settle(page)
  const picker = new URL(page.url())
  picker.searchParams.set('vaelg_billede', '1')
  await page.goto(picker.pathname + picker.search)
  await settle(page)
  await expect(page.locator('dialog[open]')).toBeVisible()

  // The news editor, with the structured body and the autosave controller mounted.
  await openNewEditor(page)
  await settle(page)

  // The image library (the uploader is a client component).
  await page.goto('/admin/billeder')
  await settle(page)

  // A Draft Mode preview of the Forside, and back out of it.
  await page.goto('/api/preview/start?maal=forside')
  await settle(page)
  expect(page.url()).toMatch(/\/$/)
  expect((await page.context().cookies()).map((cookie) => cookie.name)).toContain(DRAFT_COOKIE)
  await page.goto('/api/preview/stop?maal=forside')
  await settle(page)

  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
})

test('the owner-only screens render under the same policy', async ({ page }) => {
  const violations = watch(page)

  await signIn(page, OWNER)
  for (const path of ['/admin/forsiden', '/admin/aabningstider', '/admin/kontakt', '/admin/brugere', '/admin/mad-ud-af-huset', '/admin/besked']) {
    await page.goto(path)
    await settle(page)
    await expect(page.getByRole('main')).toBeVisible()
  }

  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
})
