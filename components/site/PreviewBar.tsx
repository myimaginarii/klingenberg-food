import { readPreviewSession } from '@/lib/drafts/preview'

/**
 * "Forhåndsvisning — ikke live endnu" — technical plan §6.
 *
 * A Server Component that renders nothing at all unless the request is an authenticated
 * staff preview. On every visitor's request `readPreviewSession()` returns null, this
 * returns null, and the markup below never reaches the page — so the public site is
 * byte-identical to what it was before phase 4 for everyone who is not previewing.
 *
 * There is no JavaScript here, and there could not be: the control is a plain link to
 * a Route Handler. That keeps the "the public site works with scripting disabled"
 * promise (§7e) true for the preview as well, and leaves the public bundle unchanged.
 *
 * The bar states three things, because a preview that looks like the live site is worse
 * than no preview: that this is not live, whose session is showing it, and how to get
 * out. Status is icon **and** text, never colour alone (1aa).
 *
 * "Afslut forhåndsvisning" returns to the administration rather than to the page being
 * previewed. Knowing which page that is would mean reading a request header in the
 * shared layout, which would opt all six public pages out of static generation for the
 * sake of one link — and a staff member who has finished looking at a preview is on
 * their way back to the editor anyway.
 */
export async function PreviewBar() {
  const preview = await readPreviewSession()
  if (preview === null) return null

  return (
    <div
      role="status"
      className="bg-warning-surface border-warning-border text-warning-ink px-gutter border-b py-2 md:px-8"
    >
      <div className="max-w-content mx-auto flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-meta font-semibold">
          <span aria-hidden="true">● </span>
          Forhåndsvisning — ikke live endnu
        </p>

        <p className="text-meta text-warning-ink-2">
          Du ser kladder som {preview.profile.name}. Gæster ser det offentliggjorte indhold.
        </p>

        {/* A plain anchor, not <Link>. The destination is a Route Handler that clears
            the Draft Mode cookie, and Next.js warns that a prefetched <Link> to it can
            delete the cookie without anybody clicking. An anchor also keeps this bar
            working with scripting disabled, which the rest of the public site
            guarantees (§7e). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          className="text-meta min-h-tap ml-auto inline-flex items-center font-semibold underline"
          href="/api/preview/stop"
        >
          Afslut forhåndsvisning
        </a>
      </div>
    </div>
  )
}
