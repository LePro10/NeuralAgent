import type { SshHost, SshKnown, Workspace } from "@neuralagent/protocol";
import { Button, Field, Input, List, Row, Sheet, toast } from "@neuralagent/ui";
import { Folder, Plus, Server } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import type { Platform } from "../lib/platform";
import { useClient, useDaemon, usePlatform } from "../lib/store";
import { pickHostFolder, sameHost, sshLabel } from "./FolderBrowser";

type Client = ReturnType<typeof useClient>;
/** `"local"`: a folder on the host; a host: a folder on that computer (over SSH); null: closed. */
type Target = "local" | SshHost | null;

const useChooser = create<{ resolve: ((t: Target) => void) | null }>(() => ({ resolve: null }));

function choose(): Promise<Target> {
  useChooser.getState().resolve?.(null);
  return new Promise((resolve) => useChooser.setState({ resolve }));
}

/** Parses `user@host:port` (or just a host name, e.g. an alias from ~/.ssh/config). */
export function parseHost(text: string): SshHost | null {
  const m = /^(?:([^@\s]+)@)?([^:@\s]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i.exec(text.trim());
  if (!m) return null;
  const port = m[3] ? Number(m[3]) : undefined;
  if (port !== undefined && (port < 1 || port > 65535)) return null;
  return { host: m[2], ...(m[1] && { user: m[1] }), ...(port && { port }) };
}

/** Add workspace: asks where (this computer or an SSH host), then which folder, then adds it. */
export async function addWorkspaceFlow(client: Client, platform: Platform): Promise<Workspace | null> {
  const target = await choose();
  if (!target) return null;
  const ssh = target === "local" ? undefined : target;
  // Computers use the system dialog for their own folders; everything else browses through the daemon.
  const path = await (ssh ? pickHostFolder(ssh) : (platform.pickFolder ?? pickHostFolder)());
  if (!path) return null;
  try {
    return (await client.req({ m: "workspace_add", p: ssh ? { path, ssh, unchecked: true } : { path } })) as Workspace;
  } catch (e) {
    toast((e as Error).message, { tone: "danger" });
    return null;
  }
}

/** Another folder for an existing workspace (the right-click "Change folder…"). */
export async function changeFolderFlow(client: Client, platform: Platform, w: Workspace): Promise<void> {
  const path = await (w.ssh ? pickHostFolder(w.ssh) : (platform.pickFolder ?? pickHostFolder)());
  if (!path || path === w.path) return;
  try {
    await client.req({ m: "workspace_update", p: { id: w.id, path } });
    toast("Folder changed. Agents already running stay where they are.");
  } catch (e) {
    toast((e as Error).message, { tone: "danger" });
  }
}

export function AddWorkspaceSheet() {
  const resolve = useChooser((s) => s.resolve);
  const client = useClient();
  const platform = usePlatform();
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const open = resolve !== null;
  const [known, setKnown] = useState<SshKnown[]>([]);
  const [text, setText] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText("");
    setShowForm(false);
    client.req<SshKnown[]>({ m: "ssh_hosts" }).then(setKnown, () => setKnown([]));
  }, [open, client]);

  // Hosts used before come first, then the ones from ~/.ssh/config.
  const hosts = useMemo(() => {
    const out: { host: SshHost; detail?: string }[] = [];
    for (const w of workspaces ?? []) if (w.ssh && !out.some((o) => sameHost(o.host, w.ssh))) out.push({ host: w.ssh });
    for (const k of known) {
      const h: SshHost = { host: k.alias };
      if (!out.some((o) => sameHost(o.host, h))) out.push({ host: h, detail: [k.user && `${k.user}@`, k.hostname ?? ""].join("") || undefined });
    }
    return out;
  }, [workspaces, known]);

  const done = (t: Target) => {
    resolve?.(t);
    useChooser.setState({ resolve: null });
  };
  const parsed = parseHost(text);
  const connect = () => parsed && done(parsed);

  return (
    <Sheet open={open} onClose={() => done(null)} title="Add workspace" eyebrow="Where is the project?" desktop="dialog">
      <div className="flex flex-col gap-4 pb-4">
        <List label="Where">
          <Row Icon={Folder} tile="blue" title="This computer" detail={platform.pickFolder ? "Pick a folder" : "Browse the host's folders"} onClick={() => done("local")} />
        </List>
        <List label="Other computers (SSH)">
          {hosts.map((h) => (
            <Row key={sshLabel(h.host)} Icon={Server} tile="green" title={sshLabel(h.host)} detail={h.detail} onClick={() => done(h.host)} />
          ))}
          {!showForm && <Row Icon={Plus} tile="gray" title="New SSH connection" detail="user@host, or a name from ~/.ssh/config" chevron={false} onClick={() => setShowForm(true)} />}
          {showForm && (
            <div className="flex flex-col gap-3 px-4 py-3">
              <Field label="Host" hint="Examples: me@192.168.1.20, devbox, root@server.com:2222">
                <Input autoFocus value={text} onChange={(e) => setText(e.currentTarget.value)} placeholder="user@host" autoCapitalize="none" autoCorrect="off" spellCheck={false} onKeyDown={(e) => e.key === "Enter" && connect()} />
              </Field>
              <Button variant="primary" disabled={!parsed} onClick={connect}>
                Choose folder
              </Button>
            </div>
          )}
        </List>
        <p className="px-1 text-footnote text-dim">
          NeuralAgent connects with your normal ssh, so your keys and ~/.ssh/config apply. No ports to open, nothing to install there. A phone adds hosts the same way: the computer at home does the connecting.
        </p>
      </div>
    </Sheet>
  );
}
