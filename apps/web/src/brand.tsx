import type { ReactNode } from "react";

/** The NeuralAgent mark: an N built from terminal panes (same shape as BrandMark in the app). */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden fill="currentColor">
      <rect x="8" y="8" width="10" height="48" rx="3" />
      <rect x="46" y="8" width="10" height="48" rx="3" />
      <rect x="20" y="9" width="12" height="14" rx="3" />
      <rect x="26" y="25" width="12" height="14" rx="3" style={{ color: "var(--color-accent)" }} />
      <rect x="32" y="41" width="12" height="14" rx="3" />
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

/** Links shared by the footer of every public page. */
export function Footer({ children }: { children?: ReactNode }) {
  return (
    <footer className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-8 text-detail text-dim">
      <span>NeuralHub</span>
      <a href="/imprint" className="hover:text-bright">Imprint</a>
      <a href="/privacy" className="hover:text-bright">Privacy</a>
      <a href="/terms" className="hover:text-bright">Terms</a>
      <a href="/session/" className="hover:text-bright">How it was built</a>
      <a href="/admin/" className="ml-auto text-tiny text-faint hover:text-dim">Admin</a>
      {children}
    </footer>
  );
}
