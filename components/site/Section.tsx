import { PageContainer } from './PageContainer'

/**
 * A page section — design 1aa ("Mellemrum · 4-skala": sektion desktop 44, mobil 24).
 *
 * The three tones are the three surfaces the approved frames use and no others: the
 * page cream, the beige band that separates a group of sections, and the burgundy band
 * the award and the takeaway call to action sit on. "Burgundy bruges som accent og til
 * få store flader — ikke som baggrund for hele sider" (1a).
 */

export type SectionTone = 'page' | 'beige' | 'brand'

const TONE_CLASSES: Record<SectionTone, string> = {
  page: 'bg-bg',
  beige: 'bg-section border-border border-t',
  brand: 'bg-brand-700 text-white',
}

export function Section({
  tone = 'page',
  id,
  ariaLabelledBy,
  className = '',
  children,
}: {
  tone?: SectionTone
  id?: string
  ariaLabelledBy?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={ariaLabelledBy}
      className={`${TONE_CLASSES[tone]} py-section-mobile md:py-section ${className}`}
    >
      <PageContainer>{children}</PageContainer>
    </section>
  )
}
