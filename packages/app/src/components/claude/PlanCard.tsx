/**
 * Plan approval (ExitPlanMode): the plan as markdown, the CLI's approve choices in its own
 * words ("Yes, and auto-accept edits", "Yes, and manually approve edits"…), and "Keep
 * planning" with feedback for Claude.
 */
import { cn, Sheet, toast } from "@neuralagent/ui";
import { BookOpenText } from "lucide-react";
import { useState } from "react";
import { useClient } from "../../lib/store";
import { runKeys, serverActions } from "./actions";
import { AnswerField, Btn, DockCard } from "./DockCard";
import { Markdown } from "./Markdown";
import type { CardProps } from "./PromptCard";
import { planChoices, planFeedbackKeys, planText, screenOptions } from "./promptState";

export function PlanCard({ sid, prompt, pending, phone, meta, onTerminal, answer, dismiss }: CardProps) {
  const client = useClient();
  const [feedback, setFeedback] = useState(false);
  const [reading, setReading] = useState(false);
  const plan = planText(prompt, pending);
  const choices = planChoices(prompt);
  const yes = choices.filter((c) => !c.reject);
  const no = choices.find((c) => c.reject);
  const opt = (n: string) => prompt.options.find((o) => o.n === n) ?? { n };
  const free = screenOptions(prompt).find((o) => o.free);

  const sendFeedback = (text: string) => {
    if (serverActions(meta) && (free ?? no)) return void answer(opt((free ?? no)!.n), text);
    const steps = planFeedbackKeys(prompt, text);
    if (steps) void runKeys(client, sid, steps).catch((e: Error) => toast(e.message, { tone: "danger" }));
  };

  return (
    <DockCard
      label="Plan approval"
      eyebrow="Claude's plan"
      head={<span className="font-cv-strong">Ready to start?</span>}
      phone={phone}
      onTerminal={onTerminal}
      onDismiss={dismiss}
      footer={
        <>
          {feedback && (
            <div className="mb-2">
              <AnswerField placeholder="What should Claude change?" label="Tell Claude what to change" autoFocus onSend={sendFeedback} />
            </div>
          )}
          <div className={phone ? "grid grid-cols-2 gap-2" : "flex flex-wrap items-center justify-end gap-2"}>
            {!feedback && (free || no) && (
              <Btn kind={phone ? "secondary" : "ghost"} phone={phone} className={cn(phone && !no && "col-span-2")} onClick={() => setFeedback(true)}>
                {phone ? "Change it…" : "Tell Claude what to change"}
              </Btn>
            )}
            {no && (
              <Btn kind="secondary" phone={phone} className={cn(phone && (feedback || !(free || no)) && "col-span-2")} onClick={() => void answer(opt(no.n))}>
                Keep planning
              </Btn>
            )}
            {yes
              .slice()
              .reverse()
              .map((c) => (
                <Btn key={c.n} kind={c.primary ? "primary" : "secondary"} phone={phone} className={cn(phone && "col-span-2", phone && c.primary && "order-last")} onClick={() => void answer(opt(c.n))}>
                  {c.label}
                </Btn>
              ))}
          </div>
        </>
      }
    >
      <div className="px-4 pb-3">
        {plan && phone ? (
          <button type="button" onClick={() => setReading(true)} className="flex min-h-12 w-full items-center gap-3 rounded-cv-md border border-cv-line-soft bg-cv-sunken px-3.5 py-2 text-left">
            <BookOpenText size={18} strokeWidth={1.7} className="shrink-0 text-cv-text-2" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-cv-ui text-cv-text">{plan.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") || "The plan"}</span>
              <span className="block text-cv-meta text-cv-muted">Read the whole plan</span>
            </span>
          </button>
        ) : plan ? (
          <div className="rounded-cv-md border border-cv-line-soft bg-cv-sunken px-3.5 py-2">
            <Markdown text={plan} compact />
          </div>
        ) : (
          <p className="text-cv-meta whitespace-pre-wrap text-cv-muted">{prompt.title}</p>
        )}
      </div>
      <Sheet open={reading} onClose={() => setReading(false)} title="Claude's plan" snaps={[0.94]} bodyClassName="pb-6">
        <div className="cv-sheet px-2 font-cv-sans">
          <Markdown text={plan} />
        </div>
      </Sheet>
    </DockCard>
  );
}
