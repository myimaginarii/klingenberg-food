import { ActionLink } from '@/components/site/ActionLink'
import { PageContainer } from '@/components/site/PageContainer'

/**
 * The 404 page — technical plan §10g ("`error.tsx` and `not-found.tsx` in both route
 * groups, in the approved visual language").
 *
 * It introduces no new design: the site's own type scale, its two button treatments and
 * a way back. A guest who mistypes a URL, or follows a link to an article that has been
 * unpublished (§7f), lands here rather than on a framework default.
 */
export default function SiteNotFound() {
  return (
    <PageContainer className="py-12 md:py-20">
      <p className="font-mono text-eyebrow text-ink-3 uppercase">Siden findes ikke</p>
      <h1 className="font-display text-page mt-3">
        Vi kunne ikke finde siden
      </h1>
      <p className="text-ink-2 mt-3 max-w-[52ch]">
        Linket er måske forældet, eller adressen er skrevet forkert. Prøv menuen eller
        forsiden.
      </p>
      <div className="mt-6 flex flex-col gap-2.5 md:flex-row">
        <ActionLink href="/" block className="md:w-auto">
          Til forsiden
        </ActionLink>
        <ActionLink href="/menu" variant="secondary" block className="md:w-auto">
          Se menuen
        </ActionLink>
      </div>
    </PageContainer>
  )
}
