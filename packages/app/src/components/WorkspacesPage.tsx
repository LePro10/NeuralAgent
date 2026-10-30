// Phones: the "Workspaces" tab — every project folder as a row (status at a glance), and Add workspace.
// Opening one pushes its WorkspaceView; back returns here.
import type { Workspace } from "@neuralagent/protocol";
import { Button, Empty, IconButton, List, Page, Row, type SysColor } from "@neuralagent/ui";
import { Folder, FolderGit2, FolderPlus, Plus } from "lucide-react";
import { STATUS, activityOf, mostUrgent } from "../lib/status";
import { useDaemon } from "../lib/store";

const TILES: SysColor[] = ["blue", "orange", "purple", "teal", "pink", "indigo", "green"];

export function WorkspacesPage({ workspaces, onOpen, onAdd }: { workspaces: Workspace[]; onOpen: (id: string) => void; onAdd: () => void }) {
  const sessions = useDaemon((c) => c.state?.sessions);
  const add = <IconButton label="Add workspace" variant="ghost" onClick={onAdd}><Plus /></IconButton>;
  return (
    <Page title="Workspaces" actions={add}>
      {workspaces.length === 0 ? (
        <Empty
          Icon={FolderPlus}
          title="Add a workspace"
          detail="A workspace is a project folder. Agents you start there run in panes and keep running when you close the app."
          action={<Button variant="accent" Icon={FolderPlus} onClick={onAdd}>Add workspace</Button>}
        />
      ) : (
        <div className="flex flex-col gap-7">
          <List>
            {workspaces.map((w, i) => {
              const own = Object.values(sessions ?? {}).filter((s) => s.workspace_id === w.id);
              const alive = own.filter((s) => s.alive).length;
              const urgent = mostUrgent(own.map((s) => s.status));
              const st = urgent ? STATUS[urgent] : undefined;
              return (
                <Row
                  key={w.id}
                  Icon={w.git ? FolderGit2 : Folder}
                  tile={TILES[i % TILES.length]}
                  activity={activityOf(own.map((s) => s.status))}
                  title={w.name}
                  value={w.git ? (w.git.changed ? `${w.git.branch} · ${w.git.changed}` : w.git.branch) : undefined}
                  detail={alive ? `${alive} ${alive === 1 ? "agent" : "agents"}${st ? ` · ${st.label}` : ""}` : "No agents running"}
                  chevron
                  onClick={() => onOpen(w.id)}
                />
              );
            })}
          </List>
          <List>
            <Row Icon={FolderPlus} tile="green" title="Add workspace" onClick={onAdd} />
          </List>
        </div>
      )}
    </Page>
  );
}
