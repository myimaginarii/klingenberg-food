import { Eyebrow } from '@/components/site/Eyebrow'
import { InlineLink } from '@/components/site/InlineLink'
import { NewsTeaserCard } from './NewsTeaserCard'
import { NewsEmptyState } from '@/components/site/news/NewsEmptyState'
import { Section } from '@/components/site/Section'
import { SiteImage } from '@/components/site/SiteImage'
import type { NewsArticle } from '@/lib/content/types'
import type { PublicImage } from '@/lib/images/public'

/**
 * The beige band — design 1g and 1l: the most recent news beside a short paragraph
 * about the restaurant.
 *
 * "Nyeste vises automatisk på forsiden" (1j): the teaser is whichever published article
 * is newest, so nobody has to remember to update the Forside after writing one.
 *
 * NO ARTICLE IS AN HONEST EMPTY STATE, NOT A HOLE. The first build dropped the whole
 * column when nothing was published, which left the right half of the band empty. Now
 * the column stays, headed "Nyheder", and says plainly that there is nothing yet and
 * what will appear there — the same sentence the Nyheder page's own empty state uses.
 * Nothing is invented: no sample headline, no placeholder card pretending to be one. The
 * card itself is `NewsEmptyState`, shared with the Nyheder page. The empty column sits
 * second, after "Om os", so the band opens with something real.
 *
 * The "Om os" photograph (phase 11A) is the Forside document's own image slot — 1u's
 * picker — in the 4:3 frame 1g draws for this excerpt. It may be a team photo or (14B2)
 * a venue photograph reused from the Om os page; `null` is the reserved frame.
 *
 * THE TWO COLUMNS BEGIN AT `lg`, NOT `md`. The band's row is a 150 px photograph beside
 * a paragraph; split in two at 768 px each column is 326 px, which left the paragraph
 * 160 px wide — ten lines beside a photograph taller than it — and the news card beside
 * it half empty. Below `lg` the two blocks stack at the container's full width, where the
 * same photograph-beside-text row reads as one line of type each.
 */
export function NewsAndAbout({
  latestArticle,
  latestExcerpt,
  aboutHeading,
  aboutText,
  aboutImage = null,
}: {
  latestArticle: NewsArticle | null
  latestExcerpt: string | null
  aboutHeading: string | null
  aboutText: string | null
  aboutImage?: PublicImage | null
}) {
  const news = latestArticle ? (
    <div>
      <Eyebrow as="h2">Seneste nyt</Eyebrow>
      <div className="mt-3.5">
        <NewsTeaserCard article={latestArticle} excerpt={latestExcerpt} />
      </div>
      <p className="mt-3">
        <InlineLink href="/nyheder">Alle nyheder</InlineLink>
      </p>
    </div>
  ) : (
    <div>
      <Eyebrow as="h2">Nyheder</Eyebrow>
      <NewsEmptyState className="mt-3.5" />
      <p className="mt-3">
        <InlineLink href="/nyheder">Se nyheder</InlineLink>
      </p>
    </div>
  )

  return (
    <Section tone="beige">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
        {latestArticle ? news : null}

        <div>
          <Eyebrow as="h2">Om os</Eyebrow>
          <div className="mt-3.5 flex flex-col gap-4 md:flex-row md:gap-4">
            <SiteImage
              image={aboutImage}
              ratio="card"
              sizes="homeTeam"
              placeholder={{ label: 'Holdet' }}
              className="rounded-card w-full shrink-0 md:w-37.5"
            />
            <div className="flex-1">
              {aboutHeading ? (
                <h3 className="font-display text-card">
                  {aboutHeading}
                </h3>
              ) : null}
              {aboutText ? <p className="text-ink-2 mt-2 text-support">{aboutText}</p> : null}
              <p className="mt-2">
                <InlineLink href="/om-os">Læs vores historie</InlineLink>
              </p>
            </div>
          </div>
        </div>

        {latestArticle ? null : news}
      </div>
    </Section>
  )
}
