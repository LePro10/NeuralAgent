import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "../brand";
import { NAV, useRelease } from "./data";
import { reduced } from "./hooks";
import { Btn } from "./parts";

/** Where a section's content starts, below the fixed nav. Re-read on every call: lazy parts change heights. */
function targetY(id: string) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
  const y = el.getBoundingClientRect().top + scrollY + (id === "story" ? 0 : pad) - (id === "story" ? 0 : 88);
  return Math.max(0, Math.round(y));
}

/** Smooth scroll to a section, then re-correct while images, the lazy demo and reveals settle. */
export function goTo(id: string) {
  const calm = reduced();
  scrollTo({ top: targetY(id), behavior: calm ? "auto" : "smooth" });
  history.replaceState(null, "", `#${id}`);
  let n = 0;
  const fix = () => {
    const y = targetY(id);
    if (Math.abs(y - scrollY) > 3) scrollTo({ top: y, behavior: "auto" });
    if (++n < 3) setTimeout(fix, n === 1 ? 800 : 700);
  };
  setTimeout(fix, 700);
}

export function Nav() {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState("");
  const { cta } = useRelease();

  // Active section = the last one whose top has passed just under the nav.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      let cur = "";
      for (const n of NAV) {
        const el = document.getElementById(n.id);
        if (el && el.getBoundingClientRect().top <= innerHeight * 0.35) cur = n.id;
      }
      setOn(cur);
    };
    const req = () => raf || (raf = requestAnimationFrame(tick));
    addEventListener("scroll", req, { passive: true });
    tick();
    return () => removeEventListener("scroll", req);
  }, []);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open]);

  return (
    <>
      <div className="s-progress" aria-hidden />
      <div className={`s-nav${open ? " open" : ""}`}>
        <div className="s-nav-in">
          <a href="/" className="s-logo" aria-label="NeuralAgent, home"><BrandMark size={22} /> NeuralAgent</a>
          <nav className="s-links" aria-label="Sections">
            {NAV.map((n) => <a key={n.id} href={`#${n.id}`} className={on === n.id ? "on" : ""} onClick={(e) => { e.preventDefault(); goTo(n.id); }}>{n.label}</a>)}
          </nav>
          <div className="s-nav-cta">
            <span className="s-hide-xs"><Btn href={cta.href} size="sm">{cta.label.startsWith("Download for") ? "Download" : cta.label}</Btn></span>
            <button type="button" className="s-burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="s-sheet" aria-label="Menu">
            {NAV.map((n) => <a key={n.id} href={`#${n.id}`} onClick={(e) => { e.preventDefault(); setOpen(false); goTo(n.id); }}>{n.label}</a>)}
            <a href="/app/">Web remote</a>
            <a href="/download">All downloads</a>
          </nav>
        )}
      </div>
    </>
  );
}
