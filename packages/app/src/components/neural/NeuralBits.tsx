// Pieces of the Neural conversation that are not plain chat: what Neural said on its own,
// actions waiting for your OK, and the "while you were away" card (D63).
import type { NeuralPending } from "@neuralagent/protocol";
import { Button, ConfirmCard, cn } from "@neuralagent/ui";
import { BellRing, Sparkles } from "lucide-react";
import { useState } from "react";
import { awayLine, neuralOf, type Away } from "../../lib/neural";
import { clock } from "../../lib/agentui";
import { useClient, useDaemon } from "../../lib/store";
import { neuralReq } from "./NeuralPanel";

/** The line above a message Neural wrote on its own: it reads as a report, not an answer. */
export function ProactiveHeader({ at }: { at: number }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-footnote text-accent">
      <BellRing className="size-icon-sm shrink-0" strokeWidth={2} />
      <span>On its own</span>
      <span className="text-dim tabular">· {clock(at)}</span>
    </div>
  );
}

/** Actions Neural wants to take that need your OK (newest last), each with Allow / Deny. */
export function PendingCards() {
  const pending = useDaemon((c) => neuralOf(c.state).pending);
  if (pending.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {pending.map((p) => (
        <PendingCard key={p.id} p={p} />
      ))}
    </div>
  );
}

function PendingCard({ p }: { p: NeuralPending }) {
  const client = useClient();
  const [decision, setDecision] = useState<"approved" | "denied" | null>(null);
  return (
    <ConfirmCard
      title={p.title}
      detail="Neural asks before it does this."
      decision={decision}
      danger
      onDecide={(d) => {
        setDecision(d);
        void neuralReq(client, { m: "neural_confirm", p: { id: p.id, allow: d === "approved" } });
      }}
    >
      <span className="block font-mono whitespace-pre-wrap break-words">{p.detail}</span>
    </ConfirmCard>
  );
}

/** After a break: what happened, from the state alone; "Catch me up" asks Neural for the story. */
export function AwayCard({ away, busy, onCatchUp, className }: { away: Away; busy: boolean; onCatchUp: () => void; className?: string }) {
  return (
    <div className={cn("surface flex items-center gap-3 rounded-list px-4 py-3", className)}>
      <Sparkles className="size-icon shrink-0 text-accent" strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <div className="text-headline text-bright">While you were away</div>
        <div className="truncate text-footnote text-dim">{awayLine(away)}</div>
      </div>
      <Button size="sm" variant="accent" onClick={onCatchUp} className="shrink-0 rounded-full" disabled={busy}>
        Catch me up
      </Button>
    </div>
  );
}
