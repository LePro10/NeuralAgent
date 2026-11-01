// Phones and tablets: no sticky stage and no inline iframe (it would fight the page for the touch). Each chapter is a
// short copy and a poster of the real phone app; the whole device is one tap target that opens the full-screen demo.
//
// On a phone the six chapters are one swipeable deck (scroll-snap, the next one peeks in) with a rail underneath, so
// the chapters cost one screen of page instead of six; from 720 px they stack as a list again.
import { useEffect, useRef, useState } from "react";
import { ActivityMark } from "../ui";
import { CHAPTERS } from "../stage/chapters";
import { PosterDevice } from "../stage/Devices";
import { demoHref, posterSrc } from "../stage/world";
import { ChapterBody } from "./StageChapter";

export function StageStack() {
  const track = useRef<HTMLOListElement>(null);
  const slides = useRef<(HTMLLIElement | null)[]>([]);
  const [now, setNow] = useState(0);
  const [deck, setDeck] = useState(false);

  // Which slide is in front: read on scroll (one rAF), never in layout-heavy code.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const a = slides.current[0];
      const b = slides.current[1];
      const stride = a && b ? b.offsetLeft - a.offsetLeft : 0;
      const swipes = stride > 0 && el.scrollWidth > el.clientWidth + 1;
      setDeck(swipes);
      if (!swipes) return setNow(0); // the list layout: no deck
      setNow(Math.max(0, Math.min(CHAPTERS.length - 1, Math.round(el.scrollLeft / stride))));
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    el.addEventListener("scroll", request, { passive: true });
    addEventListener("resize", request);
    read();
    return () => {
      el.removeEventListener("scroll", request);
      removeEventListener("resize", request);
      cancelAnimationFrame(raf);
    };
  }, []);

  const go = (i: number) => {
    const el = track.current;
    const s = slides.current[i];
    if (!el || !s) return;
    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    el.scrollTo({ left: s.offsetLeft - pad, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  return (
    <div className="stk">
      <ol ref={track} className="stk__track" aria-label="The six chapters" tabIndex={deck ? 0 : undefined}>
        {CHAPTERS.map((c, i) => (
          <li key={c.id} ref={(el) => void (slides.current[i] = el)} className="stk__ch">
            <p className="stk__bar t-label" aria-hidden>
              <ActivityMark kind={c.mark} />
              <span>product/{c.id}</span>
              <span className="stk__no">{i + 1}/{CHAPTERS.length}</span>
            </p>
            <ChapterBody c={c} index={i} lines={[]} />
            <PosterDevice view="phone" poster={posterSrc("phone", c.poster)} alt={c.alt.phone} href={demoHref(c.scene, "phone")} />
          </li>
        ))}
      </ol>
      <nav className="stk__rail" aria-label="Chapters">
        {CHAPTERS.map((c, i) => (
          <button key={c.id} type="button" className="stk__dot" onClick={() => go(i)} aria-current={i === now ? "step" : undefined} aria-label={`Chapter ${i + 1}: ${c.short}`}>
            <span className="t-label" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
