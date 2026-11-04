// Autopilot → Connectors: a grid of what the autopilots can read and do. Built-in ones first, then
// the user's own. New connector (an agent builds it) and Add existing (an MCP server or a folder).
import type { Connector } from "@neuralagent/protocol";
import { Button, Empty, Field, IconButton, Input, Menu, Page, Segmented, Sheet, TextArea, toast, useLayoutMode } from "@neuralagent/ui";
import { FolderOpen, Plug, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { STATUS_LABEL, splitConnectors } from "../../lib/autopilot";
import { pickHostFolder } from "../FolderBrowser";
import { Glow } from "../Glow";
import { StatusMark, connectorIcon } from "./bits";
import { useApRequest, useAutopilot } from "./hooks";

export function ConnectorsPage({ onOpen, back }: { onOpen: (id: string) => void; back?: { label: string; onBack: () => void } }) {
  const { connectors } = useAutopilot();
  const { builtin, yours } = splitConnectors(connectors);
  const [sheet, setSheet] = useState<"new" | "existing" | null>(null);
  const phone = useLayoutMode() === "phone";
  const add = (
    <Menu
      title="Add a connector"
      width={280}
      items={[
        { label: "New connector…", detail: "Describe it, an agent builds it", Icon: Sparkles, onSelect: () => setSheet("new") },
        { label: "Add existing…", detail: "An MCP server or a folder", Icon: Plug, onSelect: () => setSheet("existing") },
      ]}
      trigger={(show) =>
        phone ? (
          <IconButton label="Add a connector" variant="glass" onClick={show}>
            <Plus />
          </IconButton>
        ) : (
          <Button size="sm" variant="accent" Icon={Plus} onClick={show} className="rounded-full">
            Add
          </Button>
        )
      }
    />
  );
  return (
    <div className="relative h-full">
      <Glow tint="mcp" />
      <Page title="Connectors" eyebrow="Autopilot" actions={add} wide backLabel={back?.label} onBack={back?.onBack}>
        <div className="flex flex-col gap-8 pt-2 pb-8">
          <p className="max-w-xl text-subhead text-dim">Connectors let an autopilot read your sources and act in them: Discord, GitHub, Reddit, your own app. You decide which one an autopilot may use and what it may do there.</p>
          <Grid label="Built in" list={builtin} onOpen={onOpen} />
          <Grid
            label="Yours"
            list={yours}
            onOpen={onOpen}
            empty={
              <Empty
                bare
                Icon={Sparkles}
                title="Make your own"
                detail="Tell us what you want to connect, for example “my app’s admin API”. A coding agent builds it for you."
                action={
                  <Button variant="accent" Icon={Plus} onClick={() => setSheet("new")} className="rounded-full">
                    New connector
                  </Button>
                }
              />
            }
          />
        </div>
      </Page>
      <NewConnectorSheet open={sheet === "new"} onClose={() => setSheet(null)} onCreated={(id) => (setSheet(null), onOpen(id))} />
      <ExistingSheet open={sheet === "existing"} onClose={() => setSheet(null)} onCreated={(id) => (setSheet(null), onOpen(id))} />
    </div>
  );
}

function Grid({ label, list, onOpen, empty }: { label: string; list: Connector[]; onOpen: (id: string) => void; empty?: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-footnote text-dim uppercase tracking-wide">{label}</h2>
      {list.length === 0 ? (
        empty && <div className="surface rounded-list">{empty}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
          {list.map((c) => (
            <ConnectorCard key={c.id} c={c} onOpen={() => onOpen(c.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectorCard({ c, onOpen }: { c: Connector; onOpen: () => void }) {
  const Icon = connectorIcon(c);
  return (
    <button type="button" onClick={onOpen} className="surface press-row flex min-h-24 items-start gap-3 rounded-list p-4 text-left hover:bg-fill-1">
      <span aria-hidden className="grid size-icon-tile shrink-0 place-items-center rounded-tile bg-fill-3 text-ink">
        <Icon className="size-icon-sm" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-headline text-bright">{c.manifest.name}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-footnote text-dim">
            <StatusMark status={c.status} />
            {STATUS_LABEL[c.status]}
          </span>
        </span>
        <span className="mt-1 line-clamp-2 block text-subhead text-dim">{c.manifest.description || "No description yet"}</span>
      </span>
    </button>
  );
}

function NewConnectorSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const req = useApRequest();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = name.trim() !== "" && description.trim().length >= 10;
  const create = async () => {
    setBusy(true);
    try {
      const c = await req<Connector | null>({ op: "connector_create", name: name.trim(), description: description.trim() });
      setName("");
      setDescription("");
      if (c?.id) onCreated(c.id);
      else onClose();
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="New connector" eyebrow="An agent builds it" size="md">
      <div className="flex flex-col gap-5 pb-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My app" autoFocus={false} />
        </Field>
        <Field label="What should it do?" hint="Say what it should read and what it may do. Mention where the key or login comes from if you know it.">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} maxRows={8} placeholder="Read new support requests from my app’s admin API and let me answer them." />
        </Field>
        <p className="text-footnote text-dim">A coding agent writes the connector in a new folder and tests it. You can watch it work, and ask for changes later.</p>
        <Button size="lg" variant="accent" busy={busy} disabled={!ok} onClick={() => void create()} block>
          Build it
        </Button>
      </div>
    </Sheet>
  );
}

function ExistingSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const req = useApRequest();
  const [mode, setMode] = useState<"mcp" | "folder">("mcp");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const c = await req<Connector | null>({ op: "connector_import", path: text.trim() });
      setText("");
      if (c?.id) onCreated(c.id);
      else onClose();
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add existing" eyebrow="Connectors" size="md">
      <div className="flex flex-col gap-5 pb-4">
        <Segmented
          className="w-full"
          value={mode}
          onChange={(v) => (setMode(v), setText(""))}
          options={[
            { value: "mcp", label: "MCP server" },
            { value: "folder", label: "Folder" },
          ]}
        />
        {mode === "mcp" ? (
          <Field label="Command" hint="How the server is started, for example npx -y @modelcontextprotocol/server-github. You list its secrets on the next page.">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="npx -y some-mcp-server" autoCapitalize="none" autoCorrect="off" />
          </Field>
        ) : (
          <Field label="Folder" hint="A folder with a connector.json, for example one a teammate shared.">
            <div className="flex items-center gap-2">
              <Input className="flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="/Users/me/connectors/my-app" autoCapitalize="none" autoCorrect="off" />
              <Button size="md" variant="ghost" Icon={FolderOpen} onClick={() => void pickHostFolder().then((p) => p && setText(p))}>
                Browse
              </Button>
            </div>
          </Field>
        )}
        <Button size="lg" variant="accent" busy={busy} disabled={!text.trim()} onClick={() => void add()} block>
          Add
        </Button>
      </div>
    </Sheet>
  );
}
