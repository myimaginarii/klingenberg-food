/**
 * Serialising a JSON-LD block — technical plan §8, §11.
 *
 * Shared by every structured-data block the site renders: the `Restaurant` on the
 * Forside and Find os (`lib/seo/restaurant.ts`) and the `NewsArticle` on an article page
 * (`lib/seo/news-article.ts`).
 *
 * JSON for a `<script type="application/ld+json">` rendered as an ordinary React text
 * child. `<`, `>` and `&` become `\uXXXX` escapes — equal JSON, different bytes — so the
 * output cannot close the `<script>` element early no matter what a title or an award
 * line says, and needs no `dangerouslySetInnerHTML` (§8 forbids it) because the
 * serialized string then contains nothing React's own text escaping would rewrite.
 *
 * U+2028 and U+2029 are escaped for the same reason a JSON-to-JavaScript boundary
 * usually escapes them: they are valid in JSON strings and are line terminators to a
 * JavaScript parser.
 */
export function serializeJsonLd(value: object): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    const code = character.codePointAt(0) ?? 0
    return `\\u${code.toString(16).padStart(4, '0')}`
  })
}
