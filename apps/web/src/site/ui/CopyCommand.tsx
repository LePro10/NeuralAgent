import { useRef } from "react";
import { Check, Copy } from "lucide-react";
import { useCopy, useMoreToRight } from "./hooks";
import { Icon } from "./Icon";

/**
 * A shell command with a copy button: `$ curl … | sh`. The text is selectable, the button announces "Copied".
 * Long commands scroll sideways inside the box (the page never does); the right edge fades while there is more to see.
 */
export function CopyCommand({ command, prompt = "$", label = "Copy command", className }: { command: string; prompt?: string; label?: string; className?: string }) {
  const [copy, done] = useCopy(command);
  const code = useRef<HTMLElement>(null);
  const more = useMoreToRight(code, command);
  return (
    <div className={`na-cmd${className ? ` ${className}` : ""}`}>
      <span className="na-cmd__prompt" aria-hidden>{prompt}</span>
      {/* Focusable so the keyboard can scroll a long command; no aria-label, it would hide the command text from screen readers. */}
      <code ref={code} className="na-cmd__code" tabIndex={0} data-more={more ? "" : undefined}>{command}</code>
      <button type="button" className="na-cmd__copy" onClick={copy} data-done={done ? "" : undefined} aria-label={done ? "Copied" : label} title={done ? "Copied" : label}>
        <Icon as={done ? Check : Copy} size={16} />
        <span className="na-sr" role="status">{done ? "Copied to clipboard" : ""}</span>
      </button>
    </div>
  );
}
