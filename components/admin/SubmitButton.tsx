/**
 * The administration's primary button — design 1aa.
 *
 * One component rather than a class string repeated per form, so "the button that
 * commits something" looks and behaves the same on the login screen, the content editor
 * and the publish list. Every value is a token from `app/globals.css`; `min-h-tap` is
 * the design's 44 px minimum target size.
 *
 * It lives here, next to `Notice`, so the publishing components can use it without a
 * component importing from `app/`. `app/(admin)/admin/ui.tsx` re-exports it.
 */
export function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap px-6 font-semibold text-white"
    >
      {children}
    </button>
  )
}
