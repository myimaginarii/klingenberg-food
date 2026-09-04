import type { NewsBody as NewsBodyDocument } from '@/lib/content/types'

/**
 * The body of a news article — technical plan §7f, §8.
 *
 * Structured JSON rendered by our own components. There is no HTML parsing on the
 * public site, no `dangerouslySetInnerHTML` and therefore no sanitizer to get wrong. The
 * editor offers exactly bold and link, and those are exactly the two marks rendered
 * here; a new node type would be a deliberate schema change plus a renderer, not an open
 * field.
 *
 * A link is rendered only when the loader has already established it is absolute
 * `https:`, and it carries `rel="noopener noreferrer"` (§8).
 *
 * `wrap-anywhere` on the paragraph: a run with no break opportunity — an address
 * pasted as text, a long compound — breaks inside the column rather than making the
 * page scroll sideways on a phone (found by the phase-12B walkthrough at 375 px).
 */
export function NewsBody({ body }: { body: NewsBodyDocument }) {
  return (
    <div className="flex flex-col gap-4">
      {body.blocks.map((block, blockIndex) => (
        <p key={blockIndex} className="max-w-[62ch] wrap-anywhere">
          {block.spans.map((span, spanIndex) => {
            const content = span.bold ? <strong>{span.text}</strong> : span.text

            return span.href ? (
              <a key={spanIndex} href={span.href} rel="noopener noreferrer" target="_blank">
                {content}
              </a>
            ) : (
              <span key={spanIndex}>{content}</span>
            )
          })}
        </p>
      ))}
    </div>
  )
}
