import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { BrandMark } from "../../brand";
import { GITHUB, NAV_LINKS, SECTIONS } from "../content";
import { ActivityMark } from "./ActivityMark";
import { LinkButton } from "./Button";
import { useActiveSection, useMedia } from "./hooks";
import { GitHubIcon, Icon } from "./Icon";
import { useRelease } from "./release";
import { SendToComputer } from "./SendToComputer";

const isLanding = () => location.pathname === "/" || location.pathname === "/index.html";
const MENU_LINKS = [
  ...NAV_LINKS.slice(0, 3),
  { label: "Agents", href: "/features/#agents" },
  { label: "Download", href: "#download", id: "download" },
  { label: "FAQ", href: "#faq", id: "faq" },
  { label: "Changelog", href: "/changelog/" },
];

/** In-page links ("#id") become "/#id" on other pages. */
const resolve = (href: string, landing: boolean) => (href.startsWith("#") && !landing ? `/${href}` : href);

/**
 * Site navigation for every marketing page. Sticky, solid with a hairline once the page has scrolled (no glass).
 * Desktop: links + GitHub + OS-aware download. Phone: logo, one compact action, menu button → full-height sheet
 * (focus trap, Escape, safe areas, 68 px rows). The active landing section is marked with the activity vocabulary.
 */
export function Nav() {
  const landing = isLanding();
  const { cta, latest, phone } = useRelease();
  const active = useActiveSection(landing ? SECTIONS.map((s) => s.id) : []);
  const pathname = location.pathname.replace(/\/$/, "");
  const [open, setOpen] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const wide = useMedia("(min-width: 880px)");
  const close = useCallback(() => setOpen(false), []);

  // The mark of the "current" item: the landing section in view, or the page we are on.
  const current = (href: string, id?: string) => (id && active === id ? "location" : !href.startsWith("#") && href.replace(/\/$/, "") === pathname ? "page" : undefined);

  useEffect(() => {
    if (!open) return;
    if (wide) return close();
    const root = document.documentElement;
    root.setAttribute("data-menu", "");
    const opener = document.activeElement as HTMLElement | null;
    const nav = sheet.current!.closest(".na-nav");
    const page = nav?.parentElement;
    const others = page ? Array.from(page.children).filter((c) => c !== nav) : [];
    others.forEach((c) => c.setAttribute("inert", ""));
    (sheet.current!.querySelector<HTMLElement>("[data-first]") ?? sheet.current)!.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      if (e.key !== "Tab") return;
      const f = Array.from(sheet.current!.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      root.removeAttribute("data-menu");
      others.forEach((c) => c.removeAttribute("inert"));
      (burger.current ?? opener)?.focus();
    };
  }, [open, wide, close]);

  const phoneCta = phone
    ? { href: "/demo/?view=phone", label: "Try it live" }
    : { href: cta.href, label: cta.short };

  return (
    <header className="na-nav">
      <div className="na-nav__in">
        <a className="na-brand" href="/" aria-label="NeuralAgent, home">
          <BrandMark size={22} />
          <span>NeuralAgent</span>
        </a>
        <nav aria-label="Main" className="na-nav__nav">
          <ul className="na-nav__links">
            {NAV_LINKS.map((l) => (
              <li key={l.label} className={l.hideMid ? "na-nav__item--mid" : undefined}>
                <a className="na-nav__link" href={resolve(l.href, landing)} aria-current={current(l.href, l.id)}>
                  {current(l.href, l.id) && <ActivityMark kind={current(l.href, l.id) === "location" ? "working" : "idle"} size="sm" />}
                  <span style={current(l.href, l.id) ? { paddingLeft: 8 } : undefined}>{l.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="na-nav__actions">
          <a className="na-btn na-nav__gh" data-variant="icon" data-size="md" href={GITHUB} target="_blank" rel="noopener noreferrer" aria-label="NeuralAgent on GitHub">
            <GitHubIcon size={19} />
          </a>
          <LinkButton variant="primary" size="sm" href={wide ? cta.href : phoneCta.href}>
            {wide ? (
              <>
                <span className="na-nav__cta-long">{cta.label}</span>
                <span className="na-nav__cta-short">{cta.short}</span>
              </>
            ) : (
              phoneCta.label
            )}
          </LinkButton>
          <button ref={burger} type="button" className="na-btn na-nav__burger" data-variant="icon" data-size="md" aria-label="Open menu" aria-expanded={open} aria-controls={open ? "na-menu" : undefined} onClick={() => setOpen(true)}>
            <Icon as={Menu} size={22} />
          </button>
        </div>
      </div>

      {open && (
        <div ref={sheet} id="na-menu" className="na-sheet" role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1}>
          <div className="na-sheet__bar">
            <a className="na-brand" href="/" aria-label="NeuralAgent, home" onClick={close}>
              <BrandMark size={22} />
              <span>NeuralAgent</span>
            </a>
            <button type="button" className="na-btn" data-variant="icon" data-size="md" aria-label="Close menu" data-first onClick={close}>
              <Icon as={X} size={22} />
            </button>
          </div>
          <ul className="na-sheet__list">
            {MENU_LINKS.map((l, i) => {
              const cur = current(l.href, "id" in l ? l.id : undefined);
              return (
                <li key={l.label}>
                  <a className="na-sheet__link" style={{ "--i": i } as React.CSSProperties} href={resolve(l.href, landing)} aria-current={cur} onClick={close}>
                    {l.label}
                    {cur ? <ActivityMark kind={cur === "location" ? "working" : "idle"} size="md" /> : <Icon as={ArrowRight} size={20} />}
                  </a>
                </li>
              );
            })}
            <li>
              <a className="na-sheet__link" style={{ "--i": MENU_LINKS.length } as React.CSSProperties} href={GITHUB} target="_blank" rel="noopener noreferrer" onClick={close}>
                GitHub
                <GitHubIcon size={22} />
              </a>
            </li>
          </ul>
          <div className="na-sheet__foot">
            <LinkButton variant="primary" size="lg" href="/demo/?view=phone" arrow="go" onClick={close}>Try it live</LinkButton>
            {phone ? <SendToComputer /> : <LinkButton variant="secondary" size="lg" href={cta.href} onClick={close}>{cta.label}</LinkButton>}
            <p className="t-label" style={{ margin: 0 }}>{latest ? `Latest release v${latest.version}` : "Open source, AGPL-3.0"}</p>
          </div>
        </div>
      )}
    </header>
  );
}
