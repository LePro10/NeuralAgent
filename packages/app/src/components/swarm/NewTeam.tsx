// New team: workspace, goal, pattern and the agents, in a dialog on desktop and a sheet on phones.
import type { NeuralTask, Profile } from "@neuralagent/protocol";
import { Button, Field, Input, List, Menu, Row, Segmented, Sheet, TextArea, toast, useLayoutMode } from "@neuralagent/ui";
import { ChevronsUpDown, Folder, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClient, useDaemon } from "../../lib/store";
import { EngineTile } from "../EngineTile";

type Pattern = "race" | "review";
type StartState = { run: () => void; valid: boolean; busy: boolean };

const MIN_RACE = 2;
const MAX_RACE = 4;

export function NewTeamSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (taskId: string) => void }) {
  const phone = useLayoutMode() === "phone";
  const [key, setKey] = useState(0);
  // A fresh form every time it opens.
  useEffect(() => {
    if (open) setKey((k) => k + 1);
  }, [open]);
  const [start, setStart] = useState<StartState>({ run: () => {}, valid: false, busy: false });
  const go = (
    <Button variant="accent" size={phone ? "lg" : "md"} block={phone} busy={start.busy} disabled={!start.valid} Icon={Users} onClick={start.run} className="rounded-full">
      Start team
    </Button>
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New team"
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
      {open && <NewTeam key={key} onDone={onDone} expose={setStart} />}
    </Sheet>
  );
}

function NewTeam({ onDone, expose }: { onDone: (id: string) => void; expose: (s: StartState) => void }) {
  const client = useClient();
  const phone = useLayoutMode() === "phone";
  const state = useDaemon((c) => c.state);
  const workspaces = (state?.workspaces ?? []).filter((w) => w.approved);
  const agents = (state?.profiles ?? []).filter((p) => p.engine !== "shell" && p.engine !== "install" && !p.id.startsWith("install:"));
  const fallback = state?.settings.default_profile && agents.some((a) => a.id === state.settings.default_profile) ? state.settings.default_profile : (agents[0]?.id ?? "claude");
  const [ws, setWs] = useState(workspaces[0]?.id ?? "");
  const [goal, setGoal] = useState("");
  const [pattern, setPattern] = useState<Pattern>("race");
  const [race, setRace] = useState<string[]>(() => [fallback, fallback]);
  const [pair, setPair] = useState<string[]>(() => [fallback, fallback]);
  const [check, setCheck] = useState("");
  const [busy, setBusy] = useState(false);

  const profiles = pattern === "race" ? race : pair;
  const setProfiles = pattern === "race" ? setRace : setPair;
  const valid = ws !== "" && goal.trim() !== "" && profiles.length >= (pattern === "race" ? MIN_RACE : 2);
  const wsName = workspaces.find((w) => w.id === ws)?.name;
  const patch = (i: number, id: string) => setProfiles((l) => l.map((p, j) => (j === i ? id : p)));

  const start = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const t = (await client.req({
        m: "neural_team_start",
        p: { workspace_id: ws, goal: goal.trim(), pattern, profiles, ...(check.trim() ? { check: check.trim() } : {}) },
      })) as NeuralTask;
      onDone(t.id);
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

  const slot = (i: number, title: string) => (
    <Row
      key={i}
      leading={<EngineTile engine={agents.find((a) => a.id === profiles[i])?.engine ?? "custom"} />}
      title={title}
      trailing={<AgentPicker agents={agents} value={profiles[i]!} onChange={(id) => patch(i, id)} />}
    />
  );

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
      </div>

      <List footer={workspaces.length === 0 ? "Approve a workspace first: it is where the team works." : undefined}>
        <Menu
          title="Workspace"
          align="start"
          block
          items={workspaces.map((w) => ({ label: w.name, Icon: Folder, checked: w.id === ws, onSelect: () => setWs(w.id) }))}
          trigger={(show) => <Row Icon={Folder} title="Workspace" value={wsName ?? (workspaces.length ? "Pick one" : "None yet")} chevron onClick={show} />}
        />
      </List>

      <Field label="Pattern" hint={pattern === "race" ? "Several agents try the same goal in separate worktrees. You pick the best." : "A builder writes it, a reviewer checks it, until the reviewer approves."}>
        <Segmented
          className="w-full"
          value={pattern}
          onChange={setPattern}
          options={[
            { value: "race", label: "Race" },
            { value: "review", label: "Build + review" },
          ]}
        />
      </Field>

      <List
        label="Agents"
        footer={pattern === "race" ? `${MIN_RACE} to ${MAX_RACE} agents.` : undefined}
        action={
          pattern === "race" ? (
            <span className="flex gap-1">
              <Button size="sm" variant="quiet" disabled={race.length <= MIN_RACE} onClick={() => setRace((l) => l.slice(0, -1))}>
                Fewer
              </Button>
              <Button size="sm" variant="quiet" disabled={race.length >= MAX_RACE} onClick={() => setRace((l) => [...l, fallback])}>
                More
              </Button>
            </span>
          ) : undefined
        }
      >
        {pattern === "race" ? race.map((_, i) => slot(i, `Attempt ${i + 1}`)) : [slot(0, "Builder"), slot(1, "Reviewer")]}
      </List>

      <Field label="Check command (optional)" hint="Runs in each worktree when an agent finishes.">
        <Input value={check} onChange={(e) => setCheck(e.target.value)} placeholder="pnpm test" aria-label="Check command" />
      </Field>
    </div>
  );
}

/** The agent of a slot: its name, and a list of agents (an action sheet on phones). */
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
