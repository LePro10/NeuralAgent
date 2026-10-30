import "./styles.css";
import "./site/site.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Hero } from "./site/Hero";
import { startScroll } from "./site/hooks";
import { Nav, goTo } from "./site/Nav";
import { DemoSection, Faq, Final, Numbers, Platforms, Security, SiteFooter } from "./site/Sections";
import { Showcase } from "./site/Showcase";
import { Story } from "./site/Story";
import { AGENTS } from "./site/data";
import { Aurora } from "./site/parts";

function Marquee() {
  const row = AGENTS.map((a) => <span key={a}>{a}</span>);
  return (
    <section className="s-sec" style={{ paddingBlock: "clamp(40px,6vw,72px)" }} aria-label="Supported agents">
      <div className="s-wrap" style={{ display: "grid", gap: 16, justifyItems: "center" }}>
        <span className="eyebrow">Runs the agents you already use</span>
        <div className="s-strip" style={{ width: "100%" }} aria-hidden>
          <div className="s-strip-in">{row}</div>
          <div className="s-strip-in">{row}</div>
        </div>
        <ul className="sr-only">{AGENTS.map((a) => <li key={a}>{a}</li>)}</ul>
      </div>
    </section>
  );
}

function Landing() {
  return (
    <>
      <div className="s-fixed" aria-hidden><Aurora /></div>
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Story />
        <Showcase />
        <DemoSection />
        <Numbers />
        <Security />
        <Platforms />
        <Faq />
        <Final />
      </main>
      <SiteFooter />
    </>
  );
}

// Pointer light on cards: one listener, two custom properties.
addEventListener(
  "pointermove",
  (e) => {
    const el = (e.target as HTMLElement).closest?.<HTMLElement>(".s-spot");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  },
  { passive: true },
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
// A fresh load starts at the top; reload and back/forward keep the browser's own restore.
const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
if (nav?.type !== "back_forward") {
  history.scrollRestoration = "manual";
  history.replaceState(null, "", location.pathname + location.search);
  scrollTo(0, 0);
} else history.scrollRestoration = "auto";
startScroll();

// Every other in-page link (hero, footer) lands the same way.
addEventListener("click", (e) => {
  if (e.defaultPrevented) return;
  const a = (e.target as HTMLElement).closest?.<HTMLAnchorElement>('a[href^="#"]');
  const id = a?.getAttribute("href")?.slice(1);
  if (id && document.getElementById(id)) {
    e.preventDefault();
    goTo(id);
  }
});
