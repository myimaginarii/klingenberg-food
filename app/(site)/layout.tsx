import { SiteShell } from '@/components/site/layout/SiteShell'

/**
 * The public layout — the shell around the six pages (design 1g, 1l, 1n; technical
 * plan §3). The shell itself is `components/site/layout/SiteShell.tsx`, shared with the
 * root 404 so an unmatched address keeps the same header and footer.
 *
 * Every public page is prerendered at build time from the tracked content under
 * `content/site/`: no request-time read, no cache to expire and no revalidation.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>
}
