import type { Profile, Swarm, SwarmMessage } from "@neuralagent/protocol";
import {
  ActivityMark,
  Avatar,
  AvatarStack,
  BackButton,
  Button,
  Composer,
  ConfirmSheet,
  Empty,
  IconButton,
  IconTile,
  List,
  Menu,
  Page,
  Pill,
  Row,
  Sheet,
  Stack,
  SwipeRow,
  TextArea,
  UserBubble,
  cn,
  toast,
  useKeyboardInset,
  useKeyboardOpen,
  useLayoutMode,
  usePortalTarget,
  useStack,
  useStackNav,
  type MenuEntry,
} from "@neuralagent/ui";
import { ChevronsUpDown, Ellipsis, Folder, Plus, Square, SquareTerminal, Trash2, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MEMBER_COLORS, clock, shortAgo, sysVar, useNow } from "../lib/agentui";
import { STATUS, activityOf } from "../lib/status";
import { useClient, useDaemon } from "../lib/store";
import { EngineTile } from "./EngineTile";
import { Glow } from "./Glow";
import { useOpenSession } from "./NeuralPage";

const TEAM = ["Coordinator", "Scout", "Builder", "Reviewer"];
const ROLE = /^[\p{L}\p{N} -]{1,24}$/u;
const MAX_TEAM = 8;

/** A member's colour, by its place in the team (the user has none). */
const colorOf = (swarm: Swarm, role: string) => {
  const i = swarm.members.findIndex((m) => m.role === role);
  return i < 0 ? undefined : sysVar(MEMBER_COLORS[i % MEMBER_COLORS.length]!);
};

/** Swarms: teams of agents that hand work to each other, and their conversation. */
export function SwarmPage() {
  const phone = useLayoutMode() === "phone";
  const swarms = useDaemon((c) => c.state?.swarms ?? []);
  const sorted = useMemo(() => [...swarms].sort((a, b) => Number(a.ended) - Number(b.ended) || b.started_at - a.started_at), [swarms]);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const stack = useStack();

  const open = (id: string) => {
    if (phone) stack.push(id, <SwarmDetail id={id} />);
    else setPicked(id);
  };
  const created = (id: string) => {
    setCreating(false);
    open(id);
  };
  const sheet = <NewSwarmSheet open={creating} onClose={() => setCreating(false)} onDone={created} />;
  const list = <SwarmList swarms={sorted} selected={phone ? undefined : (picked ?? sorted[0]?.id)} onOpen={open} onNew={() => setCreating(true)} />;

  if (phone) {
    return (
      <div className="relative h-full">
        <Stack
          stack={stack}
          root={
            <div className="relative h-full">
              <Glow tint="swarm" />
              {list}
            </div>
          }
          className="h-full"
        />
        {sheet}
      </div>
    );
  }
  // Desktop: the list and the open swarm side by side.
  const shown = sorted.find((w) => w.id === picked) ?? sorted[0];
  return (
    <div className="relative flex h-full min-h-0">
      <Glow tint="swarm" />
      <div className="relative h-full w-96 shrink-0 border-r-hair border-line">{list}</div>
      <section className="relative flex h-full min-w-0 flex-1 flex-col" style={{ paddingTop: "var(--safe-top)" }}>
        {shown ? (
          <SwarmDetail key={shown.id} id={shown.id} />
        ) : (
          <div className="grid flex-1 place-items-center">
            <Empty Icon={Users} title="No swarm open" detail="Start a swarm to see its team talk." />
          </div>
        )}
      </section>
      {sheet}
    </div>
  );
}

function SwarmList({ swarms, selected, onOpen, onNew }: { swarms: Swarm[]; selected?: string; onOpen: (id: string) => void; onNew: () => void }) {
  const phone = useLayoutMode() === "phone";
  const running = swarms.filter((w) => !w.ended);
  const ended = swarms.filter((w) => w.ended);
  const add = phone ? (
    <IconButton label="New swarm" variant="ghost" onClick={onNew}>
      <Plus />
    </IconButton>
  ) : (
    <Button size="sm" variant="accent" Icon={Plus} onClick={onNew} className="rounded-full">
      New swarm
    </Button>
  );
  return (
    <Page title="Swarm" eyebrow="Agent teams" actions={add}>
      {swarms.length === 0 ? (
        <Empty
          Icon={Users}
          title="No swarm yet"
          detail="One goal, a team of agents: a coordinator plans, a scout looks things up, a builder writes the code, a reviewer checks it."
          action={
            <Button variant="accent" Icon={Plus} onClick={onNew} className="rounded-full">
              New swarm
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-7">
          {running.length > 0 && (
            <List label="Running">
              {running.map((w) => (
                <SwarmRow key={w.id} swarm={w} selected={w.id === selected} onClick={() => onOpen(w.id)} />
              ))}
            </List>
          )}
          {ended.length > 0 && (
            <List label="Ended">
              {ended.map((w) => (
                <SwarmRow key={w.id} swarm={w} selected={w.id === selected} onClick={() => onOpen(w.id)} />
              ))}
            </List>
          )}
        </div>
      )}
    </Page>
  );
}

function SwarmRow({ swarm, selected, onClick }: { swarm: Swarm; selected: boolean; onClick: () => void }) {
  const sessions = useDaemon((c) => c.state?.sessions);
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === swarm.workspace_id)?.name ?? "");
  const now = useNow();
  const team = swarm.members.map((m) => sessions?.[m.session_id]).filter((s) => !!s?.alive);
  const activity = swarm.ended ? undefined : activityOf(team.map((s) => s!.status));
  return (
    <button
      type="button"
      data-lead=""
      onClick={onClick}
      aria-current={selected || undefined}
      className={cn("press-row flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-fill-1", selected && "!bg-fill-3")}
    >
      <IconTile Icon={Users} color={swarm.ended ? "gray" : "purple"} activity={activity} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-headline text-bright">{swarm.goal}</span>
        <span className="mt-1.5 flex items-center gap-2 text-footnote text-dim">
          <AvatarStack size={20} max={5} people={swarm.members.map((m) => ({ name: m.role, color: colorOf(swarm, m.role) }))} />
          <span className="min-w-0 truncate">
            {ws} · {swarm.ended ? "Ended" : `${team.length} agents`} · {shortAgo(swarm.started_at, now)}
          </span>
        </span>
      </span>
    </button>
  );
}

/** One swarm: goal, team, their conversation, and a composer to talk to them. */
function SwarmDetail({ id }: { id: string }) {
  const client = useClient();
  const phone = useLayoutMode() === "phone";
  const swarm = useDaemon((c) => c.state?.swarms.find((w) => w.id === id));
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === swarm?.workspace_id)?.name ?? "");
  const all = useDaemon((c) => c.state?.swarm_messages);
  const messages = useMemo(() => (all ?? []).filter((m) => m.swarm_id === id), [all, id]);
  const openSession = useOpenSession();
  const [to, setTo] = useState("all");
  const [confirm, setConfirm] = useState<"stop" | "remove" | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const kbOpen = useKeyboardOpen();
  const kb = useKeyboardInset(usePortalTarget());

  // Follow the conversation while it is at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  if (!swarm) return <BackOnly />;
  const act = (p: Promise<unknown>) => p.then(() => {}, (e) => void toast((e as Error).message, { tone: "danger" }));
  const send = (text: string) => {
    if (!text.trim()) return false;
    void act(client.req({ m: "swarm_send", p: { swarm_id: swarm.id, to, text } }));
  };
  const menu: MenuEntry[] = [
    ...(swarm.members[0] ? [{ label: "Open terminals", Icon: SquareTerminal, onSelect: () => openSession(swarm.members[0]!.session_id) }] : []),
    swarm.ended
      ? { label: "Remove swarm", Icon: Trash2, destructive: true, divider: true, onSelect: () => setConfirm("remove") }
      : { label: "Stop swarm", Icon: Square, destructive: true, divider: true, onSelect: () => setConfirm("stop") },
  ];
  const bottom = kb ? `${kb.bottom + 8}px` : kbOpen ? "calc(var(--safe-bottom) + 8px)" : phone ? "calc(var(--tabbar-space) + 4px)" : "16px";

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ paddingTop: phone ? "var(--safe-top)" : undefined, paddingBottom: bottom }}>
      <header className="flex h-navbar shrink-0 items-center gap-1 px-2" data-tauri-drag-region>
        {phone && <StackBack />}
        <div className="flex-1" />
        <Menu
          title="Swarm"
          items={menu}
          trigger={(show) => (
            <IconButton label="Swarm actions" variant="ghost" onClick={show}>
              <Ellipsis />
            </IconButton>
          )}
        />
      </header>

      <div ref={scroller} className="scroller min-h-0 flex-1 overflow-y-auto" style={EDGE_Y}>
        <div className="mx-auto w-full max-w-2xl px-4 pb-6">
          <div className="pt-1 pb-4">
            <h1 className="text-title-2 text-bright">{swarm.goal}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-footnote text-dim">
              <Pill size="sm" tone={swarm.ended ? "neutral" : "success"} dot={!swarm.ended}>
                {swarm.ended ? "Ended" : "Running"}
              </Pill>
              <span>
                {ws} · started {clock(swarm.started_at)}
              </span>
            </div>
          </div>
          <Team swarm={swarm} onOpen={openSession} />
          <div className="mt-5 flex flex-col gap-5">
            {messages.length === 0 && <p className="pt-6 text-center text-subhead text-dim">The team is getting ready. Their messages to each other appear here.</p>}
            {messages.map((m) => (
              <Line key={m.id} m={m} color={colorOf(swarm, m.from)} />
            ))}
          </div>
        </div>
      </div>

      {!swarm.ended && (
        <div className="shrink-0 px-4 pt-2">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
            <Menu
              title="Send to"
              align="start"
              items={[
                { label: "Everyone", Icon: Users, checked: to === "all", onSelect: () => setTo("all") },
                ...swarm.members.map((m) => ({ label: m.role, glyph: <Avatar name={m.role} size={24} color={colorOf(swarm, m.role)} />, checked: to === m.role, onSelect: () => setTo(m.role) })),
              ]}
              trigger={(show) => (
                <button type="button" onClick={show} className="pressable flex h-8 items-center gap-1.5 self-start rounded-full bg-fill-2 pr-2.5 pl-1 text-footnote text-ink hover:bg-fill-3">
                  {to === "all" ? (
                    <span className="grid size-6 place-items-center rounded-full bg-fill-3">
                      <Users className="size-3.5" />
                    </span>
                  ) : (
                    <Avatar name={to} size={24} color={colorOf(swarm, to)} />
                  )}
                  To {to === "all" ? "everyone" : to}
                  <ChevronsUpDown className="size-3.5 text-dim" />
                </button>
              )}
            />
            <Composer onSend={send} placeholder={to === "all" ? "Message the team…" : `Message the ${to}…`} attachments={false} dictation={false} compact />
          </div>
        </div>
      )}

      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "stop" ? "Stop this swarm?" : "Remove this swarm?"}
        message={confirm === "stop" ? "Every member stops. Their conversation stays here." : "The swarm and its conversation are removed from the list."}
        confirmLabel={confirm === "stop" ? "Stop swarm" : "Remove"}
        destructive
        Icon={confirm === "stop" ? Square : Trash2}
        onConfirm={() => act(client.req(confirm === "stop" ? { m: "swarm_stop", p: { swarm_id: swarm.id } } : { m: "swarm_remove", p: { swarm_id: swarm.id } }))}
      />
    </div>
  );
}

const EDGE_Y: CSSProperties = {
  maskImage: "linear-gradient(180deg, transparent, black 12px, black calc(100% - 12px), transparent)",
  WebkitMaskImage: "linear-gradient(180deg, transparent, black 12px, black calc(100% - 12px), transparent)",
};

/** Back to the list of swarms (phones; the detail is a level of the Stack). */
function StackBack() {
  const { pop } = useStackNav();
  return <BackButton label="Swarm" onBack={pop} />;
}
function BackOnly() {
  const phone = useLayoutMode() === "phone";
  return <div className="px-2 pt-2" style={{ paddingTop: "var(--safe-top)" }}>{phone && <StackBack />}</div>;
}

/** The members as cards: avatar with its activity, role, what it is doing. Tap opens its terminal. */
function Team({ swarm, onOpen }: { swarm: Swarm; onOpen: (sid: string) => void }) {
  const sessions = useDaemon((c) => c.state?.sessions);
  return (
    <div data-no-swipe className="scroll-x -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {swarm.members.map((m) => {
        const s = sessions?.[m.session_id];
        const alive = !!s?.alive;
        const st = alive ? STATUS[s!.status] : STATUS.exited;
        return (
          <button
            key={m.session_id}
            type="button"
            onClick={() => onOpen(m.session_id)}
            className="pressable surface flex min-w-32 shrink-0 items-center gap-2.5 rounded-list py-2.5 pr-4 pl-2.5 text-left"
            aria-label={`${m.role}: ${st.label}. Open its terminal`}
          >
            <span className="relative">
              <Avatar name={m.role} size={34} color={colorOf(swarm, m.role)} />
              <ActivityMark activity={alive ? activityOf([s!.status]) : undefined} size={10} edge="ring-card" corner="-top-0.5 -right-0.5" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-subhead text-bright">{m.role}</span>
              <span className={cn("truncate text-caption", alive && s!.status === "waiting" ? "text-accent" : "text-dim")}>{alive ? st.label : "Stopped"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Line({ m, color }: { m: SwarmMessage; color?: string }) {
  if (m.from === "You") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="px-1 text-caption text-dim">To {m.to === "all" ? "everyone" : m.to}</span>
        <UserBubble animate={false} time={clock(m.at)}>
          {m.text}
        </UserBubble>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <Avatar name={m.from} size={30} color={color} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-footnote">
          <span className="text-headline text-bright">{m.from}</span>
          <span className="text-dim">to {m.to === "all" ? "everyone" : m.to}</span>
          <span className="text-faint">· {clock(m.at)}</span>
          {!m.delivered && (
            <Pill size="sm" tone="neutral">
              Queued
            </Pill>
          )}
        </div>
        <div className={cn("mt-1 text-body break-words whitespace-pre-wrap", m.to === "You" ? "text-bright" : "text-ink")}>{m.text}</div>
      </div>
    </div>
  );
}

interface Member {
  key: number;
  role: string;
  profile: string;
}
let memberKey = 0;

/** The new-swarm sheet. Start sits in the sheet's footer, so it stays in reach above the keyboard. */
function NewSwarmSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [key, setKey] = useState(0);
  // A fresh form every time the sheet opens.
  useEffect(() => {
    if (open) setKey((k) => k + 1);
  }, [open]);
  const [start, setStart] = useState<{ run: () => void; valid: boolean; busy: boolean }>({ run: () => {}, valid: false, busy: false });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New swarm"
      size="lg"
      footer={
        <Button variant="accent" size="lg" block busy={start.busy} disabled={!start.valid} Icon={Users} onClick={start.run} className="rounded-full">
          Start swarm
        </Button>
      }
    >
      {open && <NewSwarm key={key} onDone={onDone} expose={setStart} />}
    </Sheet>
  );
}

/** The new-swarm form: workspace, goal, team (role + agent each). */
function NewSwarm({ onDone, expose }: { onDone: (id: string) => void; expose: (s: { run: () => void; valid: boolean; busy: boolean }) => void }) {
  const client = useClient();
  const phone = useLayoutMode() === "phone";
  const state = useDaemon((c) => c.state);
  const workspaces = state?.workspaces ?? [];
  const agents = (state?.profiles ?? []).filter((p) => p.engine !== "shell" && p.engine !== "install" && !p.id.startsWith("install:"));
  const fallback = state?.settings.default_profile && agents.some((a) => a.id === state.settings.default_profile) ? state.settings.default_profile : (agents[0]?.id ?? "claude");
  const [ws, setWs] = useState(workspaces[0]?.id ?? "");
  const [goal, setGoal] = useState("");
  const [team, setTeam] = useState<Member[]>(() => TEAM.map((role) => ({ key: memberKey++, role, profile: fallback })));
  const [busy, setBusy] = useState(false);

  const names = team.map((m) => m.role.trim().toLowerCase());
  const bad = (i: number) => !ROLE.test(team[i]!.role.trim()) || ["all", "you", "user", "everyone", "team"].includes(names[i]!) || names.indexOf(names[i]!) !== i;
  const valid = ws !== "" && goal.trim() !== "" && team.length > 0 && team.every((_, i) => !bad(i));
  const patch = (i: number, p: Partial<Member>) => setTeam((t) => t.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const remove = (i: number) => setTeam((t) => t.filter((_, j) => j !== i));
  const wsName = workspaces.find((w) => w.id === ws)?.name;

  const start = async () => {
    if (!valid || busy) return;
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

  // The footer button (owned by the sheet) runs this form's start.
  const run = useRef(start);
  run.current = start;
  useEffect(() => expose({ run: () => void run.current(), valid, busy }), [valid, busy, expose]);

  return (
    <div className="flex flex-col gap-6 pt-1 pb-2">
      <List>
        <Menu
          title="Workspace"
          align="start"
          block
          items={workspaces.map((w) => ({ label: w.name, Icon: Folder, checked: w.id === ws, onSelect: () => setWs(w.id) }))}
          trigger={(show) => <Row Icon={Folder} tile="blue" title="Workspace" value={wsName ?? "Pick one"} chevron onClick={show} />}
        />
      </List>

      <div>
        <h3 className="mb-1.5 px-4 text-footnote text-dim uppercase tracking-wide">Goal</h3>
        <TextArea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Add a dark mode to the settings page" autoFocus={!phone} maxRows={6} aria-label="Goal" className="min-h-24" />
        <p className="mt-1.5 px-4 text-footnote text-dim">What the team should achieve. The coordinator splits it into tasks.</p>
      </div>

      <List label="Team" footer={`Members talk to each other by role.${phone ? " Swipe a member to remove it." : ""} Up to ${MAX_TEAM}.`}>
        {team.map((m, i) => (
          <SwipeRow key={m.key} trailing={team.length > 1 ? [{ label: "Remove", Icon: Trash2, tone: "danger", onAction: () => remove(i) }] : []}>
            <div data-lead="" className="flex min-h-row items-center gap-3 py-1.5 pr-2 pl-4">
              <Avatar name={m.role || "?"} size={30} color={sysVar(MEMBER_COLORS[i % MEMBER_COLORS.length]!)} />
              <input
                value={m.role}
                onChange={(e) => patch(i, { role: e.target.value })}
                aria-label={`Role ${i + 1}`}
                aria-invalid={bad(i) || undefined}
                maxLength={24}
                className={cn("h-tap min-w-0 flex-1 bg-transparent text-input outline-none placeholder:text-faint", bad(i) ? "text-danger" : "text-bright")}
                placeholder="Role"
              />
              <AgentPicker agents={agents} value={m.profile} onChange={(profile) => patch(i, { profile })} />
              {!phone && team.length > 1 && (
                <IconButton label={`Remove ${m.role}`} variant="ghost" size="sm" onClick={() => remove(i)}>
                  <X />
                </IconButton>
              )}
            </div>
          </SwipeRow>
        ))}
        {team.length < MAX_TEAM && (
          <Row Icon={Plus} tile="green" title="Add member" onClick={() => setTeam((t) => [...t, { key: memberKey++, role: `Builder ${t.length}`, profile: fallback }])} chevron={false} />
        )}
      </List>

    </div>
  );
}

/** The agent of a team member: its tile and name; a list of agents (an action sheet on phones). */
function AgentPicker({ agents, value, onChange }: { agents: Profile[]; value: string; onChange: (id: string) => void }) {
  const p = agents.find((a) => a.id === value);
  return (
    <span className="flex shrink-0">
    <Menu
      title="Agent"
      items={agents.map((a) => ({ label: a.name, glyph: <EngineTile engine={a.engine} />, checked: a.id === value, onSelect: () => onChange(a.id) }))}
      trigger={(show) => (
        <button type="button" onClick={show} className="pressable flex h-tap max-w-40 items-center gap-1.5 rounded-full pr-1 pl-2 text-subhead text-dim hover:text-ink">
          <span className="truncate">{p?.name ?? value}</span>
          <ChevronsUpDown className="size-3.5 shrink-0" />
        </button>
      )}
    />
    </span>
  );
}
