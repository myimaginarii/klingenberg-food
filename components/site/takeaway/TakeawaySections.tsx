import type { TakeawaySection } from '@/lib/content/types'

import { PageContainer } from '../PageContainer'

/**
 * The free text sections on Mad ud af huset — design 1ai.
 *
 * There is no fixed list of packages, and that is a content decision rather than a
 * layout one: "Afsnit kan tilføjes, fjernes og flyttes — siden har ingen fast liste af
 * pakker" (1ai). The list is `content/site/pages.ts`, so this component renders
 * whatever is there and nothing when there is nothing.
 */
export function TakeawaySections({ sections }: { sections: TakeawaySection[] }) {
  if (sections.length === 0) return null

  return (
    <PageContainer className="pb-11">
      <h2 className="sr-only">Om vores mad ud af huset</h2>
      {/* Two hairline-topped columns rather than two bordered cards. The page already
          runs a photograph, a burgundy call to action and the dark footer in a row; a
          pair of filled boxes between them made four heavy bands in a row out of what is
          really just supporting text. The rule carries the grouping instead. */}
      <div className="grid gap-7 md:grid-cols-2 md:gap-9">
        {sections.map((section) => (
          <article key={section.id} className="border-border border-t pt-4">
            {section.heading ? (
              <h3 className="font-display text-card">{section.heading}</h3>
            ) : null}
            {section.body ? (
              <p className="text-ink-2 text-support mt-2 max-w-[56ch]">{section.body}</p>
            ) : null}
          </article>
        ))}
      </div>
    </PageContainer>
  )
}
