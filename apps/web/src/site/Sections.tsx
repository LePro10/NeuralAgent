import { Apple, ArrowRight, Download, Globe, KeyRound, Laptop, Lock, Minus, Plus, Server, ShieldCheck, Smartphone, Terminal as Term, type LucideIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { BrandMark } from "../brand";
import { FAQ, MAIL, NAV, OS_LABEL, useRelease, type Os } from "./data";
import { useSeen } from "./hooks";
import { Aurora, Btn, CopyCmd } from "./parts";

const Demo = lazy(() => import("./Demo"));

export function DemoSection() {
  const [ref, seen] = useSeen<HTMLDivElement>("300px");
  return (
    <section id="demo" className="s-sec" style={{ paddingTop: 0 }}>
      <div className="s-wrap">
        <div className="s-head center" data-reveal>
          <span className="eyebrow">Live demo</span>
          <h2 className="s-h2">Try it. Right here.</h2>
          <p className="s-lead">A small NeuralAgent running in your browser. Approve what the agents ask, call Neural, check your phone. Nothing leaves this page.</p>
        </div>
        <div ref={ref} data-reveal style={{ minHeight: 640 }}>
          {seen ? <Suspense fallback={<div className="s-win" style={{ minHeight: 540 }} />}><Demo /></Suspense> : null}
        </div>
      </div>
    </section>
  );
}

export function Numbers() {
  return (
    <section className="s-sec" style={{ paddingBlock: "0 clamp(64px,10vw,120px)" }}>
      <div className="s-wrap">
        <div className="s-nums" data-reveal>
          {[["13", "agent CLIs in one list"], ["3", "desktop systems, plus Android"], ["0", "bytes of your code on our servers"], ["E2E", "sealed phone and web access"]].map(([n, l]) => (
            <div key={l}><b>{n}</b><span>{l}</span></div>
          ))}
        </div>
      </div>
    </section>
  );
}

const DG = (
  <svg className="dg s-svg" viewBox="0 0 760 200" role="img" aria-label="Messages are sealed on your computer, pass the relay as ciphertext and are opened on your phone">
    <g className="nd"><rect x="20" y="50" width="190" height="100" rx="18" /></g>
    <g className="nd hot"><rect x="285" y="62" width="190" height="76" rx="18" /></g>
    <g className="nd"><rect x="550" y="50" width="190" height="100" rx="18" /></g>
    <text className="big" x="115" y="92" textAnchor="middle">Your computer</text>
    <text x="115" y="114" textAnchor="middle">agents · terminals · keys</text>
    <text className="big" x="380" y="96" textAnchor="middle">Relay</text>
    <text x="380" y="118" textAnchor="middle">sees only ciphertext</text>
    <text className="big" x="645" y="92" textAnchor="middle">Your phone</text>
    <text x="645" y="114" textAnchor="middle">browser · app · keys</text>
    <path className="ln s-flow" d="M210 100 H285" /><path className="ln s-flow" d="M475 100 H550" />
    <text x="248" y="88" textAnchor="middle" style={{ fill: "var(--color-accent)" }}>seal</text>
    <text x="512" y="88" textAnchor="middle" style={{ fill: "var(--color-accent)" }}>open</text>
  </svg>
);

const DGV = (
  <svg className="dgv s-svg" viewBox="0 0 300 380" role="img" aria-label="Messages are sealed on your computer, pass the relay as ciphertext and are opened on your phone">
    <g className="nd"><rect x="40" y="10" width="220" height="80" rx="18" /></g>
    <g className="nd hot"><rect x="40" y="150" width="220" height="80" rx="18" /></g>
    <g className="nd"><rect x="40" y="290" width="220" height="80" rx="18" /></g>
    <text className="big" x="150" y="46" textAnchor="middle">Your computer</text>
    <text x="150" y="68" textAnchor="middle">agents · terminals · keys</text>
    <text className="big" x="150" y="186" textAnchor="middle">Relay</text>
    <text x="150" y="208" textAnchor="middle">sees only ciphertext</text>
    <text className="big" x="150" y="326" textAnchor="middle">Your phone</text>
    <text x="150" y="348" textAnchor="middle">browser · app · keys</text>
    <path className="ln s-flow" d="M150 90 V150" /><path className="ln s-flow" d="M150 230 V290" />
    <text x="166" y="125" style={{ fill: "var(--color-accent)" }}>seal</text>
    <text x="166" y="265" style={{ fill: "var(--color-accent)" }}>open</text>
  </svg>
);

const SEC: [LucideIcon, string, string][] = [
  [Laptop, "Local first", "Agents, files and terminals stay on your computer. The desktop app works fully without an account or an internet connection to us."],
  [Lock, "Sealed end to end", "Each device creates its own keys. Messages use an X25519 key exchange and AES-256-GCM, so only your own devices can open them."],
  [Server, "A relay that cannot read", "It routes envelopes between your devices and wakes your phone. It stores accounts and device names, never your sessions."],
  [KeyRound, "Your keys stay yours", "Model keys live in your system keychain. MCP secrets are handed to agents by environment variable, not written to a command line."],
];

export function Security() {
  return (
    <section id="security" className="s-sec">
      <div className="s-wrap">
        <div className="s-head" data-reveal>
          <span className="eyebrow">Security and privacy</span>
          <h2 className="s-h2">The relay carries it. Only you can read it.</h2>
          <p className="s-lead">Reaching your agents from your phone should not mean handing your code to someone else. <b>NeuralAgent is built so it does not.</b></p>
        </div>
        <div className="s-card s-diagram" data-reveal>{DG}{DGV}</div>
        <div className="s-sec-grid">
          {SEC.map(([I, h, p], i) => (
            <div key={h} className="s-card s-spot" data-reveal style={{ ["--i" as never]: i }}>
              <span className="s-ic"><I size={18} /></span>
              <h4>{h}</h4>
              <p>{p}</p>
            </div>
          ))}
        </div>
        <p className="s-ver" data-reveal><ShieldCheck size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />No analytics, no advertising, no cookies. Read the <a href="/privacy" style={{ color: "var(--color-ink)" }}>privacy policy</a>.</p>
      </div>
    </section>
  );
}

const PLATS: { os: Os; Icon: LucideIcon; title: string; text: string; kind: string; label: string; href?: string }[] = [
  { os: "mac", Icon: Apple, title: "macOS", text: "Apple silicon and Intel. Install with one command, or use the DMG.", kind: "mac", label: "Download" },
  { os: "windows", Icon: Laptop, title: "Windows", text: "64-bit installer. The app updates itself.", kind: "windows", label: "Download" },
  { os: "linux", Icon: Term, title: "Linux", text: "AppImage, and a .deb for Debian and Ubuntu.", kind: "linux", label: "Download" },
  { os: "android", Icon: Smartphone, title: "Android", text: "The remote as an app, with notifications and a Call Neural tile.", kind: "android", label: "Get the APK" },
  { os: "ios", Icon: Globe, title: "iPhone and browser", text: "Open the web remote, then Share, Add to Home Screen. Works as an app with push.", kind: "", label: "Open web remote", href: "/app/" },
];

export function Platforms() {
  const { latest, os } = useRelease();
  return (
    <section id="platforms" className="s-sec">
      <div className="s-wrap">
        <div className="s-head center" data-reveal>
          <span className="eyebrow">Platforms</span>
          <h2 className="s-h2">On every screen you own.</h2>
          <p className="s-lead">Agents run on your computer. Everything else follows you.</p>
        </div>
        <div className="s-plat">
          {PLATS.map((p, i) => {
            const href = p.href ?? latest?.downloads[p.kind] ?? "/download";
            return (
              <a key={p.title} href={href} className={`s-card s-spot s-pcard${p.os === os ? " mine" : ""}`} data-reveal style={{ ["--i" as never]: i }}>
                <span className="s-ic"><p.Icon size={18} /></span>
                <h4>{p.title}{p.os === os ? <span className="s-dim"> · {OS_LABEL[os] === "iPhone" ? "this device" : "this computer"}</span> : null}</h4>
                <p>{p.text}</p>
                <span className="go">{p.label} <ArrowRight size={14} /></span>
              </a>
            );
          })}
        </div>
        <div style={{ marginTop: 28, display: "grid", justifyItems: "center", gap: 12 }} data-reveal>
          <span className="s-dim" style={{ fontSize: "var(--text-detail)" }}>macOS in one line, without the security prompt:</span>
          <CopyCmd />
          <p className="s-ver" style={{ margin: 0 }}>
            {latest ? <>Version {latest.version} · {new Date(latest.pub_date).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })} · </> : null}
            <a href="/download" style={{ color: "var(--color-ink)" }}>All downloads</a>
          </p>
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="s-sec">
      <div className="s-wrap">
        <div className="s-head center" data-reveal>
          <span className="eyebrow">FAQ</span>
          <h2 className="s-h2">Good questions.</h2>
        </div>
        <div className="s-faq" data-reveal>
          {FAQ.map((f, i) => (
            <details key={f.q} open={open === i} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpen(i); else if (open === i) setOpen(null); }}>
              <summary>{f.q}{open === i ? <Minus size={18} /> : <Plus size={18} />}</summary>
              <div className="a"><div><p>{f.a}</p></div></div>
            </details>
          ))}
        </div>
        <p className="s-ver" data-reveal>Something else? <a href={`mailto:${MAIL}`} style={{ color: "var(--color-ink)" }}>{MAIL}</a></p>
      </div>
    </section>
  );
}

export function Final() {
  const { cta, os } = useRelease();
  return (
    <section className="s-final" data-sp>
      <div className="aur" aria-hidden><Aurora /></div>
      <div className="s-wrap" style={{ display: "grid", justifyItems: "center", gap: 22 }}>
        <span style={{ color: "var(--color-bright)" }} data-reveal><BrandMark size={44} /></span>
        <h2 className="s-h2" data-reveal style={{ fontSize: "clamp(2.2rem, 7vw, 4.4rem)", margin: 0 }}>Give your agents a home.</h2>
        <p className="s-lead" data-reveal style={{ maxWidth: 520, margin: 0 }}>One install. Every agent. Every screen you own.</p>
        <div className="s-cta" style={{ opacity: 1, animation: "none", margin: 0 }} data-reveal>
          <Btn href={cta.href} Icon={os === "mac" ? Apple : Download}>{cta.label}</Btn>
          <Btn href="/app/" variant="glass" Icon={Globe}>Open web remote</Btn>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="s-foot">
      <div className="s-wrap">
        <div className="s-foot-grid">
          <div>
            <a href="/" className="s-logo"><BrandMark size={20} /> NeuralAgent</a>
            <p style={{ margin: "8px 0 0", maxWidth: 320, lineHeight: 1.55 }}>The calm home for your AI coding agents. By NeuralHub, made by Leandro Probst.</p>
          </div>
          <nav aria-label="Product"><h5 className="eyebrow">Product</h5>{NAV.slice(0, 4).map((n) => <a key={n.id} href={`#${n.id}`}>{n.label}</a>)}</nav>
          <nav aria-label="Get it"><h5 className="eyebrow">Get it</h5><a href="/download">Download</a><a href="/app/">Web remote</a><a href="/session/">How it was built</a></nav>
          <nav aria-label="Legal"><h5 className="eyebrow">Legal</h5><a href="/imprint">Imprint</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href={`mailto:${MAIL}`}>{MAIL}</a></nav>
        </div>
        <div className="s-foot-base">
          <span>&copy; {new Date().getFullYear()} Leandro Probst · NeuralHub</span>
          <a href="/admin/" style={{ color: "var(--color-faint)" }}>Admin</a>
        </div>
      </div>
    </footer>
  );
}
