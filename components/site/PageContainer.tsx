/**
 * The shared content measure — design 1aa ("Brudpunkter").
 *
 * ">=1440 — indhold maks 1280, brede marginer" and "<768 — 16 px gutter". One
 * container, used by the header, every page section and the footer, so nothing on the
 * site can drift out of alignment with everything else.
 */
export function PageContainer({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={`mx-auto w-full max-w-content px-gutter md:px-10 ${className}`}>{children}</div>
}
