// Phones: "+" on Agents or in a project. Pick the project and the agent, say what it should do
// (the first prompt goes along with the start), optionally its own worktree; Start opens the
// agent's screen. "New swarm" starts a team instead.
import type { Profile, Session, Workspace } from "@neuralagent/protocol";
import { Button, Chips, Field, List, Row, Sheet, Switch, TextArea, haptic, toast } from "@neuralagent/ui";
import { Download, FolderPlus, GitBranch, Play, Users } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useOpenAgent } from "../../lib/openAgent";
import { phoneRouter } from "../../lib/phoneRoute";
import { launchable } from "../../lib/profiles";
import { useCatalogSheet, useClient, useDaemon, usePlatform, useUi } from "../../lib/store";
import { useWorktreeStart } from "../../lib/worktree";
import { pickHostFolder } from "../FolderBrowser";
import { NewSwarmSheet } from "../swarm/NewSwarm";

const LAST = "neuralagent.newAgent";
type Last = { project?: string; profile?: string };
const readLast = (): Last => {
  try {
    return JSON.parse(localStorage.getItem(LAST) ?? "{}") as Last;
  } catch {
    return {};
  }
};
const writeLast = (l: Last) => {
  try {
    localStorage.setItem(LAST, JSON.stringify(l));
  } catch {
    // private mode
  }
};

/** A labelled row of chips (not a <label>: a tap on the words must not press the first chip). */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div className="mb-1.5 px-1 text-footnote text-dim">{label}</div>
      {children}
    </div>
  );
}

export function NewSheet({ open, onClose, workspaceId }: { open: boolean; onClose: () => void; workspaceId?: string }) {
  const client = useClient();
  const platform = usePlatform();
  const openAgent = useOpenAgent();
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const all = useDaemon((c) => c.state?.workspaces);
  const profiles = useDaemon((c) => c.state?.profiles);
  const catalog = useDaemon((c) => c.state?.catalog);
  const { worktrees, setWorktrees } = useUi();
  const workspaces = useMemo(() => [...(all ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order), [all]);
  // Agents first (the terminal last): this sheet is about agents.
  const agents = useMemo(() => {
    const list = launchable(profiles, catalog);
    return [...list.filter((p) => p.engine !== "shell"), ...list.filter((p) => p.engine === "shell")];
  }, [profiles, catalog]);

  const [project, setProject] = useState<string>("");
  const [profile, setProfile] = useState<string>("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [swarm, setSwarm] = useState(false);
  // A fresh form each time, on the project it was opened from (else the last one used).
  useEffect(() => {
    if (!open) return;
    const last = readLast();
    const has = (id?: string) => !!id && workspaces.some((w) => w.id === id);
    setProject(has(workspaceId) ? workspaceId! : has(last.project) ? last.project! : (workspaces[0]?.id ?? ""));
    setProfile(agents.some((p) => p.id === last.profile) ? last.profile! : (agents[0]?.id ?? ""));
    setText("");
  }, [open]);

  const ws = workspaces.find((w) => w.id === project);
  const chosen: Profile | undefined = agents.find((p) => p.id === profile);
  const worktree = useWorktreeStart(project);

  const addFolder = async () => {
    const path = await (platform.pickFolder ?? pickHostFolder)();
    if (!path) return;
    try {
      const w = (await client.req({ m: "workspace_add", p: { path } })) as Workspace;
      setProject(w.id);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };

  const start = async () => {
    if (!ws || !chosen) return;
    setBusy(true);
    haptic("select");
    try {
      const prompt = text.trim();
      const s = (await client.req({ m: "session_start", p: { workspace_id: ws.id, profile_id: chosen.id, ...(prompt && chosen.engine !== "shell" ? { prompt } : {}), ...worktree(chosen.engine) } })) as Session;
      writeLast({ project: ws.id, profile: chosen.id });
      onClose();
      openAgent(s.id);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        open={open && !swarm}
        onClose={onClose}
        title="New agent"
        eyebrow={ws?.name}
        action={
          <Button size="sm" variant="accent" Icon={Play} busy={busy} disabled={!ws || !chosen} onClick={() => void start()}>
            Start
          </Button>
        }
      >
        <div className="flex flex-col gap-6 pb-2">
          {workspaces.length === 0 ? (
            <List footer="A project is a folder on your computer. Agents work inside it.">
              <Row Icon={FolderPlus} title="Add a project folder" onClick={() => void addFolder()} />
            </List>
          ) : (
            <Group label="Project">
              <Chips
                value={project}
                onChange={setProject}
                options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
                lead={
                  <button type="button" aria-label="Add a project folder" onClick={() => void addFolder()} className="pressable grid size-control shrink-0 place-items-center rounded-full bg-fill-2 text-dim">
                    <FolderPlus className="size-icon-sm" />
                  </button>
                }
              />
            </Group>
          )}
          <Group label="Agent">
            <Chips value={profile} onChange={setProfile} options={agents.map((p) => ({ value: p.id, label: p.name }))} />
          </Group>
          {chosen?.engine !== "shell" && (
            <Field label="What should it do?" hint="Optional. Sent as the first prompt once the agent is ready.">
              <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="Fix the failing tests in api/" rows={3} maxRows={6} enterKeyHint="go" />
            </Field>
          )}
          <List footer={ws?.git && chosen?.engine !== "shell" ? "With its own worktree the agent works on its own branch in a separate folder; you review and merge its changes." : undefined}>
            {ws?.git && chosen?.engine !== "shell" && <Row Icon={GitBranch} title="Own worktree" trailing={<Switch label="Own worktree" checked={worktrees} onChange={setWorktrees} />} />}
            <Row Icon={Users} title="New swarm" detail="A team of agents on one goal" onClick={() => setSwarm(true)} />
            <Row
              Icon={Download}
              title="Install more agents"
              onClick={() => {
                onClose();
                openCatalog(true);
              }}
            />
          </List>
        </div>
      </Sheet>
      <NewSwarmSheet
        open={open && swarm}
        onClose={() => {
          setSwarm(false);
          onClose();
        }}
        onDone={(id) => {
          setSwarm(false);
          onClose();
          phoneRouter().push({ k: "swarm", id });
        }}
      />
    </>
  );
}
