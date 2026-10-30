import type { McpServer } from "@neuralagent/protocol";
import { Button, ConfirmSheet, Empty, Field, IconButton, Input, List, Page, Row, Segmented, Sheet, Spinner, Switch, toast, useLayoutMode } from "@neuralagent/ui";
import { Download, Plug, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { joinArgs, splitArgs } from "../lib/profiles";
import { useClient, useDaemon } from "../lib/store";

const NAME = /^[A-Za-z0-9_-]{1,48}$/;

/** One secret row in the editor: a name and a value; `kept` marks a stored value that stays unless retyped. */
interface Secret {
  name: string;
  value: string;
  kept: boolean;
}

/** MCP servers every agent started here gets; secret values live in the daemon and never come back. */
export function McpPage() {
  const client = useClient();
  const phone = useLayoutMode() === "phone";
  const servers = useDaemon((c) => c.state?.mcp ?? []);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [save, setSave] = useState<Submit>(IDLE);

  const toggle = async (s: McpServer, enabled: boolean) => {
    try {
      await client.req({ m: "mcp_save", p: { server: { ...s, enabled }, values: {} } });
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };

  const importAll = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const n = (await client.req({ m: "mcp_import" })) as number;
      toast(n > 0 ? `Imported ${n} ${n === 1 ? "server" : "servers"}` : "Nothing new to import");
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setImporting(false);
    }
  };

  const add = phone ? (
    <IconButton label="Add server" variant="ghost" onClick={() => setEditing("new")}>
      <Plus />
    </IconButton>
  ) : (
    <Button size="sm" variant="accent" Icon={Plus} onClick={() => setEditing("new")} className="rounded-full">
      Add server
    </Button>
  );
  const importRow = (
    <Row Icon={Download} title="Import from Claude Code & Codex" detail="Copies the servers you already use there" onClick={() => void importAll()} trailing={importing ? <Spinner size={16} /> : undefined} chevron={!importing} />
  );

  return (
    <div className="relative h-full">
      <Page title="MCP servers" actions={add}>
        <div className="flex flex-col gap-7 pb-8">
          {servers.length === 0 ? (
            <>
              <Empty
                Icon={Plug}
                title="No MCP servers"
                detail="Servers give your agents tools: GitHub, a browser, your issue tracker. Add one, or import the ones you already use."
                action={
                  <Button variant="accent" Icon={Plus} onClick={() => setEditing("new")} className="rounded-full">
                    Add server
                  </Button>
                }
              />
              <List>{importRow}</List>
            </>
          ) : (
            <>
              <List label="Servers" footer="Every Claude Code, Codex and OpenCode agent started here gets the servers that are on. Secret values stay on this computer and reach agents only through their environment.">
                {servers.map((s) => (
                  <div key={s.id} data-lead="" className="flex items-center">
                    <button type="button" onClick={() => setEditing(s)} className="press-row flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left hover:bg-fill-1" aria-label={`Edit ${s.id}`}>
                      <span aria-hidden className={"grid size-icon-tile shrink-0 place-items-center rounded-tile bg-fill-3 " + (s.enabled ? "text-ink" : "text-faint")}>
                        <Plug strokeWidth={1.75} className="size-icon-sm" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-bright">{s.id}</span>
                        <span className="block truncate text-footnote text-dim">
                          {s.transport.type === "stdio" ? `${s.transport.command} ${joinArgs(s.transport.args)}`.trim() : s.transport.url}
                        </span>
                      </span>
                    </button>
                    <div className="shrink-0 pr-4 pl-3">
                      <Switch checked={s.enabled} onChange={(v) => void toggle(s, v)} label={`${s.id} on`} />
                    </div>
                  </div>
                ))}
              </List>
              <List>{importRow}</List>
            </>
          )}
        </div>
      </Page>
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add server" : (editing?.id ?? "")}
        size="lg"
        action={
          <Button size="sm" variant="accent" busy={save.busy} disabled={!save.valid} onClick={save.run} className="rounded-full">
            Save
          </Button>
        }
      >
        {editing && <McpEditor key={editing === "new" ? "new" : editing.id} server={editing === "new" ? null : editing} onDone={() => setEditing(null)} expose={setSave} />}
      </Sheet>
    </div>
  );
}

/** The editor's save state, shown by the sheet's Save button. */
interface Submit {
  run: () => void;
  valid: boolean;
  busy: boolean;
}
const IDLE: Submit = { run: () => {}, valid: false, busy: false };

function McpEditor({ server, onDone, expose }: { server: McpServer | null; onDone: () => void; expose: (s: Submit) => void }) {
  const client = useClient();
  const all = useDaemon((c) => c.state?.mcp);
  const existing = server !== null;
  const t = server?.transport;
  const [id, setId] = useState(server?.id ?? "");
  const [type, setType] = useState<"stdio" | "http">(t?.type ?? "stdio");
  const [command, setCommand] = useState(t?.type === "stdio" ? t.command : "");
  const [args, setArgs] = useState(t?.type === "stdio" ? joinArgs(t.args) : "");
  const [url, setUrl] = useState(t?.type === "http" ? t.url : "");
  const [secrets, setSecrets] = useState<Secret[]>((server?.secrets ?? []).map((name) => ({ name, value: "", kept: true })));
  const [busy, setBusy] = useState(false);

  const clash = !existing && !!all?.some((s) => s.id === id);
  const nameOk = NAME.test(id) && !clash;
  const valid = nameOk && (type === "stdio" ? command.trim() !== "" : url.trim() !== "");
  const patch = (i: number, p: Partial<Secret>) => setSecrets((all) => all.map((s, j) => (j === i ? { ...s, ...p } : s)));

  const save = async () => {
    setBusy(true);
    try {
      const rows = secrets.map((s) => ({ ...s, name: s.name.trim() })).filter((s) => s.name !== "");
      const values: Record<string, string> = {};
      for (const s of rows) if (s.value !== "") values[s.name] = s.value;
      const next: McpServer = {
        id,
        enabled: server?.enabled ?? true,
        transport: type === "stdio" ? { type: "stdio", command: command.trim(), args: splitArgs(args) } : { type: "http", url: url.trim() },
        secrets: [...new Set(rows.map((s) => s.name))],
      };
      await client.req({ m: "mcp_save", p: { server: next, values } });
      onDone();
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const run = useRef(save);
  run.current = save;
  useEffect(() => expose({ run: () => void run.current(), valid: valid && !busy, busy }), [valid, busy, expose]);
  const [confirm, setConfirm] = useState(false);

  const remove = async () => {
    try {
      await client.req({ m: "mcp_delete", p: { id } });
      onDone();
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };

  return (
    <div className="flex flex-col gap-5 pt-1 pb-4">
      <Field label="Name" error={clash ? "A server with this name exists." : id !== "" && !nameOk ? "Letters, digits, - and _ only, up to 48." : undefined}>
        <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="github" readOnly={existing} autoFocus={!existing} invalid={id !== "" && !nameOk} />
      </Field>
      <Field label="Type">
        <Segmented
          className="w-full"
          value={type}
          onChange={setType}
          options={[
            { value: "stdio", label: "Command" },
            { value: "http", label: "HTTP" },
          ]}
        />
      </Field>
      {type === "stdio" ? (
        <>
          <Field label="Command" hint="The program name or a full path.">
            <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
          </Field>
          <Field label="Arguments" hint={'Separated by spaces. Quote values with spaces: "two words".'}>
            <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-github" />
          </Field>
        </>
      ) : (
        <Field label="URL">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
        </Field>
      )}
      <Field label={type === "stdio" ? "Environment variables" : "Headers"} hint="Values are stored on this computer and never shown again.">
        <div className="flex flex-col gap-2">
          {secrets.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="flex-1" value={s.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder={type === "stdio" ? "GITHUB_TOKEN" : "Authorization"} readOnly={s.kept} aria-label="Name" />
              <Input className="flex-1" type="password" value={s.value} onChange={(e) => patch(i, { value: e.target.value })} placeholder={s.kept ? "unchanged" : "Value"} autoComplete="off" aria-label="Value" />
              <IconButton label="Remove" variant="ghost" size="sm" onClick={() => setSecrets((all) => all.filter((_, j) => j !== i))}>
                <X />
              </IconButton>
            </div>
          ))}
          <div>
            <Button size="xs" variant="quiet" Icon={Plus} onClick={() => setSecrets((all) => [...all, { name: "", value: "", kept: false }])}>
              Add {type === "stdio" ? "variable" : "header"}
            </Button>
          </div>
        </div>
      </Field>
      {existing && (
        <List className="mt-2">
          <Row Icon={Trash2} danger title="Delete server" onClick={() => setConfirm(true)} chevron={false} />
        </List>
      )}
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Delete “${id}”?`}
        message="Agents started from now on no longer get this server. Its stored secrets are deleted too."
        confirmLabel="Delete"
        destructive
        Icon={Trash2}
        onConfirm={remove}
      />
    </div>
  );
}
