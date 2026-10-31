/**
 * How full the context is and what the session cost so far. The ring sits in the composer;
 * the sheet shows the numbers Claude Code's statusline reports (real window size, cost,
 * time, lines changed) and the commands that free context. Older daemons only know the
 * token count: the window is guessed from the model and the sheet says so.
 */
import type { CvMeta } from "@neuralagent/protocol";
import { cn, Sheet } from "@neuralagent/ui";
import { ChevronRight, Eraser, Gauge, Minimize2, Receipt } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { contextOf, type MetaX, money, shortTokens, span } from "./metaInfo";
import { modelName } from "./models";

/** A small progress ring: muted until 70%, warning from 70%, danger from 90%. */
export function ContextRing({ pct, size = 18 }: { pct: number; size?: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const tone = pct >= 90 ? "text-cv-danger" : pct >= 70 ? "text-cv-warning" : "text-cv-muted";
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className={cn("-rotate-90", tone)}>
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.2" />
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray={`${(c * Math.max(2, pct)) / 100} ${c}`} />
    </svg>
  );
}

export function ContextSheet({ open, onClose, meta, onCommand }: { open: boolean; onClose: () => void; meta: CvMeta; onCommand: (line: string, terminal: boolean) => void }) {
  const m = meta as MetaX;
  const ctx = contextOf(meta);
  const [clearArmed, setClearArmed] = useState(false);
  useEffect(() => {
    if (!open) setClearArmed(false);
  }, [open]);
  const cost = money(m.cost_usd);
  const time = span(m.duration_ms);
  const api = span(m.api_duration_ms);
  const lines = m.lines_added || m.lines_removed ? `+${m.lines_added ?? 0} −${m.lines_removed ?? 0}` : null;

  return (
    <Sheet open={open} onClose={onClose} title="Context and usage" size="sm" bodyClassName="pb-4">
      <div className="cv-sheet -mx-1 font-cv-sans">
        <div className="mx-3 mb-3 flex items-center gap-4 rounded-cv-card bg-cv-chip px-4 py-4">
          <ContextRing pct={ctx?.pct ?? 0} size={52} />
          <div className="min-w-0 flex-1">
            <div className="text-cv-h2 text-cv-text">{ctx ? `${ctx.pct}% used` : "Nothing used yet"}</div>
            <div className="text-cv-meta text-cv-muted">
              {ctx ? `${shortTokens(ctx.tokens)} of ${shortTokens(ctx.window)} tokens${ctx.exact ? "" : " (window guessed from the model)"}` : "The context fills as you talk."}
            </div>
          </div>
        </div>
        {ctx && ctx.pct >= 70 && (
          <p className="mx-4 mb-3 text-cv-meta text-cv-text-2">
            {ctx.pct >= 90 ? "Almost full. Claude compacts on its own soon; compacting now keeps what matters." : "Getting full. Compact to keep a summary and free the rest."}
          </p>
        )}

        <dl className="mx-3 mb-2 grid grid-cols-2 gap-2">
          <Stat label="Model" value={modelName(meta.model)} />
          {cost && <Stat label="Cost so far" value={cost} hint="What this would cost on the API" />}
          {time && <Stat label="Session time" value={time} />}
          {api && <Stat label="Claude working" value={api} />}
          {lines && <Stat label="Lines changed" value={lines} />}
          {m.version && <Stat label="Claude Code" value={m.version} />}
        </dl>

        <Row icon={<Minimize2 size={19} strokeWidth={1.7} />} label="Compact" hint="Summarize the conversation and free the context" onClick={() => onCommand("/compact", false)} />
        <Row
          icon={<Eraser size={19} strokeWidth={1.7} />}
          label={clearArmed ? "Tap again to start fresh" : "Start fresh"}
          hint="Clear the conversation (/clear). Files stay as they are."
          danger={clearArmed}
          onClick={() => (clearArmed ? onCommand("/clear", false) : setClearArmed(true))}
        />
        <Row icon={<Gauge size={19} strokeWidth={1.7} />} label="Full breakdown" hint="What fills the context (/context)" trailing onClick={() => onCommand("/context", true)} />
        <Row icon={<Receipt size={19} strokeWidth={1.7} />} label="Plan limits" hint="How much of your limits is left (/usage)" trailing onClick={() => onCommand("/usage", true)} />
      </div>
    </Sheet>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-cv-md border border-cv-line-soft px-3 py-2" title={hint}>
      <dt className="text-cv-meta text-cv-muted">{label}</dt>
      <dd className="truncate font-cv-mono text-cv-ui text-cv-text">{value}</dd>
    </div>
  );
}

function Row({ icon, label, hint, danger, trailing, onClick }: { icon: ReactNode; label: string; hint: string; danger?: boolean; trailing?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 rounded-cv-md px-4 py-2 text-left transition-colors hover:bg-cv-hover active:bg-cv-press">
      <span className={cn("shrink-0", danger ? "text-cv-danger" : "text-cv-text-2")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-cv-ui", danger ? "text-cv-danger" : "text-cv-text")}>{label}</span>
        <span className="block text-cv-meta text-cv-muted">{hint}</span>
      </span>
      {trailing && <ChevronRight size={17} className="shrink-0 text-cv-muted" />}
    </button>
  );
}
