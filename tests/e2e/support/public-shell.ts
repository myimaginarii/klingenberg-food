import { expect, type Page } from '@playwright/test'

/**
 * Wait until the public shell is actually **in the document**.
 *
 * `page.goto()` resolves on `load`, and on a streamed React 19 document that is too
 * early: the whole non-suspended shell — the announcement region, the header, `main`
 * and the footer — arrives inside `<body><div hidden>` and is moved into place by the
 * framework's own inline scripts a few milliseconds later. `document.readyState` is
 * already `"complete"` while that is still pending, so nothing about the navigation
 * says the body is populated.
 *
 * Playwright's locators auto-wait for their element and are therefore safe — **except
 * `count()`, which answers immediately**. Asked one tick too early it answers `0`, and
 * the error is one-sided: it reports "this is not on the page" about a page that
 * carries it. A guest reader whose *first* action after a navigation is `count()` is
 * therefore reading a body that may not have been filled in yet, and it fails in the
 * direction that looks like a missing feature rather than like a timing problem.
 *
 * The footer is the anchor because it is the **last** element the public layout renders
 * (`app/(site)/layout.tsx`: announcement, header, main, footer): it is on every public
 * page whatever that page contains, so waiting for it is never waiting for the thing
 * under test, and once it is in the document every slot above it has been filled in —
 * with content, or with nothing.
 *
 * This is a *navigation* barrier, not a retry: it waits once for the document to be
 * populated and then every assertion after it stays strict and single-shot. It is
 * deliberately not a general "retry until the page agrees" utility, and must not become
 * one — a poll there would hide the defects these suites exist to catch.
 */
export async function waitForPublicShell(page: Page): Promise<void> {
  await expect(page.getByRole('contentinfo')).toBeAttached()
}
