import type { Metadata } from 'next'

/**
 * Admin route-group layout — technical plan §3, §8.
 *
 * PHASE 1 SCOPE. This is a foundation, not the approved admin design. It exists so
 * that authentication and authorization can be exercised end to end. The real admin —
 * screens 1q–1ab, the dashboard, the editors, the mobile layouts — arrives from phase
 * 4 onward and replaces everything visual here. Nothing in this route group should be
 * read as a design decision.
 *
 * The layout deliberately performs **no** authorization. A layout is the wrong place
 * for it: it does not re-run on every navigation within the group, and it does not
 * cover Server Actions at all. Each page calls `requireStaff()` or `requireOwner()`
 * itself. What the layout does own is the noindex metadata, which every page in the
 * group needs and none should have to remember (§8); `proxy.ts` sets the matching
 * `X-Robots-Tag` header on the response.
 */
export const metadata: Metadata = {
  title: 'Administration — Klingenberg Food',
  robots: { index: false, follow: false, nocache: true },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-bg text-ink min-h-screen">
      <div className="mx-auto max-w-content px-gutter py-section md:px-8">{children}</div>
    </div>
  )
}
