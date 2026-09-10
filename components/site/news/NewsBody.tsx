import type { NewsBody as NewsBodyDocument } from '@/lib/content/types'

/**
 * The body of a news article — technical plan §7f, §8.
 *
 * One `<p>` per stored paragraph, and the paragraph is a string. There is no HTML
 * parsing on the public site, no `dangerouslySetInnerHTML` and therefore no sanitizer
 * to get wrong; there is also nothing inside an article that reaches the page as more
 * than text, so an article carries no link and no mark for one to be about. A second
 * kind of block would be a deliberate schema change plus a component here, not an open
 * field.
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
          {block.text}
        </p>
      ))}
    </div>
  )
}
