// Autopilot → Chat: the conversation with the pilot. Right after creation it is the setup
// interview. Tool steps are folded under each answer; a proposed playbook shows as a card.
import type { Pilot, PilotMessage } from "@neuralagent/protocol";
import { AssistantMessage, Button, Callout, Composer, Disclosure, StreamingText, ThinkingIndicator, UserBubble, ComposerDock } from "@neuralagent/ui";
import { BellRing, ChevronRight, Wrench } from "lucide-react";
import { useMemo } from "react";
import { byDay, clock, useNow } from "../../lib/agentui";
import { pilotMessages, playbookEmpty } from "../../lib/autopilot";
import { useApDo, useAutopilot, usePilotUi } from "./hooks";
import { SuggestionCard } from "./SuggestionCard";

export function Chat({ pilot }: { pilot: Pilot }) {
  const state = useAutopilot();
  const setTab = usePilotUi((s) => s.setTab);
  const messages = useMemo(() => pilotMessages(state.messages, pilot.id), [state.messages, pilot.id]);
  const suggestions = state.suggestions.filter((s) => s.pilot_id === pilot.id);
  const now = useNow();
  const last = messages.at(-1);
  const working = pilot.status === "working";
  const waitingForWords = working && (!last || last.role === "user");
  const days = useMemo(() => byDay(messages, (m) => m.at, now), [messages, now]);
  const setup = !pilot.setup_done && playbookEmpty(pilot.playbook);

  return (
    <div className="flex flex-col gap-4 pb-28">
      {pilot.status === "error" && (
        <Callout tone="danger" title="The autopilot could not answer">
          {pilot.activity || "Something went wrong."}
        </Callout>
      )}
      {setup && (
        <div className="surface flex flex-col gap-2 rounded-list p-4">
          <div className="text-headline text-bright">Let’s set up your autopilot</div>
          <p className="text-subhead text-dim">It asks a few short questions about your project and how you want it to help. Prefer to write it yourself? You can fill in the instructions directly.</p>
          <div>
            <Button size="sm" variant="ghost" IconEnd={ChevronRight} onClick={() => setTab("instructions")} className="rounded-full">
              Skip, I’ll fill it in
            </Button>
          </div>
        </div>
      )}
      {messages.length === 0 && !setup && (
        <p className="px-1 pt-2 text-subhead text-dim">Tell the autopilot what to do, for example “look at all new Discord messages now” or “what is open in the inbox?”.</p>
      )}
      {days.map((d) => (
        <section key={d.label} className="flex flex-col gap-4">
          <h2 className="pt-2 text-center text-footnote text-dim">{d.label}</h2>
          {d.items.map((m) => (
            <Line key={m.id} m={m} live={working && m === last} />
          ))}
        </section>
      ))}
      {suggestions.map((s) => (
        <SuggestionCard key={s.id} suggestion={s} />
      ))}
      {waitingForWords && <ThinkingIndicator variant="dots" label="The autopilot is thinking" />}
    </div>
  );
}

/** The composer floats over the bottom of the page (the page scrolls under it). */
export function ChatComposer({ pilot }: { pilot: Pilot }) {
  const run = useApDo();
  const setup = !pilot.setup_done && playbookEmpty(pilot.playbook);
  return (
    <ComposerDock className="z-20" >
      <div style={{ paddingLeft: "var(--sidebar-space, 0px)" }}>
        <Composer
          onSend={(t) => {
            if (!t.trim()) return false;
            void run({ op: "pilot_send", id: pilot.id, text: t });
          }}
          placeholder={setup ? "Answer here…" : "Ask the autopilot…"}
          busy={pilot.status === "working"}
          onStop={() => void run({ op: "pilot_stop", id: pilot.id })}
          attachments={false}
          dictation={false}
          compact
        />
      </div>
    </ComposerDock>
  );
}

function Line({ m, live }: { m: PilotMessage; live: boolean }) {
  if (m.role === "user") return <UserBubble animate={false} time={clock(m.at)}>{m.text}</UserBubble>;
  if (!m.text && m.steps.length === 0) return null;
  return (
    <AssistantMessage
      header={
        m.proactive ? (
          <div className="mb-1.5 flex items-center gap-1.5 text-footnote text-accent">
            <BellRing className="size-icon-sm shrink-0" strokeWidth={2} />
            <span>On its own</span>
            <span className="text-dim tabular">· {clock(m.at)}</span>
          </div>
        ) : undefined
      }
      className={m.proactive ? "border-l-2 border-accent pl-3" : undefined}
      footer={
        m.steps.length > 0 ? (
          <div className="surface overflow-hidden rounded-list">
            <Disclosure Icon={Wrench} title={`${m.steps.length} ${m.steps.length === 1 ? "step" : "steps"}`} detail="What it looked at and did">
              <ul className="flex flex-col gap-1.5 text-footnote text-dim">
                {m.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Disclosure>
          </div>
        ) : undefined
      }
    >
      {m.text && <StreamingText text={m.text} live={live} />}
    </AssistantMessage>
  );
}
