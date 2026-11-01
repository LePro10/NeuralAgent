import type { ReactNode } from "react";

/**
 * The NeuralAgent mark: an N built from terminal panes (same shape as BrandMark in the app).
 * Each pane is its own element (`.bm-pane` with `data-pane` 0-4, the accent one is 2) so a section can animate
 * them, e.g. the mark assembling in the final call to action. The accent pane takes `--color-accent`.
 */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden fill="currentColor" className={className}>
      <rect className="bm-pane" data-pane="0" x="8" y="8" width="10" height="48" rx="3" />
      <rect className="bm-pane" data-pane="4" x="46" y="8" width="10" height="48" rx="3" />
      <rect className="bm-pane" data-pane="1" x="20" y="9" width="12" height="14" rx="3" />
      <rect className="bm-pane" data-pane="2" x="26" y="25" width="12" height="14" rx="3" style={{ color: "var(--color-accent)" }} />
      <rect className="bm-pane" data-pane="3" x="32" y="41" width="12" height="14" rx="3" />
    </svg>
  );
}

export function Brand() {
  return (
    <a href="/" className="inline-flex items-center gap-2 text-bright">
      <BrandMark size={22} />
      <span className="text-body font-medium">NeuralAgent</span>
    </a>
  );
}

/** Old footer of the simple pages (download, legal). The marketing pages use `<Footer>` from site/ui/Footer. */
export function Footer({ children }: { children?: ReactNode }) {
  return (
    <footer className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-8 text-detail text-dim">
      <span>&copy; {new Date().getFullYear()} Leandro Probst</span>
      <a href="/changelog/" className="hover:text-bright">Changelog</a>
      <a href="/imprint/" className="hover:text-bright">Imprint</a>
      <a href="/privacy/" className="hover:text-bright">Privacy</a>
      <a href="/terms/" className="hover:text-bright">Terms</a>
      <a href="/session/" className="hover:text-bright">How it was built</a>
      <a href="mailto:agent@neuralhub.dev" className="hover:text-bright">agent@neuralhub.dev</a>
      <a href="/admin/" className="ml-auto text-tiny text-faint hover:text-dim">Admin</a>
      {children}
    </footer>
  );
}
