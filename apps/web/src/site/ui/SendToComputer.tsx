import { useEffect, useRef, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { SITE } from "../content";
import { Button } from "./Button";

/** The canonical download address (with the slash: the bare form costs the receiving computer a redirect). */
const URL_TO_SEND = `${SITE}/download/`;

/**
 * "Send to my computer" for phone visitors (they cannot install the desktop app): opens the share sheet with the
 * download URL (`navigator.share`), falls back to copying the link. "Link copied" is announced to screen readers; when even
 * copying is blocked, a read-only field with the link appears (selected, so a long press copies it).
 * The wrapper is `display: contents`, so the button stays a direct child of whatever row or grid it is placed in.
 */
export function SendToComputer({ variant = "secondary", size = "lg", className }: { variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" | "lg"; className?: string }) {
  const [done, setDone] = useState(false);
  const [manual, setManual] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => setDone(false), 2600);
      return () => clearTimeout(t);
    }
  }, [done]);
  useEffect(() => {
    if (manual) field.current?.select();
  }, [manual]);
  const send = async () => {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "NeuralAgent", text: "NeuralAgent: coding agents side by side on your own computer.", url: URL_TO_SEND });
        return;
      }
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return; // the visitor closed the sheet
    }
    try {
      await navigator.clipboard.writeText(URL_TO_SEND);
      setManual(false);
      setDone(true);
    } catch {
      setManual(true);
    }
  };
  return (
    <span className="na-send">
      <Button variant={variant} size={size} icon={done ? Check : Share2} onClick={send} className={className}>
        {done ? "Link copied" : "Send to my computer"}
      </Button>
      <span className="na-sr" role="status">{done ? "Link copied to the clipboard" : ""}</span>
      {manual && (
        <input ref={field} className="na-send__field" readOnly value={URL_TO_SEND} aria-label="Link to open on your computer" onFocus={(e) => e.currentTarget.select()} />
      )}
    </span>
  );
}
