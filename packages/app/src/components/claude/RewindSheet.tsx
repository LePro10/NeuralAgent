/**
 * "Rewind to here": go back to before one of the user's messages, with the code, the
 * conversation or both (Claude Code's `/rewind`). The transcript's long-press menu calls
 * `requestRewind(sid, id, messages)` (actions.ts); this sheet, mounted by the composer of that
 * session, asks what to restore and plays it. The CLI's restore menu that follows is answered
 * by the prompt dock (`takeRewind`); when it does not match, the menu shows as a normal card.
 */
import { Sheet } from "@neuralagent/ui";
import { FileCode2, History, MessagesSquare, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { act, armRewind, interrupt, type Keys, REWIND_CHOICES, type RewindRequest, type RewindWhat, rewindSteps } from "./actions";
import type { Step } from "./promptState";

const ICONS: Record<RewindWhat, typeof History> = { both: History, conversation: MessagesSquare, code: FileCode2, summarize: ScrollText };

export function RewindSheet({ sid, keys, live, busy, onError }: { sid: string; keys: Keys; live: boolean; busy: boolean; onError: (m: string) => void }) {
  const [req, setReq] = useState<RewindRequest | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<RewindRequest>).detail;
      if (d?.sid === sid) setReq(d);
    };
    window.addEventListener("na-cv-rewind", on);
    return () => window.removeEventListener("na-cv-rewind", on);
  }, [sid]);

  const run = (what: RewindWhat) => {
    const r = req;
    setReq(null);
    if (!r) return;
    const steps: Step[] = [...(busy ? [{ wait: 350 } as Step] : []), ...rewindSteps(r.distance)];
    if (busy && !live) interrupt(keys, sid);
    if (!live) armRewind(sid, what);
    act(keys, sid, live, { k: "rewind", message_id: r.messageId, what }, steps).catch((e: Error) => onError(e.message));
  };

  // No checkpoint: the CLI can only go back in the conversation.
  const choices = REWIND_CHOICES.filter((c) => req?.checkpoint !== false || c.what === "conversation" || c.what === "summarize");
  return (
    <Sheet open={req !== null} onClose={() => setReq(null)} title="Rewind to here" size="sm" bodyClassName="pb-4">
      <div className="cv-sheet -mx-1 font-cv-sans">
        <p className="px-4 pb-2 text-cv-meta text-cv-muted">
          {busy ? "Claude stops first. " : ""}Go back to just before this message. What to restore?
        </p>
        {choices.map((c) => {
          const Icon = ICONS[c.what];
          return (
            <button key={c.what} type="button" onClick={() => run(c.what)} className="flex min-h-14 w-full items-center gap-3 rounded-cv-md px-4 py-2 text-left transition-colors hover:bg-cv-hover active:bg-cv-press">
              <Icon size={19} strokeWidth={1.7} className="shrink-0 text-cv-text-2" />
              <span className="min-w-0 flex-1">
                <span className="block text-cv-ui text-cv-text">{c.label}</span>
                <span className="block text-cv-meta text-cv-muted">{c.hint}</span>
              </span>
            </button>
          );
        })}
        {req?.checkpoint === false && <p className="px-4 pt-1 text-cv-meta text-cv-muted">No file checkpoint for this message, so code can't be restored.</p>}
      </div>
    </Sheet>
  );
}
