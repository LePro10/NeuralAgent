// New swarm: the form (goal, workspace, team of role + agent) in a dialog on desktop, a sheet on phones.
import type { Profile, Swarm } from "@neuralagent/protocol";
import { Button, IconButton, List, Menu, Row, Sheet, SwipeRow, TextArea, cn, toast, useLayoutMode } from "@neuralagent/ui";
import { ChevronsUpDown, Folder, Plus, Trash2, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClient, useDaemon } from "../../lib/store";
import { EngineTile } from "../EngineTile";

const TEAM = ["Coordinator", "Scout", "Builder", "Reviewer"];
const ROLE = /^[\p{L}\p{N} -]{1,24}$/u;
const RESERVED = ["all", "you", "user", "everyone", "team"];
const MAX_TEAM = 8;

interface Member {
  key: number;
  role: string;
  profile: string;
}
let memberKey = 0;
type StartState = { run: () => void; valid: boolean; busy: boolean };

/**
 * New swarm: a centred dialog on desktop, a sheet on phones. Start sits in the footer, so it stays
 * in reach above the keyboard.
 */
export function NewSwarmSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const phone = useLayoutMode() === "phone";
  const [key, setKey] = useState(0);
  // A fresh form every time it opens.
  useEffect(() => {
    if (open) setKey((k) => k + 1);
  }, [open]);
  const [start, setStart] = useState<StartState>({ run: () => {}, valid: false, busy: false });
  const go = (
    <Button variant="accent" size={phone ? "lg" : "md"} block={phone} busy={start.busy} disabled={!start.valid} Icon={Users} onClick={start.run} className="rounded-full">
      Start swarm
    </Button>
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New swarm"
      size="md"
      desktop="dialog"
      footer={
        phone ? (
          <div className="border-t-hair border-line pt-3">{go}</div>
        ) : (
          <div className="flex items-center justify-end gap-2 border-t-hair border-line pt-3">
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            {go}
          </div>
        )
      }
    >
      {open && <NewSwarm key={key} onDone={onDone} expose={setStart} />}
    </Sheet>
  );
}

/** The form: workspace, goal, team (role + agent each). */
function NewSwarm({ onDone, expose }: { onDone: (id: string) => void; expose: (s: StartState) => void }) {
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
  const bad = (i: number) => !ROLE.test(team[i]!.role.trim()) || RESERVED.includes(names[i]!) || names.indexOf(names[i]!) !== i;
  const valid = ws !== "" && goal.trim() !== "" && team.length > 0 && team.every((_, i) => !bad(i));
  const patch = (i: number, p: Partial<Member>) => setTeam((t) => t.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const remove = (i: number) => setTeam((t) => t.filter((_, j) => j !== i));
  const add = () =>
    setTeam((t) => {
      const used = new Set(t.map((m) => m.role.trim().toLowerCase()));
      let n = 2;
      while (used.has(`builder ${n}`)) n++;
      return [...t, { key: memberKey++, role: used.has("builder") ? `Builder ${n}` : "Builder", profile: fallback }];
    });
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
      <div>
        <h3 className="mb-1.5 px-4 text-footnote text-dim uppercase tracking-wide">Goal</h3>
        <TextArea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run.current();
          }}
          placeholder="Add a dark mode to the settings page"
          autoFocus={!phone}
          maxRows={6}
          aria-label="Goal"
          className="min-h-24"
        />
        <p className="mt-1.5 px-4 text-footnote text-dim">What the team should achieve. The coordinator splits it into tasks.</p>
      </div>

      <List footer={workspaces.length === 0 ? "Add a project folder as a workspace first: it is where the team works." : undefined}>
        <Menu
          title="Workspace"
          align="start"
          block
          items={workspaces.map((w) => ({ label: w.name, Icon: Folder, checked: w.id === ws, onSelect: () => setWs(w.id) }))}
          trigger={(show) => <Row Icon={Folder} title="Workspace" value={wsName ?? (workspaces.length ? "Pick one" : "None yet")} chevron onClick={show} />}
        />
      </List>

      <List label="Team" footer={`Members talk to each other by role.${phone ? " Swipe a member to remove it." : ""} Up to ${MAX_TEAM}.`}>
        {team.map((m, i) => (
          <SwipeRow key={m.key} trailing={team.length > 1 ? [{ label: "Remove", Icon: Trash2, tone: "danger", onAction: () => remove(i) }] : []}>
            <div data-lead="" className="flex min-h-row items-center gap-3 py-1.5 pr-2 pl-4">
              <EngineTile engine={agents.find((a) => a.id === m.profile)?.engine ?? "custom"} />
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
              {!phone && (
                <span className={cn(team.length < 2 && "invisible")}>
                  <IconButton label={`Remove ${m.role}`} variant="ghost" size="sm" onClick={() => remove(i)}>
                    <X />
                  </IconButton>
                </span>
              )}
            </div>
          </SwipeRow>
        ))}
        {team.length < MAX_TEAM && <Row Icon={Plus} title="Add member" onClick={add} chevron={false} />}
      </List>
    </div>
  );
}

/** The agent of a team member: its name, and a list of agents (an action sheet on phones). */
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
