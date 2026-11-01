import type { ReactNode } from "react";
import { Footer, Nav } from "../ui";

/** Shell of every sub-page: skip link, nav, `<main id="main">`, footer (same landmarks as the landing). */
export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="na-page">
      <a className="na-skip" href="#main">Skip to content</a>
      <Nav />
      <main id="main" className="na-main" tabIndex={-1}>{children}</main>
      <Footer />
    </div>
  );
}
