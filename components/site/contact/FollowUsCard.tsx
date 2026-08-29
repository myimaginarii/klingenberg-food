import { Eyebrow } from '../Eyebrow'

/**
 * "Følg os" — design 1k and 1o.
 *
 * Facebook is the restaurant's only channel; there is no Instagram, and 1ab says so
 * outright. The card renders only when the link is filled in — "Er feltet tomt,
 * forsvinder hele kortet uden at efterlade hul" (1k) — which is why the caller passes a
 * nullable URL and gets nothing back rather than an empty box.
 */
export function FollowUsCard({ facebookUrl }: { facebookUrl: string | null }) {
  if (facebookUrl === null) return null

  return (
    <section
      aria-labelledby="find-os-foelg"
      className="bg-surface border-border rounded-card-lg border p-4 md:p-5"
    >
      <Eyebrow as="h2" id="find-os-foelg">
        Følg os
      </Eyebrow>
      <p className="mt-3">
        <a
          href={facebookUrl}
          rel="noopener noreferrer"
          target="_blank"
          className="border-ink text-ink rounded-badge hover:bg-ink inline-flex min-h-12 items-center border-[1.5px] px-5 font-semibold no-underline hover:text-white"
        >
          Facebook
        </a>
      </p>
      <p className="text-ink-3 mt-2 font-mono text-[0.8125rem]">
        {facebookUrl.replace(/^https:\/\/(www\.)?/, '')}
      </p>
    </section>
  )
}
