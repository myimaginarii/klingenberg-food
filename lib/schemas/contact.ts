import { defineDraft } from './define'
import { optionalEmail, optionalHttpsUrl, optionalPhone, optionalText } from './primitives'

/**
 * Kontaktoplysninger — technical plan §4, §5 (Owner only).
 *
 * These nine facts appear on every page of the public site, which is exactly why they
 * are Owner-only: correcting a phone number here corrects it in the header, the footer,
 * the menu order bar, the mobile bottom bar and Find os at once.
 *
 * Not editable, and therefore absent: `is_singleton`, `draft` and every audit column.
 * There is no INSERT or DELETE privilege on the table at all, so the row set is fixed
 * by the migration rather than by anything a request can say.
 */
export const siteContactDraft = defineDraft({
  venue_name: optionalText(120, 'Stedets navn').optional(),
  address_line1: optionalText(160, 'Adressen').optional(),
  postal_code: optionalText(12, 'Postnummeret').optional(),
  city: optionalText(80, 'Byen').optional(),
  primary_phone: optionalPhone('Hovednummeret').optional(),
  secondary_phone: optionalPhone('Det sekundære nummer').optional(),
  email: optionalEmail('E-mailadressen').optional(),
  facebook_url: optionalHttpsUrl('Facebook-adressen').optional(),
  map_attribution: optionalText(200, 'Kortkreditering').optional(),
})
