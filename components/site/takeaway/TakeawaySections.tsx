import type { TakeawaySection } from '@/lib/content/types'

import { PageContainer } from '../PageContainer'

/**
 * The free text sections on Mad ud af huset — design 1ai.
 *
 * There is no fixed list of packages, and that is a content decision rather than a
 * layout one: "Afsnit kan tilføjes, fjernes og flyttes — siden har ingen fast liste af
 * pakker" (1ai). Staff write and reorder them in the administration, so this component
 * renders whatever is there and nothing when there is nothing.
 */
export function TakeawaySections({ sections }: { sections: TakeawaySection[] }) {
  if (sections.length === 0) return null

  return (
    <PageContainer className="pb-8">
      <h2 className="sr-only">Om vores mad ud af huset</h2>
      <div className="grid gap-4 md:grid-cols-2 md:gap-4.5">
        {sections.map((section) => (
          <article
            key={section.id}
            className="bg-surface border-border rounded-card-lg border p-4 md:p-5"
          >
            {section.heading ? (
              <h3 className="font-display text-[1.1875rem] font-semibold md:text-[1.3125rem]">
                {section.heading}
              </h3>
            ) : null}
            {section.body ? <p className="text-ink-2 mt-2">{section.body}</p> : null}
          </article>
        ))}
      </div>
    </PageContainer>
  )
}
