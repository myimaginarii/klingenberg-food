import { type PostalAddress, formatAddressLine } from './links'

/**
 * The Google Maps embed URL — technical plan §7g (decision 6, revised for launch).
 *
 * Replaces the static map image: the guest's browser loads Google's own iframe
 * directly, centred on the stored address. No map library, no tile provider called
 * from this origin, no custom JavaScript.
 *
 * `apiKey` defaults to `GOOGLE_MAPS_EMBED_API_KEY` (read here, not through
 * `lib/env/server.ts`, because the key is not a secret — it appears in plain sight in
 * the rendered iframe `src` and is meant to be restricted by HTTP referrer, not kept
 * out of the page). Left unset, the URL falls back to the keyless `output=embed` form,
 * which needs no Google Cloud project at all — this is what local development and any
 * deployment without the variable render. Setting the variable moves the embed onto
 * Google's supported Maps Embed API instead; see `.env.example` for the exact name.
 */
export function mapEmbedUrl(
  address: PostalAddress,
  apiKey: string | undefined = process.env.GOOGLE_MAPS_EMBED_API_KEY,
): string {
  const query = encodeURIComponent(formatAddressLine(address))

  if (apiKey) {
    return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${query}`
  }
  return `https://www.google.com/maps?q=${query}&output=embed`
}
