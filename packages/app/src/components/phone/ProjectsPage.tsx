// Phones: the Projects tab (every project folder on the computer, status at a glance) and one
// project's page: its agents, a new agent, its git changes, its past conversations.
import type { Workspace } from "@neuralagent/protocol";
import { Button, ConfirmSheet, Empty, IconButton, List, Menu, Page, Row, toast, type MenuEntry } from "@neuralagent/ui";
import { Copy, Ellipsis, FileDiff, Folder, FolderGit2, FolderOpen, FolderPlus, History, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { writeClipboard } from "../../lib/clipboard";
import { phoneRouter, usePhoneNav } from "../../lib/phoneRoute";
import { STATUS, activityOf, mostUrgent } from "../../lib/status";
import { useChanges, useClient, useDaemon, usePlatform } from "../../lib/store";
import { HomeFolderRow } from "../files/HomeAccess";
import { useFilesSupported } from "../files/support";
import { pickHostFolder } from "../FolderBrowser";
import { InboxSections, inboxEyebrow, useInbox } from "./AgentsInbox";
import { NewSheet } from "./NewSheet";
import { useHasState, Waiting } from "./Waiting";

function useWorkspaces(): Workspace[] {
  const all = useDaemon((c) => c.state?.workspaces);
  return useMemo(() => [...(all ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order), [all]);
}

/** Phones and browsers browse the computer's folders; adds the project and opens it. */
function useAddProject() {
  const client = useClient();
  const platform = usePlatform();
  return async () => {
    const path = await (platform.pickFolder ?? pickHostFolder)();
    if (!path) return;
    try {
      const w = (await client.req({ m: "workspace_add", p: { path } })) as Workspace;
      phoneRouter().push({ k: "project", id: w.id });
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };
}

const gitLine = (w: Workspace) => (w.git ? (w.git.changed ? `${w.git.branch} · ${w.git.changed} changed` : w.git.branch) : undefined);

export function ProjectsPage() {
  const workspaces = useWorkspaces();
  const sessions = useDaemon((c) => c.state?.sessions);
  const retap = usePhoneNav((s) => (s.tab === "projects" ? s.retap : 0));
  const add = useAddProject();
  const loaded = useHasState();
  return (
    <Page
      title="Projects"
      eyebrow={workspaces.length ? `${workspaces.length} ${workspaces.length === 1 ? "folder" : "folders"}` : undefined}
      scrollTopKey={retap}
      actions={
        <IconButton label="Add project folder" variant="glass" onClick={() => void add()}>
          <Plus />
        </IconButton>
      }
    >
      {!loaded ? (
        <Waiting />
      ) : workspaces.length === 0 ? (
        <Empty
          Icon={FolderPlus}
          title="Add a project"
          detail="A project is a folder on your computer. Agents you start there keep running when you put the phone away."
          action={
            <Button variant="accent" Icon={FolderPlus} onClick={() => void add()}>
              Add project folder
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-7">
          <List>
            {workspaces.map((w) => {
              const own = Object.values(sessions ?? {}).filter((s) => s.workspace_id === w.id);
              const alive = own.filter((s) => s.alive).length;
              const urgent = mostUrgent(own.filter((s) => s.alive || s.status === "error").map((s) => s.status));
              return (
                <Row
                  key={w.id}
                  Icon={w.git ? FolderGit2 : Folder}
                  activity={activityOf(own.map((s) => s.status))}
                  title={w.name}
                  detail={[gitLine(w), alive ? `${alive} ${alive === 1 ? "agent" : "agents"}` : "No agents"].filter(Boolean).join(" · ")}
                  value={urgent === "waiting" || urgent === "error" ? STATUS[urgent].label : undefined}
                  chevron
                  onClick={() => phoneRouter().push({ k: "project", id: w.id })}
                />
              );
            })}
          </List>
          <List>
            <Row Icon={FolderPlus} title="Add project folder" onClick={() => void add()} />
            <HomeFolderRow />
          </List>
        </div>
      )}
    </Page>
  );
}

export function ProjectPage({ id }: { id: string }) {
  const client = useClient();
  const platform = usePlatform();
  const w = useDaemon((c) => c.state?.workspaces.find((x) => x.id === id));
  const inbox = useInbox(id);
  const showChanges = useChanges((c) => c.show);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const loaded = useHasState();
  const files = useFilesSupported();
  if (!w) {
    return (
      <Page title="Project">
        {!loaded ? <Waiting /> : <Empty Icon={Folder} title="This project is gone" detail="It was removed on the computer." />}
      </Page>
    );
  }
  const update = (p: { pinned?: boolean }) => client.req({ m: "workspace_update", p: { id: w.id, ...p } }).catch((e) => toast((e as Error).message, { tone: "danger" }));
  const menu: MenuEntry[] = [
    { label: w.pinned ? "Unpin" : "Pin to top", Icon: w.pinned ? PinOff : Pin, onSelect: () => void update({ pinned: !w.pinned }) },
    { label: "Copy folder path", Icon: Copy, onSelect: () => void writeClipboard(w.path, platform).then((ok) => toast(ok ? "Path copied" : "Could not copy the path", ok ? undefined : { tone: "danger" })) },
    { label: "Remove…", Icon: Trash2, destructive: true, divider: true, onSelect: () => setRemoving(true) },
  ];
  return (
    <>
      <Page
        title={w.name}
        eyebrow={gitLine(w) ?? inboxEyebrow(inbox)}
        actions={
          <>
            <IconButton label="New agent" variant="glass" onClick={() => setAdding(true)}>
              <Plus />
            </IconButton>
            <Menu
              title={w.name}
              items={menu}
              trigger={(show) => (
                <IconButton label={`More for ${w.name}`} variant="glass" onClick={show}>
                  <Ellipsis />
                </IconButton>
              )}
            />
          </>
        }
      >
        <div className="flex flex-col gap-7">
          <InboxSections
            inbox={inbox}
            showProject={false}
            empty={
              <List footer="Agents work inside this folder and keep running on the computer.">
                <Row Icon={Plus} title="New agent" onClick={() => setAdding(true)} />
              </List>
            }
          />
          <List>
            {inbox.counts.all > 0 && <Row Icon={Plus} title="New agent" onClick={() => setAdding(true)} />}
            {files && (w.approved || platform.kind === "desktop") && <Row Icon={FolderOpen} title="Files" onClick={() => phoneRouter().push({ k: "files", ws: w.id })} />}
            {w.git && <Row Icon={FileDiff} title="Changes" value={w.git.changed ? String(w.git.changed) : "None"} onClick={() => showChanges(w.id)} />}
            <Row Icon={History} title="Past conversations" onClick={() => phoneRouter().push({ k: "history", project: w.id })} />
          </List>
          <p className="truncate px-4 text-footnote text-faint">{w.path}</p>
        </div>
      </Page>
      <NewSheet open={adding} onClose={() => setAdding(false)} workspaceId={w.id} />
      <ConfirmSheet
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={async () => {
          await client.req({ m: "workspace_remove", p: { id: w.id } }).then(
            () => phoneRouter().back(),
            (e) => void toast((e as Error).message, { tone: "danger" }),
          );
        }}
        title={`Remove ${w.name}?`}
        message="It leaves NeuralAgent and its agents stop; the folder and its files stay on the computer."
        confirmLabel="Remove"
        destructive
        Icon={Trash2}
      />
    </>
  );
}
