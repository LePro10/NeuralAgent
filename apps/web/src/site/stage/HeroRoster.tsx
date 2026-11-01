// The hero's quiet status block (BRIEF 2.5b, replacing the canvas field): three real agents of the demo world as pane
// titles with their activity marks. It starts with the seeded states and follows the shared world once that is up, so
// the hero is a small live preview of the window below it. Only text and marks, no placeholder bars.
import { useEffect, useState } from "react";
import { ActivityMark, type ActivityKind } from "../ui";
import { statusKind } from "./signals";
import { hostWorld, saveData, whenIdle } from "./world";

interface Row {
  /** Handle in the world: `agent.<engine>-<workspace>`. */
  handle: string;
  engine: string;
  project: string;
  kind: ActivityKind;
}

const WORDS: Record<ActivityKind, string> = { working: "working", waiting: "needs you", done: "finished", error: "failed", idle: "idle" };

const START: Row[] = [
  { handle: "agent.claude-billing", engine: "claude", project: "billing-api", kind: "working" },
  { handle: "agent.codex-billing", engine: "codex", project: "billing-api", kind: "working" },
  { handle: "agent.opencode-billing", engine: "opencode", project: "billing-api", kind: "working" },
];

export function HeroRoster() {
  const [rows, setRows] = useState(START);

  useEffect(() => {
    if (saveData()) return; // data saver: the seeded states stay, the world is not pulled for a decoration
    let off: (() => void) | undefined;
    let alive = true;
    const cancel = whenIdle(() => {
      void hostWorld().then((w) => {
        if (!alive || !w) return;
        const ids = new Map(START.map((r) => [w.handles[r.handle], r.handle]));
        off = w.on((s) => {
          if (s.type !== "agent-status") return;
          const handle = ids.get(s.agent);
          if (!handle) return;
          const kind = statusKind(s.status);
          setRows((prev) => prev.map((r) => (r.handle === handle && r.kind !== kind ? { ...r, kind } : r)));
        });
      });
    }, 2600);
    return () => {
      alive = false;
      cancel();
      off?.();
    };
  }, []);

  return (
    <ul className="hr t-label" aria-label="Agents in the demo, right now">
      {rows.map((r) => (
        <li key={r.handle} className="hr__row">
          <ActivityMark kind={r.kind} />
          <span className="hr__who">{r.engine}</span>
          <span className="hr__in">{r.project}</span>
          <span className="hr__st" data-kind={r.kind}>{WORDS[r.kind]}</span>
        </li>
      ))}
    </ul>
  );
}
