import { Button, Callout, Check, ConfirmButton, Empty, Field, Input, List, Pill, Row, Spinner, toast } from "@neuralagent/ui";
import { Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { api, type KeyScope } from "./api";
import { ago, date } from "./format";
import { usePolled } from "./hooks";

const SCOPES: { value: KeyScope; label: string; hint: string }[] = [
  { value: "reports:read", label: "Read reports", hint: "List and open problem reports." },
  { value: "reports:reply", label: "Answer reports", hint: "Send answers and change the status." },
];

/** Scoped keys for tools that talk to the admin API (for example the NeuralAgent admin connector). */
export function ApiKeys() {
  const keys = usePolled(() => api.keys(), 30_000);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<KeyScope[]>(["reports:read"]);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createKey(name.trim(), scopes);
      setFresh({ name: name.trim(), key: r.key });
      setName("");
      await keys.reload();
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fresh?.key ?? "");
      toast("Copied");
    } catch {
      toast("Copy failed", { tone: "danger" });
    }
  };

  if (keys.error && !keys.data) return <Callout tone="danger" title="Could not load the keys">{keys.error}</Callout>;
  if (!keys.data) return <div className="flex justify-center py-10"><Spinner label="Loading keys" /></div>;

  return (
    <div className="flex flex-col gap-4">
      <p className="px-1 text-detail text-dim">
        A key lets a tool use the report routes of this admin API without your sign-in. It can never manage users, devices or keys. Send it as <span className="font-mono">Authorization: Bearer …</span>.
      </p>

      {fresh && (
        <Callout tone="warning" title={`Key "${fresh.name}" created`}>
          <p>Copy it now. It is shown only once and stored hashed.</p>
          <p className="mt-2 break-all rounded-field px-3 py-2 font-mono text-detail text-bright well">{fresh.key}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" Icon={Copy} onClick={() => void copy()}>Copy key</Button>
            <Button size="sm" variant="glass" onClick={() => setFresh(null)}>I saved it</Button>
          </div>
        </Callout>
      )}

      <div className="card !rounded-list flex flex-col gap-3 p-4">
        <h3 className="text-footnote uppercase tracking-wide text-dim">New key</h3>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Autopilot on my Mac" maxLength={60} />
        </Field>
        <div className="flex flex-col gap-2">
          {SCOPES.map((s) => (
            <div key={s.value} className="flex items-center gap-3">
              <Check
                label={s.label}
                checked={scopes.includes(s.value)}
                onChange={(on) => setScopes((cur) => (on ? [...cur, s.value] : cur.filter((x) => x !== s.value)))}
              />
              <span className="text-detail text-ink">{s.label}<span className="text-dim"> · {s.hint}</span></span>
            </div>
          ))}
        </div>
        <div>
          <Button size="sm" busy={busy} disabled={!name.trim() || scopes.length === 0} onClick={() => void create()}>Create key</Button>
        </div>
      </div>

      {keys.data.length === 0 ? (
        <Empty Icon={KeyRound} title="No keys yet" detail="Create one for a tool that should read or answer reports." />
      ) : (
        <List label={`${keys.data.length} keys`}>
          {keys.data.map((k) => (
            <Row
              key={k.id}
              wrap
              title={<span className="flex flex-wrap items-center gap-1.5"><span className="truncate">{k.name}</span>{k.scopes.map((s) => <Pill key={s} size="sm">{s}</Pill>)}</span>}
              detail={`${k.hint}… · created ${date(k.created_at)} by ${k.created_by} · ${k.last_used ? `last used ${ago(k.last_used)}` : "never used"}`}
              trailing={
                <ConfirmButton
                  size="sm"
                  label="Revoke"
                  doneLabel="Revoked"
                  onConfirm={async () => {
                    try {
                      await api.revokeKey(k.id);
                      await keys.reload();
                    } catch (e) {
                      toast((e as Error).message, { tone: "danger" });
                    }
                  }}
                />
              }
            />
          ))}
        </List>
      )}
    </div>
  );
}
