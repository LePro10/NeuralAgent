import type { McpServer } from "@neuralagent/protocol";
import { Button, ConfirmButton, Empty, Field, Input, List, Page, Row, Segmented, Sheet, Switch, toast } from "@neuralagent/ui";
import { Download, Pencil, Plug, Plus, X } from "lucide-react";
import { useState } from "react";
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
  const servers = useDaemon((c) => c.state?.mcp ?? []);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [importing, setImporting] = useState(false);

  const toggle = async (s: McpServer, enabled: boolean) => {
    try {
      await client.req({ m: "mcp_save", p: { server: { ...s, enabled }, values: {} } });
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };

  const importAll = async () => {
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

  return (
    <Page title="MCP servers" eyebrow="Tools">
      <div className="flex flex-col gap-4 pb-8">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" Icon={Plus} onClick={() => setEditing("new")}>
            Add server
          </Button>
          <Button size="sm" variant="quiet" Icon={Download} busy={importing} onClick={() => void importAll()}>
            Import from Claude Code &amp; Codex
          </Button>
        </div>
        {servers.length === 0 ? (
          <Empty Icon={Plug} title="No MCP servers" detail="Add one, or import the ones you already use in Claude Code and Codex." />
        ) : (
          <List footer="Every Claude Code, Codex and OpenCode agent started here gets these servers. Secret values stay on this computer and reach agents only through their environment.">
            {servers.map((s) => (
              <Row
                key={s.id}
                Icon={Plug}
                title={s.id}
                detail={<span className="block truncate">{s.transport.type === "stdio" ? `${s.transport.command} ${joinArgs(s.transport.args)}`.trim() : s.transport.url}</span>}
                trailing={
                  // A clickable row is a button itself, so editing gets its own button next to the switch.
                  <div className="flex items-center gap-1">
                    <Button size="xs" variant="ghost" Icon={Pencil} aria-label={`Edit ${s.id}`} onClick={() => setEditing(s)} />
                    <Switch checked={s.enabled} onChange={(v) => void toggle(s, v)} label={`${s.id} enabled`} size="sm" />
                  </div>
                }
              />
            ))}
          </List>
        )}
      </div>
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add server" : (editing?.id ?? "")} size="lg">
        {editing && <McpEditor key={editing === "new" ? "new" : editing.id} server={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </Page>
  );
}

function McpEditor({ server, onDone }: { server: McpServer | null; onDone: () => void }) {
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

  const remove = async () => {
    try {
      await client.req({ m: "mcp_delete", p: { id } });
      onDone();
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      <Field label="Name" error={clash ? "A server with this name exists." : id !== "" && !nameOk ? "Letters, digits, - and _ only, up to 48." : undefined}>
        <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="github" readOnly={existing} autoFocus={!existing} invalid={id !== "" && !nameOk} />
      </Field>
      <Field label="Type">
        <Segmented
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
              <Button size="xs" variant="ghost" Icon={X} aria-label="Remove" onClick={() => setSecrets((all) => all.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div>
            <Button size="xs" variant="quiet" Icon={Plus} onClick={() => setSecrets((all) => [...all, { name: "", value: "", kept: false }])}>
              Add {type === "stdio" ? "variable" : "header"}
            </Button>
          </div>
        </div>
      </Field>
      <div className="flex items-center justify-between gap-2 pt-2">
        {existing ? <ConfirmButton label="Delete" onConfirm={remove} /> : <span />}
        <Button busy={busy} disabled={!valid} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}
