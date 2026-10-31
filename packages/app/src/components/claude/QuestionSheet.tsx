/**
 * AskUserQuestion, answered natively: one tab per question (header chips), the options with
 * their descriptions, checkboxes for multi-select, and "Other" with a text field. The card
 * mirrors the CLI's dialog: every tap answers on the screen, the daemon sends the next state.
 * The CLI's last step ("Review your answers" / Submit) shows as a confirm card.
 */
import { cn, toast } from "@neuralagent/ui";
import { Check, ChevronRight, Pencil } from "lucide-react";
import { useState } from "react";
import { useClient } from "../../lib/store";
import { runKeys } from "./actions";
import { AnswerField, Btn, DockCard } from "./DockCard";
import type { CardProps } from "./PromptCard";
import { currentQuestion, NEXT_TAB, questionsOf, screenOptions, tabKeys } from "./promptState";

export function QuestionCard({ sid, prompt, pending, phone, onTerminal, answer, dismiss }: CardProps) {
  const client = useClient();
  const qs = questionsOf(pending, prompt);
  const tab = currentQuestion(qs, prompt);
  const q = qs[tab];
  const opts = screenOptions(prompt);
  const [other, setOther] = useState(false);
  const desc = (label: string) => q?.options.find((o) => o.label.toLowerCase() === label.toLowerCase())?.description;
  const multi = q?.multiSelect ?? opts.some((o) => o.checked !== undefined);
  const last = tab >= qs.length - 1;
  const title = q?.question || prompt.title.split("\n").find((l) => /\?\s*$/.test(l.trim()))?.trim() || "Claude has a question";

  return (
    <DockCard
      label="Claude's question"
      eyebrow={qs.length > 1 ? `Question ${tab + 1} of ${qs.length}` : "Claude asks"}
      head={
        <>
          <span className="font-cv-strong">{title}</span>
          {multi && <span className="block text-cv-meta text-cv-muted">Choose all that apply</span>}
        </>
      }
      phone={phone}
      onTerminal={onTerminal}
      onDismiss={dismiss}
      footer={
        multi ? (
          <div className={cn("flex gap-2", !phone && "justify-end")}>
            <Btn kind="primary" phone={phone} className={cn(phone && "w-full")} onClick={() => client.write(sid, NEXT_TAB)}>
              {last ? "Review answers" : "Next question"}
              <ChevronRight size={16} className="ml-1" />
            </Btn>
          </div>
        ) : undefined
      }
    >
      {qs.length > 1 && (
        <div className="cv-noscrollbar flex gap-1.5 overflow-x-auto px-4 pb-2" role="tablist" aria-label="Questions">
          {qs.map((x, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === tab}
              onClick={() => i !== tab && void runKeys(client, sid, tabKeys(tab, i)).catch((e: Error) => toast(e.message, { tone: "danger" }))}
              className={cn("h-11 shrink-0 rounded-full px-3.5 text-cv-meta transition-colors", i === tab ? "bg-cv-primary text-cv-on-primary" : "bg-cv-chip text-cv-text-2 hover:bg-cv-press")}
            >
              {x.header || `Question ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <div className="px-2 pb-2" role={multi ? "group" : "radiogroup"} aria-label={title}>
        {opts.map((o, i) => {
          const d = o.description ?? desc(o.label);
          const raw = prompt.options[i]!;
          if (o.free)
            return (
              <div key={o.n || i} className={cn(i > 0 && "border-t border-cv-line-soft")}>
                {other ? (
                  <div className="px-1 py-2">
                    <AnswerField placeholder="Your answer" label="Other answer" autoFocus onSend={(t) => (setOther(false), void answer(raw, t))} />
                  </div>
                ) : (
                  <button type="button" onClick={() => setOther(true)} className="flex min-h-12 w-full items-center gap-3 rounded-cv-sm px-2.5 py-2 text-left text-cv-ui text-cv-text-2 transition-colors hover:bg-cv-hover">
                    <Pencil size={16} strokeWidth={1.8} className="shrink-0 text-cv-muted" />
                    Other…
                  </button>
                )}
              </div>
            );
          return (
            <button
              key={o.n || i}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={multi ? !!o.checked : o.selected}
              onClick={() => void answer(raw)}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 rounded-cv-sm px-2.5 py-2 text-left text-cv-ui transition-colors hover:bg-cv-hover active:bg-cv-press [[data-mode=phone]_&]:min-h-13",
                i > 0 && "border-t border-cv-line-soft",
              )}
            >
              {multi ? (
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-cv-xs border", o.checked ? "border-cv-primary bg-cv-primary text-cv-on-primary" : "border-cv-line-strong")}>{o.checked && <Check size={13} strokeWidth={2.6} />}</span>
              ) : (
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-full font-cv-mono text-cv-meta", o.selected ? "bg-cv-primary text-cv-on-primary" : "bg-cv-chip text-cv-text-2")}>{o.n || "·"}</span>
              )}
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="block text-cv-text">{o.label}</span>
                {d && <span className="block text-cv-meta text-cv-muted">{d}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </DockCard>
  );
}
