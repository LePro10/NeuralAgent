// Small building blocks shared by hero, story, showcase and demo: typed terminals, waveform, window frame.
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { INSTALL_CMD } from "./data";
import { reduced, useCopy } from "./hooks";

export type Line = [kind: "cmd" | "out" | "ok" | "del", text: string];

/**
 * Types `lines` one character at a time while `active`. Pauses at `limit` (a line index) and calls
 * `onReach(limit)`; raising `limit` continues. Changing `epoch` starts over.
 */
export function useTypist(lines: Line[], active: boolean, opts: { limit?: number; epoch?: number; onReach?: (n: number) => void; speed?: number } = {}) {
  const { limit = lines.length, epoch = 0, onReach, speed = 16 } = opts;
  const [pos, setPos] = useState<[number, number]>(reduced() ? [limit, 0] : [0, 0]);
  const cb = useRef(onReach);
  cb.current = onReach;
  const reached = useRef(-1);
  useEffect(() => {
    reached.current = -1;
    setPos(reduced() ? [limit, 0] : [0, 0]);
  }, [epoch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setPos(([i, c]) => {
        if (i >= limit) {
          if (reached.current !== limit) {
            reached.current = limit;
            queueMicrotask(() => cb.current?.(limit));
          }
          return [i, c];
        }
        const len = lines[i]![1].length;
        if (c >= len + 6) return [i + 1, 0]; // short beat between lines
        return [i, c + (lines[i]![0] === "cmd" ? 1 : 3)];
      });
    }, speed);
    return () => clearInterval(id);
  }, [active, limit, lines, speed]);
  const [i, c] = pos;
  const out: { k: Line[0]; t: string; cur: boolean }[] = [];
  for (let n = 0; n <= Math.min(i, lines.length - 1); n++) {
    const [k, t] = lines[n]!;
    const full = n < i;
    if (!full && n >= limit) break;
    out.push({ k, t: full ? t : t.slice(0, c), cur: !full });
  }
  return out;
}

export function Term({ rows }: { rows: { k: string; t: string; cur: boolean }[] }) {
  return (
    <div className="s-term">
      {rows.slice(-7).map((r, n) => (
        <div key={n} className={`${r.k}${r.cur ? " cur" : ""}`}>{r.t || " "}</div>
      ))}
    </div>
  );
}

export function StatusDot({ s }: { s: "run" | "ask" | "done" | "idle" }) {
  return <span className={`dot ${s}`} aria-hidden />;
}

/** The window chrome used for every mock. */
export function Win({ title, tabs, side, children, className = "" }: { title?: string; tabs?: string[]; side?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`s-win ${className}`}>
      <div className="s-bar">
        <span className="s-dots"><i /><i /><i /></span>
        {tabs ? (
          <span className="s-tabs-mini">{tabs.map((t, i) => <span key={t} className={i === 0 ? "on" : ""}>{t}</span>)}</span>
        ) : (
          <span className="eyebrow" style={{ marginLeft: 8 }}>{title}</span>
        )}
      </div>
      <div className={`s-body${side ? " has-side" : ""}`}>
        {side && <aside className="s-side">{side}</aside>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export const SIDE = (
  <>
    <span className="eyebrow">Workspaces</span>
    <span className="it on"><StatusDot s="run" />billing-api</span>
    <span className="it"><StatusDot s="done" />web-shop</span>
    <span className="it"><StatusDot s="idle" />infra</span>
    <span className="eyebrow">Neural</span>
    <span className="it">Calls &amp; chat</span>
    <span className="it">Swarms</span>
    <span className="it">Usage</span>
  </>
);

const BARS = Array.from({ length: 30 }, (_, i) => ({
  "--del": `${-((i * 137) % 100) / 100}s`,
  "--dur": `${0.55 + ((i * 53) % 60) / 100}s`,
  "--amp": `${0.35 + ((Math.sin(i * 0.55) + 1) / 2) * 0.65}`,
}) as CSSProperties);

export function Wave({ who, on }: { who: "you" | "neural" | "idle"; on: boolean }) {
  return (
    <div className={`s-wave ${who} ${on ? "on" : ""}`} aria-hidden>
      {BARS.map((s, i) => <i key={i} style={s} />)}
    </div>
  );
}

export function Orb({ talk }: { talk: boolean }) {
  return (
    <div className={`s-orb ${talk ? "talk" : ""}`} aria-hidden>
      <u /><u /><u /><i />
    </div>
  );
}

export function CopyCmd({ cmd = INSTALL_CMD }: { cmd?: string }) {
  const [copy, done] = useCopy(cmd);
  const [a, b] = cmd.split(" | ");
  return (
    <div className="s-copy">
      <code>
        <b>$</b> {a}{b ? <> | <span>{b}</span></> : null}
      </code>
      <button type="button" onClick={copy} className={done ? "ok" : ""} aria-label={done ? "Copied" : "Copy the install command"}>
        {done ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}

/** A pane that loops through a short scripted session (hero, showcase). */
export function AutoPane({ name, lines, active, status = "run", delay = 0 }: { name: string; lines: Line[]; active: boolean; status?: "run" | "done"; delay?: number }) {
  const [epoch, setEpoch] = useState(0);
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setGo(true), delay);
    return () => clearTimeout(id);
  }, [active, delay]);
  const rows = useTypist(lines, go && active, {
    epoch,
    onReach: () => {
      if (!reduced()) setTimeout(() => setEpoch((e) => e + 1), 3200);
    },
  });
  const finished = rows.length === lines.length && !rows[rows.length - 1]?.cur;
  return (
    <div className="s-pane">
      <div className="s-pane-h">
        <StatusDot s={finished ? "done" : status} />
        {name}
        <span className="st">{finished ? "done" : "working"}</span>
      </div>
      <Term rows={rows} />
    </div>
  );
}

/** Link styled as a button. Own implementation: the landing page must not pull in the whole UI library. */
export function Btn({ href, children, Icon, variant = "primary", size = "lg" }: { href: string; children: ReactNode; Icon?: LucideIcon; variant?: "primary" | "glass"; size?: "sm" | "lg" }) {
  return (
    <a href={href} className={`s-b ${variant} ${size}`}>
      {Icon && <Icon size={size === "sm" ? 14 : 17} />}
      {children}
    </a>
  );
}

/** The calm colour field (same CSS as the app's AuroraField; compositor-only loop). */
export function Aurora() {
  return (
    <div aria-hidden="true" className="aurora">
      <span className="aurora-blob a deko" />
      <span className="aurora-blob b deko" />
      <span className="aurora-blob c deko" />
    </div>
  );
}
