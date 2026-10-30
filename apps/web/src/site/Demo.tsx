// The live demo: a simulated NeuralAgent window. Pure front-end; no network, no backend.
import { Monitor, Phone, PhoneOff, Smartphone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { reduced, useMedia, useVisible } from "./hooks";
import { Orb, SIDE, StatusDot, Term, Wave, Win, useTypist, type Line } from "./parts";

type Phase = "run1" | "ask" | "run2" | "done";

interface Spec {
  id: string;
  name: string;
  ask: string;
  note: string;
  lines: Line[];
  askAt: number;
}

const SPECS: Spec[] = [
  {
    id: "claude", name: "Claude Code", ask: "Edit src/checkout/total.ts?", note: "Claude Code is waiting for you", askAt: 4,
    lines: [["cmd", "fix the failing checkout test"], ["out", "Reading src/checkout/total.ts"], ["out", "Rounding happens before tax"], ["out", "I would like to edit total.ts"], ["ok", "Edited total.ts (+4 -2)"], ["out", "Running the test suite"], ["ok", "14 tests passed"]],
  },
  {
    id: "codex", name: "Codex", ask: "Run migration 0042 on the dev database?", note: "Codex needs your OK", askAt: 4,
    lines: [["cmd", "add an invoices table"], ["out", "Diffing schema.sql"], ["ok", "Wrote 0042_invoices.sql"], ["out", "Ready to apply it"], ["ok", "Migration applied"], ["ok", "Schema in sync"]],
  },
  {
    id: "gemini", name: "Gemini CLI", ask: "Run npm run build?", note: "Gemini CLI wants to run a command", askAt: 3,
    lines: [["cmd", "check the bundle size"], ["out", "Found 3 large imports"], ["out", "Need to run the build"], ["ok", "Build finished in 4.1 s"], ["ok", "Bundle: 212 kB, down 18%"]],
  },
  {
    id: "aider", name: "Aider", ask: "Commit 3 changed files?", note: "Aider has changes to commit", askAt: 3,
    lines: [["cmd", "rename getUser to fetchUser"], ["out", "Updated 7 call sites"], ["out", "3 files changed"], ["ok", "Committed: rename getUser"], ["ok", "Working tree clean"]],
  },
];

const ORDER = [0, 1, 2, 3];

function useDemo(active: boolean, count: number) {
  const [phase, setPhase] = useState<Record<string, Phase>>({});
  const [epoch, setEpoch] = useState<Record<string, number>>({});
  const [denied, setDenied] = useState<Record<string, boolean>>({});
  const [approved, setApproved] = useState(0);
  const set = useCallback((id: string, p: Phase) => setPhase((s) => ({ ...s, [id]: p })), []);
  const approve = useCallback((id: string) => { setApproved((n) => n + 1); setDenied((d) => ({ ...d, [id]: false })); set(id, "run2"); }, [set]);
  const restart = useCallback((id: string) => {
    setEpoch((e) => ({ ...e, [id]: (e[id] ?? 0) + 1 }));
    setDenied((d) => ({ ...d, [id]: false }));
    set(id, "run1");
  }, [set]);
  const deny = useCallback((id: string) => {
    setDenied((d) => ({ ...d, [id]: true }));
    set(id, "done");
    setTimeout(() => restart(id), 4200);
  }, [set, restart]);
  const asking = SPECS.slice(0, count).filter((s) => phase[s.id] === "ask");
  // nobody watching? Approve for them after a while, so the demo never stalls.
  useEffect(() => {
    if (!active || !asking.length) return;
    const id = setTimeout(() => approve(asking[0]!.id), 15000);
    return () => clearTimeout(id);
  }, [active, asking.map((a) => a.id).join(), approve]); // eslint-disable-line react-hooks/exhaustive-deps
  return { count, phase, epoch, denied, approved, set, approve, deny, restart, asking };
}
type Demo = ReturnType<typeof useDemo>;

function LivePane({ spec, d, active, delay }: { spec: Spec; d: Demo; active: boolean; delay: number }) {
  const p = d.phase[spec.id] ?? "run1";
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setGo(true), delay);
    return () => clearTimeout(id);
  }, [active, delay]);
  const limit = p === "run1" || p === "ask" ? spec.askAt : spec.lines.length;
  const rows = useTypist(spec.lines, go && active && p !== "done", {
    limit,
    epoch: d.epoch[spec.id] ?? 0,
    onReach: (n) => {
      if (n === spec.askAt && (d.phase[spec.id] ?? "run1") === "run1") d.set(spec.id, "ask");
      else if (n === spec.lines.length) {
        d.set(spec.id, "done");
        setTimeout(() => d.restart(spec.id), 4200);
      }
    },
  });
  const shown = d.denied[spec.id] ? [...rows.slice(0, spec.askAt), { k: "del", t: "Denied. Agent continues without it.", cur: false }] : rows;
  const st = p === "ask" ? "ask" : p === "done" ? "done" : "run";
  return (
    <div className="s-pane">
      <div className="s-pane-h">
        <StatusDot s={st} />
        {spec.name}
        <span className="st">{p === "ask" ? "needs you" : p === "done" ? "done" : "working"}</span>
      </div>
      <Term rows={shown} />
      {p === "ask" && (
        <div className="s-ask" role="group" aria-label={`${spec.name} asks for permission`}>
          <span>{spec.ask}</span>
          <button type="button" className="s-btn" onClick={() => d.deny(spec.id)}>Deny</button>
          <button type="button" className="s-btn go" onClick={() => d.approve(spec.id)}>Approve</button>
        </div>
      )}
    </div>
  );
}

function DesktopView({ d, active }: { d: Demo; active: boolean }) {
  const n = d.asking.length;
  return (
    <div className="s-view">
      <div className="s-panes">
        {ORDER.slice(0, d.count).map((i) => <LivePane key={SPECS[i]!.id} spec={SPECS[i]!} d={d} active={active} delay={i * 2600} />)}
      </div>
      <div className="s-neural">
        <Orb talk={false} />
        <span style={{ flex: 1 }}>{n ? `Neural: ${n} agent${n > 1 ? "s are" : " is"} waiting for you.` : "Neural: all quiet. Everything is running."}</span>
        {n > 0 && <button type="button" className="s-btn" onClick={() => d.asking.forEach((a) => d.approve(a.id))}>Approve all</button>}
      </div>
    </div>
  );
}

const CALL: { who: "you" | "neural"; t: string }[] = [
  { who: "you", t: "Hey Neural, how are my agents doing?" },
  { who: "neural", t: "Four are running in billing-api. Two are waiting for your approval." },
  { who: "you", t: "Approve the migration and start a swarm for the tests." },
  { who: "neural", t: "Done. A swarm of three is on it. I will tell you when it finishes." },
];

function CallView({ active }: { active: boolean }) {
  const [live, setLive] = useState(true);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active || !live) return;
    if (reduced()) return setI(CALL.length - 1) as void;
    const id = setInterval(() => setI((v) => (v + 1) % (CALL.length + 1)), 3400);
    return () => clearInterval(id);
  }, [active, live]);
  const cur = live ? CALL[Math.min(i, CALL.length - 1)]! : null;
  const talking = live && i < CALL.length;
  const seen = CALL.slice(Math.max(0, Math.min(i, CALL.length - 1) - 1), Math.min(i, CALL.length - 1) + 1);
  return (
    <div className="s-view s-call">
      <Orb talk={talking && cur?.who === "neural"} />
      <Wave who={talking ? cur!.who : "idle"} on={talking} />
      <div className="s-trans" aria-live="polite">
        {live ? seen.map((l, n) => (
          <p key={l.t} className={`${l.who}${n < seen.length - 1 ? " old" : ""}`}><b>{l.who === "you" ? "You" : "Neural"}</b>{l.t}</p>
        )) : <p className="old"><b>Call</b>Call ended. Start it again to hear the demo.</p>}
      </div>
      <button type="button" className={`s-hang ${live ? "" : "call"}`} aria-label={live ? "Hang up" : "Call Neural"} onClick={() => { setLive((v) => !v); setI(0); }}>
        {live ? <PhoneOff size={22} /> : <Phone size={22} />}
      </button>
    </div>
  );
}

function PhoneView({ d }: { d: Demo }) {
  const a = d.asking[0];
  return (
    <div className="s-view s-phone-wrap">
      <div className="s-phone">
        {a && (
          <div className="s-notif" key={a.id}>
            <span className="eyebrow">NeuralAgent · now</span>
            <span>{a.note}: {a.ask}</span>
            <div className="acts">
              <button type="button" className="s-btn" onClick={() => d.deny(a.id)}>Deny</button>
              <button type="button" className="s-btn go" onClick={() => d.approve(a.id)}>Approve</button>
            </div>
          </div>
        )}
        <div className="s-phone-in">
          <h4 style={{ marginTop: a ? 112 : 0 }}>Agents</h4>
          {SPECS.slice(0, d.count).map((s) => {
            const p = d.phase[s.id] ?? "run1";
            return (
              <div className="s-row" key={s.id}>
                <StatusDot s={p === "ask" ? "ask" : p === "done" ? "done" : "run"} />
                <div className="tx"><div>{s.name}</div><small>{p === "ask" ? "Waiting for you" : p === "done" ? "Finished" : "Working"}</small></div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="s-dim" style={{ maxWidth: 320, textAlign: "center", fontSize: "var(--text-small)", margin: 0 }}>
        Same agents, same state. Approve on the phone and the pane on the desktop carries on.
      </p>
    </div>
  );
}

const VIEWS = [
  { id: "desk", label: "Desktop", Icon: Monitor, hint: "Agents ask for permission as they work. Click Approve, or let Neural handle it." },
  { id: "call", label: "Call Neural", Icon: Phone, hint: "A scripted call. The real Neural listens through your microphone." },
  { id: "phone", label: "Phone", Icon: Smartphone, hint: "Your phone shows the same state. Try approving from here." },
] as const;

export default function Demo() {
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("desk");
  const [ref, vis] = useVisible<HTMLDivElement>();
  const narrow = useMedia("(max-width: 700px)");
  const d = useDemo(vis, narrow ? 2 : 4);
  const seg = useRef<HTMLDivElement>(null);
  const v = VIEWS.find((x) => x.id === view)!;
  return (
    <div ref={ref}>
      <div className="s-demo-top">
        <div className="s-seg" role="tablist" aria-label="Demo view" ref={seg}>
          {VIEWS.map((x) => (
            <button key={x.id} role="tab" type="button" aria-selected={view === x.id} onClick={() => setView(x.id)}>
              <x.Icon size={16} />{x.label}
            </button>
          ))}
        </div>
      </div>
      <div className="s-demo-frame">
        <Win tabs={["billing-api", "web-shop", "Neural"]} side={SIDE}>
          <div className="s-demo-body">
            {view === "desk" && <DesktopView d={d} active={vis} />}
            {view === "call" && <CallView active={vis} />}
            {view === "phone" && <PhoneView d={d} />}
          </div>
        </Win>
      </div>
      <p className="s-demo-hint">{v.hint}</p>
    </div>
  );
}
