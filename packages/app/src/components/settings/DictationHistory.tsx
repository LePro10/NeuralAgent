import { Button, ConfirmSheet, Disclosure, toast } from "@neuralagent/ui";
import { Copy, History, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { copyWithToast } from "../../lib/clipboard";
import { dictationTime, wordCount } from "../../lib/dictations";
import { usePlatform } from "../../lib/store";
import type { Dictation, VoiceApi, VoiceStatus } from "../../lib/voice";

/**
 * The last dictations of the host (D85): a text is never lost when the app it was typed into
 * drops it. Collapsed by default; copy, delete one, or clear all. Hidden on hosts that do not
 * keep a history yet.
 */
export function DictationHistory({ api, status }: { api: VoiceApi; status: VoiceStatus }) {
  const platform = usePlatform();
  const [list, setList] = useState<Dictation[] | null>(null);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const idle = status.activity === "idle";
  const latest = status.last_text;

  useEffect(() => {
    if (!api.history || !idle) return;
    let live = true;
    api.history().then(
      (l) => live && setList(l),
      () => live && setList(null),
    );
    return () => {
      live = false;
    };
  }, [api, idle, latest, open]);

  if (!api.history || !list) return null;
  const remove = async (id: string) => {
    try {
      await api.deleteDictation?.(id);
      setList((l) => l?.filter((d) => d.id !== id) ?? l);
    } catch (e) {
      toast(`Could not delete: ${String(e)}`, { tone: "danger" });
    }
  };
  const clear = async () => {
    try {
      await api.clearHistory?.();
      setList([]);
    } catch (e) {
      toast(`Could not clear: ${String(e)}`, { tone: "danger" });
    }
  };

  return (
    <>
      <Disclosure Icon={History} title="Recent dictations" value={list.length ? String(list.length) : undefined} open={open} onOpenChange={setOpen}>
        {list.length === 0 ? (
          <p className="py-1 text-subhead text-dim">Nothing yet. Your last 50 dictations are kept here, only on this computer.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((d) => (
              <DictationItem key={d.id} d={d} onCopy={() => void copyWithToast(d.text, platform)} onDelete={() => void remove(d.id)} />
            ))}
            <div className="flex justify-end pt-1">
              <Button size="sm" variant="quiet" Icon={Trash2} onClick={() => setAsking(true)}>
                Clear all
              </Button>
            </div>
          </div>
        )}
      </Disclosure>
      <ConfirmSheet
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={() => void clear()}
        title="Clear all dictations?"
        message="They are deleted from this computer and cannot be brought back."
        confirmLabel="Clear all"
        destructive
        Icon={Trash2}
      />
    </>
  );
}

function DictationItem({ d, onCopy, onDelete }: { d: Dictation; onCopy: () => void; onDelete: () => void }) {
  const [full, setFull] = useState(false);
  const long = d.text.length > 240;
  const words = wordCount(d.text);
  return (
    <div className="rounded-xl bg-fill-1 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-footnote text-dim tabular">
          {dictationTime(d.at)} · {words} {words === 1 ? "word" : "words"}
        </span>
        <Button size="sm" variant="quiet" Icon={Copy} aria-label="Copy dictation" onClick={onCopy} />
        <Button size="sm" variant="quiet" Icon={Trash2} aria-label="Delete dictation" onClick={onDelete} />
      </div>
      <p className={`mt-1 text-subhead whitespace-pre-wrap text-ink select-text ${full ? "" : "line-clamp-4"}`}>{d.text}</p>
      {long && (
        <button type="button" onClick={() => setFull(!full)} className="mt-1 text-footnote text-accent">
          {full ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}
