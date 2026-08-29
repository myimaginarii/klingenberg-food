import { Eyebrow } from '@/components/site/Eyebrow'
import { InlineLink } from '@/components/site/InlineLink'
import { MediaPlaceholder } from '@/components/site/MediaPlaceholder'
import { NewsTeaserCard } from './NewsTeaserCard'
import { Section } from '@/components/site/Section'
import type { NewsArticle } from '@/lib/content/types'

/**
 * The beige band — design 1g and 1l: the most recent news beside a short paragraph
 * about the restaurant.
 *
 * "Nyeste vises automatisk på forsiden" (1j): the teaser is whichever published article
 * is newest, so nobody has to remember to update the Forside after writing one. The
 * whole column disappears when there is no published article rather than showing an
 * empty card.
 */
export function NewsAndAbout({
  latestArticle,
  latestExcerpt,
  aboutHeading,
  aboutText,
}: {
  latestArticle: NewsArticle | null
  latestExcerpt: string | null
  aboutHeading: string | null
  aboutText: string | null
}) {
  return (
    <Section tone="beige">
      <div className="grid gap-8 md:grid-cols-2 md:gap-10">
        {latestArticle ? (
          <div>
            <Eyebrow as="h2">Seneste nyt</Eyebrow>
            <div className="mt-3.5">
              <NewsTeaserCard article={latestArticle} excerpt={latestExcerpt} />
            </div>
            <p className="mt-3">
              <InlineLink href="/nyheder">Alle nyheder</InlineLink>
            </p>
          </div>
        ) : null}

        <div>
          <Eyebrow as="h2">Om os</Eyebrow>
          <div className="mt-3.5 flex flex-col gap-4 md:flex-row md:gap-4">
            <MediaPlaceholder
              ratio="card"
              label="Holdet"
              className="rounded-card w-full shrink-0 md:w-37.5"
            />
            <div className="flex-1">
              {aboutHeading ? (
                <h3 className="font-display text-[1.3125rem] leading-snug font-semibold md:text-[1.375rem]">
                  {aboutHeading}
                </h3>
              ) : null}
              {aboutText ? <p className="text-ink-2 mt-2 text-[0.90625rem]">{aboutText}</p> : null}
              <p className="mt-2">
                <InlineLink href="/om-os">Læs vores historie</InlineLink>
              </p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}
