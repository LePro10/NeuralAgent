import type { OrchMessage, Session } from "@neuralagent/protocol";
import {
  AssistantMessage,
  AssistantOrb,
  Button,
  Callout,
  Composer,
  EmptyChatHero,
  IconButton,
  StatusDot,
  StreamingText,
  SuggestionGrid,
  ThinkingIndicator,
  UserBubble,
  VoiceOverlay,
  cn,
  toast,
  type ComposerHandle,
  type Suggestion,
} from "@neuralagent/ui";
import { Activity, Bell, Check, Eraser, Phone, Play, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { callLevel, endCall, interruptCall, muteCall, startCall, useCall } from "../lib/call";
import { frontTabFor } from "../lib/layout";
import { STATUS } from "../lib/status";
import { useClient, useDaemon, usePlatform, useUi } from "../lib/store";
import { AgentGlyph } from "./AgentGlyph";

const SUGGESTIONS: Suggestion[] = [
  { title: "What are my agents doing?", Icon: Activity, prompt: "What are my agents doing right now?" },
  { title: "Start an agent", detail: "in one of your workspaces", Icon: Play, prompt: "Start an agent in " },
];

/**
 * Neural, the orchestrator: one conversation shared by the desktop, the browser and the phone.
 * On phones this is the home screen: the conversation, the running agents below it.
 */
export function NeuralPage({ onSettings }: { onSettings?: () => void }) {
  const client = useClient();
  const platform = usePlatform();
  const orch = useDaemon((c) => c.state?.orchestrator);
  const scroller = useRef<HTMLDivElement>(null);
  const messages = orch?.messages ?? [];
  const last = messages.at(-1);

  // Follow the conversation while it grows.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, last?.text.length]);

  const send = (text: string) => {
    client.req({ m: "orch_send", p: { text } }).catch((e) => toast((e as Error).message, { tone: "danger" }));
  };
  const composer = useRef<ComposerHandle>(null);
  const call = useCall();
  // A call that ended on its own (models missing, connection lost) says why.
  useEffect(() => {
    if (call.error) toast(call.error, { tone: "danger" });
  }, [call.error]);
  if (!orch) return null;
  const dial = () => void startCall(client);

  const empty = messages.length === 0;
  const waitingForWords = orch.busy && (!last || last.role !== "assistant" || last.text === "");

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{ paddingLeft: "var(--sidebar-space)", paddingTop: "var(--safe-top)", paddingBottom: "var(--tabbar-space)" }}
    >
      <header className="flex shrink-0 items-center gap-3 px-4 pt-3 pb-2" data-tauri-drag-region>
        <AssistantOrb size={28} state={orch.busy ? "busy" : "idle"} label="Neural" />
        <div className="min-w-0 flex-1">
          <div className="text-button text-bright">Neural</div>
          <div className="truncate text-meta text-dim">{orch.busy ? "Working…" : orch.ready ? "Your agents’ orchestrator" : "Needs a model"}</div>
        </div>
        {orch.ready && (
          <IconButton label="Call Neural" variant="tint" onClick={dial} className="hidden md:flex">
            <Phone size={16} />
          </IconButton>
        )}
        {!empty && (
          <IconButton label="Clear conversation" variant="ghost" onClick={() => client.req({ m: "orch_clear" }).catch(() => {})}>
            <Eraser size={16} />
          </IconButton>
        )}
      </header>

      {orch.ready && (
        <div className="shrink-0 px-4 pb-2 md:hidden">
          <Button size="lg" block Icon={Phone} onClick={dial}>
            Call Neural
          </Button>
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-4">
          {!orch.ready && (
            <Callout
              tone="warning"
              title="Neural needs a model"
              action={
                onSettings && (
                  <Button size="sm" variant="tint" onClick={onSettings}>
                    Set up
                  </Button>
                )
              }
            >
              {platform.kind === "desktop" ? "Add your NeuralHub, Anthropic or OpenAI key, or use a local Ollama model." : "Add a key in Settings → Neural on your computer."}
            </Callout>
          )}
          {empty ? (
            <div className="flex flex-col items-center gap-6 pt-12">
              <EmptyChatHero name="Neural" greeting="What should your agents do" visual="orb" />
              <SuggestionGrid
                items={SUGGESTIONS}
                layout="rail"
                onPick={(s) => {
                  if (s.prompt?.endsWith(" ")) {
                    composer.current?.setText(s.prompt);
                    composer.current?.focus();
                  } else if (s.prompt) send(s.prompt);
                }}
              />
            </div>
          ) : (
            messages.map((m) => <Line key={m.id} m={m} live={orch.busy && m === last} />)
          )}
          {waitingForWords && <ThinkingIndicator variant="dots" label="Neural is thinking" />}
        </div>
      </div>

      <Agents />

      <div className="shrink-0 px-4 pt-2 pb-3">
        <div className="mx-auto w-full max-w-2xl">
          <Composer
            ref={composer}
            onSend={(t) => {
              if (!t.trim()) return false;
              send(t);
            }}
            placeholder={orch.ready ? "Ask Neural…" : "Neural needs a model first"}
            busy={orch.busy}
            onStop={() => client.req({ m: "orch_stop" }).catch(() => {})}
            disabled={!orch.ready}
            attachments={false}
            dictation={false}
            compact
          />
        </div>
      </div>

      {createPortal(
        <AnimatePresence>
          {call.on && (
            <VoiceOverlay
              className="fixed z-50"
            label="Neural"
            state={call.state}
            heard={call.heard}
            transcript={call.transcript}
            spokenWords={call.spokenWords}
            muted={call.muted}
            level={callLevel}
            onMute={() => muteCall(!call.muted)}
            onInterrupt={interruptCall}
            onEnd={() => endCall()}
          />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function Line({ m, live }: { m: OrchMessage; live: boolean }) {
  const open = useOpenSession();
  switch (m.role) {
    case "user":
      return <UserBubble animate={false}>{m.text}</UserBubble>;
    case "assistant":
      if (!m.text) return null;
      return (
        <AssistantMessage>
          <StreamingText text={m.text} live={live} />
        </AssistantMessage>
      );
    case "action":
    case "notice": {
      const Icon = m.role === "notice" ? Bell : m.ok === false ? X : Check;
      return (
        <button
          type="button"
          disabled={!m.session_id}
          onClick={() => m.session_id && open(m.session_id)}
          className={cn(
            "hoverable flex items-center gap-2 self-start rounded-item px-2 py-1 text-left text-meta",
            m.ok === false ? "text-danger" : "text-dim",
            m.session_id && "hover:text-ink",
          )}
        >
          <Icon size={14} className="shrink-0" />
          <span className="min-w-0">{m.text}</span>
        </button>
      );
    }
  }
}

/** Opens an agent's pane: its workspace, with its tab in front. */
function useOpenSession() {
  const client = useClient();
  const setWorkspace = useUi((u) => u.setWorkspace);
  return (sid: string) => {
    const st = client.state;
    const s = st?.sessions[sid];
    if (!s || !st) return;
    const layout = frontTabFor(st.layouts[s.workspace_id], s.id);
    if (layout) client.req({ m: "layout_set", p: { workspace_id: s.workspace_id, layout } }).catch(() => {});
    setWorkspace(s.workspace_id);
  };
}

/** The running agents, compact: what Neural is talking about, one tap away. */
function Agents() {
  const sessions = useDaemon((c) => c.state?.sessions);
  const profiles = useDaemon((c) => c.state?.profiles);
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const open = useOpenSession();
  const list = useMemo(() => {
    const engine = (id: string) => profiles?.find((p) => p.id === id)?.engine ?? "shell";
    return Object.values(sessions ?? {})
      .filter((s): s is Session => !!s && s.alive && engine(s.profile_id) !== "shell" && !s.profile_id.startsWith("install:"))
      .sort((a, b) => b.started_at - a.started_at)
      .map((s) => ({ s, engine: engine(s.profile_id), ws: workspaces?.find((w) => w.id === s.workspace_id)?.name ?? "" }));
  }, [sessions, profiles, workspaces]);
  if (list.length === 0) return null;
  return (
    <div className="shrink-0 overflow-x-auto px-4 pt-1">
      <div className="mx-auto flex w-full max-w-2xl gap-2">
        {list.map(({ s, engine, ws }) => {
          const st = STATUS[s.status];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => open(s.id)}
              className="hoverable flex h-10 max-w-60 shrink-0 items-center gap-2 rounded-field bg-fill-1 px-3 text-left"
              aria-label={`${ws} — ${s.title}: ${st.label}`}
            >
              <AgentGlyph engine={engine} size={14} className="shrink-0 text-ink" />
              <span className="min-w-0 flex-1 truncate text-small text-ink">{ws || s.title}</span>
              <StatusDot tone={st.tone} pulse={st.pulse} label={st.label} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
