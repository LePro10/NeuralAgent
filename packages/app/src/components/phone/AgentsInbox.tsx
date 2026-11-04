// Phones: the Agents tab, the app's home. Every agent across all projects, sorted by what it needs
// from you: "Needs you" (answer it right in the row), "Working", "Done".
import type { Session } from "@neuralagent/protocol";
import { Button, ConfirmSheet, Empty, IconButton, List, Page, Row, toast } from "@neuralagent/ui";
import { Bot, Download, History, Plane, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { buildInbox, type Inbox, type InboxItem } from "../../lib/inbox";
import { useOpenAgent } from "../../lib/openAgent";
import { phoneRouter, usePhoneNav } from "../../lib/phoneRoute";
import { useNow } from "../../lib/agentui";
import { attentionCount } from "../../lib/autopilot";
import { useAutopilotSupported } from "../autopilot/hooks";
import { useCatalogSheet, useClient, useDaemon } from "../../lib/store";
import { AgentInboxRow, LIVE_ANSWERS } from "./rows";
import { NewSheet } from "./NewSheet";
import { useHasState, Waiting } from "./Waiting";

/** The inbox for the badge and the screens (all projects, or one). */
export function useInbox(project?: string): Inbox {
  const sessions = useDaemon((c) => c.state?.sessions);
  const profiles = useDaemon((c) => c.state?.profiles);
  return useMemo(() => buildInbox(sessions, profiles, { project }), [sessions, profiles, project]);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "7 agents · 2 need you". */
export function inboxEyebrow(i: Inbox): string {
  if (!i.counts.all) return "No agents";
  return [plural(i.counts.all, "agent"), i.counts.needs ? `${i.counts.needs} need${i.counts.needs === 1 ? "s" : ""} you` : i.counts.working ? `${i.counts.working} working` : ""].filter(Boolean).join(" · ");
}

export function AgentsInbox() {
  const inbox = useInbox();
  const loaded = useHasState();
  const retap = usePhoneNav((s) => (s.tab === "agents" ? s.retap : 0));
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const [adding, setAdding] = useState(false);
  const autopilot = useAutopilotSupported();
  const attention = useDaemon((c) => attentionCount(c.state?.autopilot));
  const add = (
    <IconButton label="New agent" variant="glass" onClick={() => setAdding(true)}>
      <Plus />
    </IconButton>
  );
  return (
    <>
      <Page title="Agents" eyebrow={loaded ? inboxEyebrow(inbox) : undefined} actions={add} scrollTopKey={retap}>
        {!loaded ? (
          <Waiting />
        ) : inbox.counts.all === 0 ? (
          <Empty
            Icon={Bot}
            title="No agents yet"
            detail="Start one in a project; it keeps running on your computer when you put the phone away."
            action={
              <div className="flex flex-col items-center gap-2">
                <Button variant="accent" Icon={Plus} onClick={() => setAdding(true)}>
                  New agent
                </Button>
                <Button variant="ghost" Icon={Download} onClick={() => openCatalog(true)}>
                  Install agents
                </Button>
              </div>
            }
          />
        ) : (
          <InboxSections inbox={inbox} />
        )}
        <div className="mt-7">
          <List>
            {autopilot && <Row Icon={Plane} title="Autopilot" detail="A project agent with its inbox" value={attention > 0 ? String(attention) : undefined} onClick={() => phoneRouter().push({ k: "autopilot" })} />}
            <Row Icon={History} title="History" detail="Past conversations on this computer" onClick={() => phoneRouter().push({ k: "history" })} />
          </List>
        </div>
      </Page>
      <NewSheet open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

/** The three sections; shared by the inbox and a project's page. */
export function InboxSections({ inbox, showProject = true, empty }: { inbox: Inbox; showProject?: boolean; empty?: ReactNode }) {
  const client = useClient();
  const profiles = useDaemon((c) => c.state?.profiles);
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const openAgent = useOpenAgent();
  const now = useNow(15000);
  const [closing, setClosing] = useState<Session | null>(null);
  const engineOf = (s: Session) => profiles?.find((p) => p.id === s.profile_id)?.engine ?? "shell";
  const projectOf = (id: string) => (showProject ? workspaces?.find((w) => w.id === id)?.name : undefined);
  let live = 0;
  const row = (i: InboxItem) => (
    <AgentInboxRow
      key={i.id}
      s={i.s}
      engine={engineOf(i.s)}
      project={projectOf(i.s.workspace_id)}
      now={now}
      live={i.s.status === "waiting" && live++ < LIVE_ANSWERS}
      onOpen={() => openAgent(i.s.id)}
      onClose={() => setClosing(i.s)}
    />
  );
  const sections: [string, InboxItem[]][] = [
    ["Needs you", inbox.needs],
    ["Working", inbox.working],
    ["Done", inbox.done],
  ];
  const shown = sections.filter(([, items]) => items.length);
  return (
    <>
      {shown.length === 0 && empty}
      <div className="flex flex-col gap-7">
        {shown.map(([label, items]) => (
          <List key={label} label={label}>
            {items.map(row)}
          </List>
        ))}
      </div>
      <ConfirmSheet
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={`Close “${closing?.title ?? ""}”?`}
        message="The agent stops and its pane closes. Its conversation stays in History."
        confirmLabel="Close agent"
        destructive
        Icon={Trash2}
        onConfirm={() => (closing ? client.req({ m: "session_close", p: { id: closing.id } }).then(() => {}, (e) => void toast((e as Error).message, { tone: "danger" })) : undefined)}
      />
    </>
  );
}
