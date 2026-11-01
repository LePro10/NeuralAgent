// Files explorer: what you can do with a file or folder (the long-press / right-click menu and the
// viewer's "More" menu): copy its path, send it to an agent, open it on the computer, show it in
// Finder, or bring it to this device (download / share).
import type { FileEntry, Session } from "@neuralagent/protocol";
import { ActionSheet, type MenuEntry, toast } from "@neuralagent/ui";
import { Copy, Download, ExternalLink, FolderSearch, Send, Share } from "lucide-react";
import { useState, type ReactNode } from "react";
import { writeClipboard } from "../../lib/clipboard";
import { useClient, useDaemon, usePlatform } from "../../lib/store";
import { useClaudeChat } from "../workspace/ClaudeViewSwitch";
import { Aborted, giveToDevice, readWhole } from "./api";
import { formatSize } from "./model";
import { agentsFor, sendPathTo } from "./send";

/** Reads the whole file (reporting progress); stops asking for pieces once `signal` aborts. */
export type Fetch = (onProgress?: (done: number, total: number) => void, signal?: AbortSignal) => Promise<Blob>;

export interface FileActions {
  /** Menu entries for an entry; `fetch` reuses a blob the viewer already has. */
  menu: (e: Pick<FileEntry, "path" | "name" | "dir" | "size">, fetch?: Fetch) => MenuEntry[];
  copyPath: (path: string) => void;
  sendToAgent: (path: string) => void;
  give: (e: Pick<FileEntry, "path" | "name" | "size">, fetch?: Fetch) => void;
  /** Render once (the agent picker). */
  sheet: ReactNode;
}

export function useFileActions({ workspaceId, phone, onSent }: { workspaceId?: string; phone: boolean; onSent?: (sid: string) => void }): FileActions {
  const client = useClient();
  const platform = usePlatform();
  const appChat = useClaudeChat(phone);
  const agents = useDaemon((c) => c.state);
  const profiles = useDaemon((c) => c.state?.profiles);
  const [picking, setPicking] = useState<string | null>(null);
  const live = agentsFor(agents, workspaceId);
  const local = platform.kind === "desktop";
  const share = !!platform.shareFile || (phone && typeof navigator !== "undefined" && "share" in navigator);

  const copyPath = (path: string) =>
    void writeClipboard(path, platform).then((ok) => toast(ok ? "Path copied" : "Could not copy the path", ok ? undefined : { tone: "danger" }));

  const send = async (s: Session, path: string) => {
    try {
      const where = await sendPathTo(client, s, profiles, path, { appChat, phone });
      toast(where === "composer" ? `Added to your message for ${s.title}` : `Typed into ${s.title}`, { tone: "success" });
      onSent?.(s.id);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };
  const sendToAgent = (path: string) => {
    if (live.length === 0) return void toast("No agent runs in this project", { tone: "neutral" });
    if (live.length === 1) return void send(live[0]!, path);
    setPicking(path);
  };

  const give = (e: Pick<FileEntry, "path" | "name" | "size">, fetch?: Fetch) => {
    // A long download can be stopped: no more pieces are asked for.
    const ac = new AbortController();
    const stop = { undo: () => ac.abort(), actionLabel: "Cancel", tone: "loading" as const, duration: 600_000 };
    const t = e.size > 512 * 1024 ? toast(`Loading ${e.name}…`, stop) : null;
    const progress = (done: number, total: number) => !ac.signal.aborted && t?.update(`Loading ${e.name}… ${formatSize(done)} of ${formatSize(total)}`, stop);
    (fetch ? fetch(progress, ac.signal) : readWhole(client, e.path, { onProgress: progress, signal: ac.signal }).then((r) => r.blob))
      .then((blob) => {
        if (ac.signal.aborted) throw new Aborted();
        return giveToDevice(platform, blob, e.name);
      })
      .then(
        (how) => (t ? t.update(how === "shared" ? "Ready" : `${e.name} downloaded`, { tone: "success" }) : how === "downloaded" && toast(`${e.name} downloaded`, { tone: "success" })),
        (err: Error) => {
          if (err instanceof Aborted || ac.signal.aborted) return void toast("Download stopped", { tone: "neutral" });
          if (t) t.update(err.message, { tone: "danger" });
          else toast(err.message, { tone: "danger" });
        },
      );
  };

  const menu: FileActions["menu"] = (e, fetch) => {
    const out: MenuEntry[] = [];
    if (local && platform.openPath && !e.dir) {
      out.push({ label: "Open in default app", Icon: ExternalLink, onSelect: () => void platform.openPath!(e.path).catch((err: Error) => toast(err.message, { tone: "danger" })) });
    }
    if (local && platform.revealPath) {
      out.push({ label: "Show in Finder", Icon: FolderSearch, onSelect: () => void platform.revealPath!(e.path).catch((err: Error) => toast(err.message, { tone: "danger" })) });
    }
    if (!local && !e.dir) {
      out.push({ label: share ? "Share or save…" : "Download", Icon: share ? Share : Download, onSelect: () => give(e, fetch) });
    }
    out.push({ label: "Copy path", Icon: Copy, divider: out.length > 0, onSelect: () => copyPath(e.path) });
    out.push({ label: "Send to agent", Icon: Send, detail: live.length === 1 ? live[0]!.title : undefined, disabled: live.length === 0, onSelect: () => sendToAgent(e.path) });
    return out;
  };

  const sheet = (
    <ActionSheet
      open={!!picking}
      onClose={() => setPicking(null)}
      title="Send to which agent?"
      message="The path goes into its next message; you add the words."
      items={live.map((s) => ({ id: s.id, label: s.title, detail: s.status === "waiting" ? "Waiting for you" : undefined, onSelect: () => picking && void send(s, picking) }))}
    />
  );
  return { menu, copyPath, sendToAgent, give, sheet };
}
