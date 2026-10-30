/**
 * The terminal's text as plain, selectable text: phones cannot select in xterm's canvas, so this
 * sheet shows scrollback + screen (a snapshot, colours stripped, wrapped rows joined) where the
 * system's long-press selection works, with "Copy all" and "Copy screen".
 */
import { Button, SNAPS, Sheet } from "@neuralagent/ui";
import { Copy, Monitor } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { copyWithToast } from "../lib/clipboard";
import { usePlatform } from "../lib/store";
import type { TerminalText } from "../lib/termtext";

const EVENT = "na-terminal-text";

/** Opens the text sheet of the terminal showing `sid` (KeyBar, menus). */
export const showTerminalText = (sid: string) => window.dispatchEvent(new CustomEvent(EVENT, { detail: sid }));

/** Calls `open` when someone asks for the text of `sid`. */
export function onShowTerminalText(sid: string, open: () => void): () => void {
  const on = (e: Event) => (e as CustomEvent<string>).detail === sid && open();
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}

export function TerminalTextSheet({ open, text, onClose }: { open: boolean; text: TerminalText | null; onClose: () => void }) {
  const platform = usePlatform();
  const pre = useRef<HTMLPreElement>(null);

  // Newest output first in view: scroll the sheet's scroller to the end once the text is in.
  useLayoutEffect(() => {
    if (!open || !text) return;
    const toEnd = () => {
      const sc = pre.current?.closest<HTMLElement>(".scroller");
      if (sc) sc.scrollTop = sc.scrollHeight;
    };
    toEnd();
    const f = requestAnimationFrame(toEnd);
    return () => cancelAnimationFrame(f);
  }, [open, text]);

  const copy = (s: string) => void copyWithToast(s, platform);
  const footer = (
    <div className="flex gap-2">
      <Button variant="ghost" size="md" Icon={Monitor} className="flex-1" onClick={() => copy(text?.screen ?? "")}>
        Copy screen
      </Button>
      <Button variant="primary" size="md" Icon={Copy} className="flex-1" onClick={() => copy(text?.all ?? "")}>
        Copy all
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Terminal text" snaps={SNAPS.full} size="lg" footer={footer}>
      {text?.truncated && <p className="pb-2 text-meta text-faint">Showing the last {text.lines.toLocaleString()} lines.</p>}
      {text && !text.all && <p className="py-6 text-center text-small text-faint">No output yet.</p>}
      <pre
        ref={pre}
        className="selectable font-mono text-detail break-words whitespace-pre-wrap text-ink select-text"
      >
        {text?.all}
      </pre>
    </Sheet>
  );
}
