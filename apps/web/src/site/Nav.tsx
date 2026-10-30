import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "../brand";
import { NAV, useRelease } from "./data";
import { Btn } from "./parts";

export function Nav() {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState("");
  const { cta } = useRelease();

  useEffect(() => {
    const els = NAV.map((n) => document.getElementById(n.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && setOn(e.target.id)),
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
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
            {NAV.map((n) => <a key={n.id} href={`#${n.id}`} className={on === n.id ? "on" : ""}>{n.label}</a>)}
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
            {NAV.map((n) => <a key={n.id} href={`#${n.id}`} onClick={() => setOpen(false)}>{n.label}</a>)}
            <a href="/app/">Web remote</a>
            <a href="/download">All downloads</a>
          </nav>
        )}
      </div>
    </>
  );
}
