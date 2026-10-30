import type { Profile, Swarm, SwarmMessage } from "@neuralagent/protocol";
import { Avatar, Button, Composer, ConfirmButton, Empty, Field, IconButton, Input, Menu, Pill, Sheet, StatusDot, TextArea, UserBubble, cn, toast } from "@neuralagent/ui";
import { ChevronDown, ChevronLeft, Plus, SquareTerminal, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS } from "../lib/status";
import { useClient, useDaemon } from "../lib/store";
import { useOpenSession } from "./NeuralPage";

/** One colour per member, in team order (the user has none). */
const COLORS = ["var(--color-accent)", "var(--color-mint)", "var(--color-warning)", "var(--color-ember)", "var(--color-tab)", "var(--color-live)"];
const TEAM = ["Coordinator", "Scout", "Builder", "Reviewer"];
const ROLE = /^[\p{L}\p{N} -]{1,24}$/u;

/** Swarms: teams of agents that hand work to each other, and their conversation. */
export function SwarmPage() {
  const swarms = useDaemon((c) => c.state?.swarms ?? []);
  const sorted = useMemo(() => [...swarms].sort((a, b) => Number(a.ended) - Number(b.ended) || b.started_at - a.started_at), [swarms]);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Desktop shows the list and the newest swarm side by side; phones one of the two.
  const shown = sorted.find((w) => w.id === open) ?? sorted[0];

  return (
    <div className="flex h-full min-h-0" style={{ paddingLeft: "var(--sidebar-space)", paddingTop: "var(--safe-top)", paddingBottom: "var(--tabbar-space)" }}>
      <aside className={cn("min-h-0 w-full shrink-0 flex-col md:flex md:w-72 md:border-r md:border-line", open ? "hidden" : "flex")}>
        <header className="flex shrink-0 items-center gap-3 px-4 pt-3 pb-2" data-tauri-drag-region>
          <div className="min-w-0 flex-1">
            <div className="text-button text-bright">Swarm</div>
            <div className="truncate text-meta text-dim">Agent teams</div>
          </div>
          <Button size="sm" Icon={Plus} onClick={() => setCreating(true)}>
            New
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {sorted.length === 0 ? (
            <div className="pt-10">
              <Empty Icon={Users} title="No swarm yet" detail="One goal, a team of agents: a coordinator plans, a scout looks things up, a builder writes the code, a reviewer checks it." />
            </div>
          ) : (
            sorted.map((w) => <SwarmItem key={w.id} swarm={w} selected={w.id === shown?.id} onClick={() => setOpen(w.id)} />)
          )}
        </div>
      </aside>
      <section className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", open ? "flex" : "hidden")}>
        {shown ? <Conversation key={shown.id} swarm={shown} onBack={() => setOpen(null)} /> : <div className="grid flex-1 place-items-center text-small text-dim">Start a swarm to see its team talk.</div>}
      </section>
      <Sheet open={creating} onClose={() => setCreating(false)} title="New swarm" size="lg">
        {creating && (
          <NewSwarm
            onDone={(id) => {
              setCreating(false);
              setOpen(id);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function SwarmItem({ swarm, selected, onClick }: { swarm: Swarm; selected: boolean; onClick: () => void }) {
  const sessions = useDaemon((c) => c.state?.sessions);
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === swarm.workspace_id)?.name ?? "");
  return (
    <button type="button" onClick={onClick} className={cn("hoverable flex w-full flex-col gap-1.5 rounded-item px-3 py-2.5 text-left", selected && "bg-fill-1")}>
      <span className="line-clamp-2 text-small text-ink">{swarm.goal}</span>
      <span className="flex items-center gap-2 text-meta text-dim">
        <span className="flex items-center gap-1">
          {swarm.members.map((m) => {
            const s = sessions?.[m.session_id];
            const st = s && s.alive ? STATUS[s.status] : STATUS.exited;
            return <StatusDot key={m.session_id} tone={st.tone} pulse={st.pulse} label={`${m.role}: ${st.label}`} />;
          })}
        </span>
        <span className="min-w-0 flex-1 truncate">{ws}</span>
        {swarm.ended && <span>Ended</span>}
      </span>
    </button>
  );
}

function Conversation({ swarm, onBack }: { swarm: Swarm; onBack: () => void }) {
  const client = useClient();
  const sessions = useDaemon((c) => c.state?.sessions);
  const all = useDaemon((c) => c.state?.swarm_messages);
  const messages = useMemo(() => (all ?? []).filter((m) => m.swarm_id === swarm.id), [all, swarm.id]);
  const openSession = useOpenSession();
  const [to, setTo] = useState("all");
  const scroller = useRef<HTMLDivElement>(null);
  const color = (role: string) => {
    const i = swarm.members.findIndex((m) => m.role === role);
    return i < 0 ? undefined : COLORS[i % COLORS.length];
  };

  // Follow the conversation while it is at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const act = (p: Promise<unknown>) => p.then(() => {}, (e) => void toast((e as Error).message, { tone: "danger" }));
  const send = (text: string) => {
    if (!text.trim()) return false;
    void act(client.req({ m: "swarm_send", p: { swarm_id: swarm.id, to, text } }));
  };

  return (
    <>
      <header className="flex shrink-0 items-start gap-2 px-4 pt-3 pb-2" data-tauri-drag-region>
        <IconButton label="All swarms" variant="ghost" onClick={onBack} className="md:hidden">
          <ChevronLeft size={18} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-button text-bright">{swarm.goal}</div>
          <div className="text-meta text-dim">{swarm.ended ? "Ended" : `${swarm.members.length} agents`}</div>
        </div>
        {swarm.members[0] && (
          <>
            <Button size="sm" variant="quiet" Icon={SquareTerminal} onClick={() => openSession(swarm.members[0]!.session_id)} className="hidden md:inline-flex">
              Terminals
            </Button>
            <IconButton label="Terminals" variant="ghost" onClick={() => openSession(swarm.members[0]!.session_id)} className="md:hidden">
              <SquareTerminal size={16} />
            </IconButton>
          </>
        )}
        {swarm.ended ? (
          <ConfirmButton size="sm" label="Remove" doneLabel="Removed" onConfirm={() => act(client.req({ m: "swarm_remove", p: { swarm_id: swarm.id } }))} />
        ) : (
          <ConfirmButton size="sm" label="Stop" doneLabel="Stopped" onConfirm={() => act(client.req({ m: "swarm_stop", p: { swarm_id: swarm.id } }))} />
        )}
      </header>

      <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-2">
        {swarm.members.map((m) => {
          const s = sessions?.[m.session_id];
          const st = s && s.alive ? STATUS[s.status] : STATUS.exited;
          return (
            <button
              key={m.session_id}
              type="button"
              onClick={() => openSession(m.session_id)}
              className="hoverable flex h-10 shrink-0 items-center gap-2 rounded-field bg-fill-1 px-3"
              aria-label={`${m.role}: ${st.label}. Open its terminal`}
            >
              <Avatar name={m.role} size={20} color={color(m.role)} />
              <span className="text-small text-ink">{m.role}</span>
              <StatusDot tone={st.tone} pulse={st.pulse} label={st.label} />
            </button>
          );
        })}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-4">
          {messages.length === 0 && <div className="pt-8 text-center text-small text-dim">The team is getting ready. Their messages to each other appear here.</div>}
          {messages.map((m) => (
            <Line key={m.id} m={m} color={color(m.from)} />
          ))}
        </div>
      </div>

      {!swarm.ended && (
        <div className="flex shrink-0 flex-col gap-2 px-4 pt-2 pb-3">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2 text-meta text-dim">
            <span>To</span>
            <Menu
              title="Recipient"
              align="start"
              items={[{ label: "Everyone", checked: to === "all", onSelect: () => setTo("all") }, ...swarm.members.map((m) => ({ label: m.role, checked: to === m.role, onSelect: () => setTo(m.role) }))]}
              trigger={(show) => (
                <Button size="xs" variant="quiet" onClick={show}>
                  {to === "all" ? "Everyone" : to}
                  <ChevronDown size={12} />
                </Button>
              )}
            />
          </div>
          <div className="mx-auto w-full max-w-2xl">
            <Composer onSend={send} placeholder={to === "all" ? "Message the team…" : `Message the ${to}…`} attachments={false} dictation={false} compact />
          </div>
        </div>
      )}
    </>
  );
}

function Line({ m, color }: { m: SwarmMessage; color?: string }) {
  if (m.from === "You") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-meta text-dim">To {m.to === "all" ? "everyone" : m.to}</span>
        <UserBubble animate={false}>{m.text}</UserBubble>
      </div>
    );
  }
  const time = new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex gap-3">
      <Avatar name={m.from} size={28} color={color} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-meta">
          <span className="text-ink">{m.from}</span>
          <span className="text-dim">→ {m.to === "all" ? "everyone" : m.to}</span>
          <span className="text-dim">{time}</span>
          {!m.delivered && (
            <Pill size="sm" tone="neutral">
              Queued
            </Pill>
          )}
        </div>
        <div className={cn("mt-1 whitespace-pre-wrap break-words text-body", m.to === "You" ? "text-bright" : "text-ink")}>{m.text}</div>
      </div>
    </div>
  );
}

interface Member {
  role: string;
  profile: string;
}

function NewSwarm({ onDone }: { onDone: (id: string) => void }) {
  const client = useClient();
  const state = useDaemon((c) => c.state);
  const workspaces = state?.workspaces ?? [];
  const agents = (state?.profiles ?? []).filter((p) => p.engine !== "shell" && p.engine !== "install");
  const fallback = state?.settings.default_profile ?? agents[0]?.id ?? "claude";
  const [ws, setWs] = useState(workspaces[0]?.id ?? "");
  const [goal, setGoal] = useState("");
  const [team, setTeam] = useState<Member[]>(TEAM.map((role) => ({ role, profile: fallback })));
  const [busy, setBusy] = useState(false);

  const names = team.map((m) => m.role.trim().toLowerCase());
  const bad = (i: number) => !ROLE.test(team[i]!.role.trim()) || ["all", "you", "user", "everyone", "team"].includes(names[i]!) || names.indexOf(names[i]!) !== i;
  const valid = ws !== "" && goal.trim() !== "" && team.length > 0 && team.every((_, i) => !bad(i));
  const patch = (i: number, p: Partial<Member>) => setTeam((t) => t.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const name = (id: string) => agents.find((p) => p.id === id)?.name ?? id;

  const start = async () => {
    setBusy(true);
    try {
      const members = team.map((m) => ({ role: m.role.trim(), profile_id: m.profile }));
      const w = (await client.req({ m: "swarm_start", p: { workspace_id: ws, goal: goal.trim(), members } })) as Swarm;
      onDone(w.id);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      <Field label="Workspace">
        <Menu
          title="Workspace"
          align="start"
          block
          items={workspaces.map((w) => ({ label: w.name, checked: w.id === ws, onSelect: () => setWs(w.id) }))}
          trigger={(show) => (
            <Button variant="quiet" block onClick={show}>
              <span className="min-w-0 flex-1 truncate text-left">{workspaces.find((w) => w.id === ws)?.name ?? "Pick a workspace"}</span>
              <ChevronDown size={14} />
            </Button>
          )}
        />
      </Field>
      <Field label="Goal" hint="What the team should achieve. The coordinator splits it into tasks.">
        <TextArea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Add a dark mode to the settings page" autoFocus maxRows={6} />
      </Field>
      <Field label="Team" hint="Members talk to each other by role. Up to 8.">
        <div className="flex flex-col gap-2">
          {team.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="flex-1" value={m.role} onChange={(e) => patch(i, { role: e.target.value })} invalid={bad(i)} aria-label="Role" />
              <AgentPicker agents={agents} value={m.profile} label={name(m.profile)} onChange={(profile) => patch(i, { profile })} />
              <Button size="xs" variant="ghost" Icon={X} aria-label={`Remove ${m.role}`} onClick={() => setTeam((t) => t.filter((_, j) => j !== i))} />
            </div>
          ))}
          {team.length < 8 && (
            <div>
              <Button size="xs" variant="quiet" Icon={Plus} onClick={() => setTeam((t) => [...t, { role: `Builder ${t.length}`, profile: fallback }])}>
                Add member
              </Button>
            </div>
          )}
        </div>
      </Field>
      <div className="flex justify-end pt-2">
        <Button busy={busy} disabled={!valid} Icon={Users} onClick={() => void start()}>
          Start swarm
        </Button>
      </div>
    </div>
  );
}

function AgentPicker({ agents, value, label, onChange }: { agents: Profile[]; value: string; label: string; onChange: (id: string) => void }) {
  return (
    <Menu
      title="Agent"
      items={agents.map((p) => ({ label: p.name, checked: p.id === value, onSelect: () => onChange(p.id) }))}
      trigger={(show) => (
        <Button size="sm" variant="quiet" onClick={show} className="w-36">
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown size={12} />
        </Button>
      )}
    />
  );
}
