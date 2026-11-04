// Autopilot → Chat: the conversation with the pilot. Right after creation it is the setup
// interview. Tool steps are folded under each answer; a proposed playbook shows as a card.
import type { Pilot, PilotMessage } from "@neuralagent/protocol";
import { AssistantMessage, Button, Composer, Disclosure, StreamingText, ThinkingIndicator, UserBubble, ComposerDock } from "@neuralagent/ui";
import { ArrowDown, BellRing, ChevronRight, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useStickToBottom } from "../claude/useStickToBottom";
import { LiveConnector } from "./LiveConnector";
import { byDay, clock, useNow } from "../../lib/agentui";
import { pilotMessages, playbookEmpty } from "../../lib/autopilot";
import { useApDo, useAutopilot, usePilotUi } from "./hooks";
import { SuggestionCard } from "./SuggestionCard";

export function Chat({ pilot, scroller, onOpenConnector }: { pilot: Pilot; scroller: RefObject<HTMLDivElement | null>; onOpenConnector: (id: string) => void }) {
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

  // Scrolling is the page's, so the shared stick-to-bottom model is wired to it from here:
  // follow only while the reader is at the end, otherwise offer a "new" button.
  const content = useRef<HTMLDivElement | null>(null);
  const stick = useStickToBottom({ count: messages.length + suggestions.length, firstKey: null, resetKey: pilot.id, more: false, loadingOlder: false, onNearTop: () => {} });
  const { scrollerRef, contentRef, toBottom } = stick;
  useEffect(() => {
    scrollerRef(scroller.current);
    contentRef(content.current);
    return () => {
      scrollerRef(null);
      contentRef(null);
    };
  }, [scrollerRef, contentRef, scroller]);
  // Sending a message always brings you to the end.
  useEffect(() => {
    if (last?.role === "user") toBottom();
  }, [last?.id, last?.role, toBottom]);

  return (
    <div ref={content} className="flex flex-col gap-4 pb-28">
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
      {messages.length === 0 && !setup && <StartIdeas pilot={pilot} />}
      {days.map((d) => (
        <section key={d.label} className="flex flex-col gap-4">
          <h2 className="pt-2 text-center text-footnote text-dim">{d.label}</h2>
          {d.items.map((m) => (
            <div key={m.id} className="flex flex-col gap-2">
              <Line m={m} live={working && m === last} />
              {m.connector_id && <LiveConnector id={m.connector_id} pilot={pilot} onOpen={onOpenConnector} />}
            </div>
          ))}
        </section>
      ))}
      {suggestions.map((s) => (
        <SuggestionCard key={s.id} suggestion={s} />
      ))}
      {waitingForWords && <ThinkingIndicator variant="dots" label="The autopilot is thinking" />}
      {!stick.pinned && (
        <div className="sticky z-10 h-0" style={{ bottom: "calc(var(--tabbar-space, 0px) + 7.5rem)" }}>
          <div className="absolute inset-x-0 bottom-0 flex justify-center">
            <button
              type="button"
              onClick={() => toBottom({ smooth: true })}
              className="pressable flex h-8 items-center gap-1.5 rounded-full bg-navbar px-3 text-footnote text-bright shadow-edge backdrop-blur-xl"
            >
              <ArrowDown className="size-icon-sm" strokeWidth={2} />
              {stick.unseen > 0 ? `${stick.unseen} new` : "Latest"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Empty chat: one tap starts the common jobs. */
function StartIdeas({ pilot }: { pilot: Pilot }) {
  const run = useApDo();
  const ideas = ["Connect Discord", "Connect GitHub", "What is open in the inbox?"];
  return (
    <div className="flex flex-col gap-3 px-1 pt-2">
      <p className="text-subhead text-dim">Tell the autopilot what to do. It can also build a connector for you: just say what you want to connect.</p>
      <div className="flex flex-wrap gap-2">
        {ideas.map((t) => (
          <Button key={t} size="sm" variant="ghost" onClick={() => void run({ op: "pilot_send", id: pilot.id, text: t })} className="rounded-full">
            {t}
          </Button>
        ))}
      </div>
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
