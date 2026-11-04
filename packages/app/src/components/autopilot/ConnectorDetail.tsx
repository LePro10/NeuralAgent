// Autopilot → a connector: the guide, the setup form drawn from its manifest, a test with a
// checklist, its tools with their class, the logs, and for the user's own ones: change with an
// agent, open the folder, remove.
import type { Connector, ConnectorTestResult, ToolClass } from "@neuralagent/protocol";
import { Button, Callout, ConfirmSheet, Disclosure, Empty, Field, List, Page, Pill, Row, Sheet, Spinner, Switch, TextArea, toast } from "@neuralagent/ui";
import { Bot, Check, FolderOpen, Hammer, History, OctagonAlert, Plug, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CLASS_GROUPS, STATUS_LABEL, buildConfigure, guideParts, initialValues, missingFields, recoveryOptions, toolLabel, toolsOf, type FormValues } from "../../lib/autopilot";
import { useOpenAgent } from "../../lib/openAgent";
import { useDaemon, usePlatform } from "../../lib/store";
import { Glow } from "../Glow";
import { AgentPicker } from "./AgentPicker";
import { BrowserPair } from "./BrowserPair";
import { ConnectorWarnings, connectorIcon, useOpenLink } from "./bits";
import { FieldInput } from "./FieldInput";
import { useApDo, useApRequest, useConnector } from "./hooks";

export function ConnectorDetail({ id, onGone, back }: { id: string; onGone: () => void; back?: { label: string; onBack: () => void } }) {
  const c = useConnector(id);
  const gone = useDaemon((c) => !!c.state);
  if (!c) {
    return (
      <Page title="Connector" backLabel={back?.label} onBack={back?.onBack}>
        {gone ? <Empty Icon={Plug} title="This connector is gone" detail="It was removed." /> : null}
      </Page>
    );
  }
  return <Detail key={c.id} c={c} onGone={onGone} back={back} />;
}

/** The numbered "how to connect" steps; links open in the system browser. */
export function Guide({ steps }: { steps: string[] }) {
  const open = useOpenLink();
  return (
    <ol className="surface flex flex-col gap-3 rounded-list p-4">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-fill-3 text-footnote text-ink tabular">{i + 1}</span>
          <span className="min-w-0 flex-1 break-words text-subhead text-ink">
            {guideParts(step).map((p, j) =>
              p.href ? (
                <button key={j} type="button" onClick={() => open(p.href!)} className="text-left break-all text-accent hover:underline">
                  {p.text}
                </button>
              ) : (
                <span key={j}>{p.text}</span>
              ),
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

type ConnectorForm = ReturnType<typeof useConnectorForm>;

/** The setup form's state: values, secret drafts, save and test. Shared by the page and the chat card. */
export function useConnectorForm(c: Connector) {
  const req = useApRequest();
  const [values, setValues] = useState<FormValues>(() => initialValues(c));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectorTestResult | null>(null);
  const dirty = useMemo(() => Object.keys(drafts).some((k) => drafts[k]) || cleared.length > 0 || JSON.stringify(values) !== JSON.stringify(initialValues(c)), [drafts, cleared, values, c]);
  const missing = missingFields(c, values, drafts);

  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      const { config, secrets } = buildConfigure(c, values, drafts, cleared);
      await req({ op: "connector_configure", id: c.id, config, secrets });
      setDrafts({});
      setCleared([]);
      return true;
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
      return false;
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      if (dirty && !(await save())) return;
      setResult(await req<ConnectorTestResult>({ op: "connector_test", id: c.id }));
    } catch (e) {
      setResult({ ok: false, steps: [{ label: "Test", ok: false, detail: (e as Error).message }] });
    } finally {
      setTesting(false);
    }
  };
  return { values, setValues, drafts, setDrafts, cleared, setCleared, saving, testing, result, dirty, missing, save, test };
}

/** The fields drawn from the manifest plus "Save and test connection". */
export function ConnectionForm({ c, form, compact }: { c: Connector; form: ConnectorForm; compact?: boolean }) {
  const { values, setValues, drafts, setDrafts, cleared, setCleared, saving, testing, dirty, missing, save, test } = form;
  const ready = c.status === "running";
  return (
    <div className={compact ? "flex flex-col gap-4" : "surface flex flex-col gap-5 rounded-list p-4"}>
      {c.manifest.setup.map((f) => (
        <FieldInput
          key={f.key}
          connectorId={c.id}
          field={f}
          value={values[f.key]}
          onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))}
          isSet={c.secrets_set.includes(f.key)}
          draft={drafts[f.key]}
          onDraft={(v) => setDrafts((x) => ({ ...x, [f.key]: v }))}
          cleared={cleared.includes(f.key)}
          onClear={() => setCleared((x) => [...x, f.key])}
          ready={ready && !dirty}
        />
      ))}
      <p className="text-footnote text-dim">Secrets are kept on this computer and never shown again. Agents and the autopilot cannot read them.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="accent" busy={testing} disabled={missing.length > 0 || saving} onClick={() => void test()} className="flex-1">
          Save and test connection
        </Button>
        {!compact && (
          <Button variant="ghost" busy={saving} disabled={!dirty || testing} onClick={() => void save().then((ok) => ok && toast("Saved"))}>
            Save
          </Button>
        )}
      </div>
      {missing.length > 0 && <p className="text-footnote text-warning">Still needed: {missing.join(", ")}.</p>}
    </div>
  );
}

const CLASS_TONE: Record<ToolClass, "neutral" | "warning" | "accent"> = { read: "neutral", write: "warning", external: "accent" };

function Detail({ c, onGone, back }: { c: Connector; onGone: () => void; back?: { label: string; onBack: () => void } }) {
  const run = useApDo();
  const platform = usePlatform();
  const openAgent = useOpenAgent();
  const agentAlive = useDaemon((x) => (c.build_session ? !!x.state?.sessions[c.build_session]?.alive : false));
  const [changing, setChanging] = useState(false);
  const [resetting, setResetting] = useState(false);
  const recoverable = useDaemon((x) => x.status === "open" && x.has("connector_recover"));
  const [removing, setRemoving] = useState(false);
  const Icon = connectorIcon(c);
  const form = useConnectorForm(c);
  const { testing, result, test } = form;
  const building = c.status === "building";
  const mine = !c.builtin;
  const fields = c.manifest.setup;

  return (
    <div className="relative h-full">
      <Glow tint="mcp" />
      <Page title={c.manifest.name} eyebrow={STATUS_LABEL[c.status]} backLabel={back?.label} onBack={back?.onBack}>
        <div className="flex flex-col gap-7 pt-2 pb-10">
          <header className="flex items-start gap-3">
            <span aria-hidden className="grid size-icon-tile shrink-0 place-items-center rounded-tile bg-fill-3 text-ink">
              <Icon className="size-icon-sm" strokeWidth={1.75} />
            </span>
            <p className="min-w-0 flex-1 text-subhead text-dim">{c.manifest.description || "No description yet."}</p>
          </header>

          {building && (
            <div className="surface flex items-center gap-3 rounded-list p-4">
              <Hammer className="size-icon shrink-0 text-accent" strokeWidth={1.8} />
              <div className="min-w-0 flex-1">
                <div className="text-headline text-bright">An agent is building this</div>
                <p className="text-footnote text-dim">{agentAlive ? "Open its pane to watch or answer a question." : "It has stopped. Checks run when it finishes."}</p>
              </div>
              {c.build_session && agentAlive && (
                <Button size="sm" variant="accent" Icon={Bot} onClick={() => openAgent(c.build_session!)} className="shrink-0 rounded-full">
                  Open the agent
                </Button>
              )}
            </div>
          )}

          {mine && !building && c.build_stopped && (
            <StoppedCard
              c={c}
              recoverable={recoverable}
              testing={testing}
              onCheck={() => void test()}
              onChange={() => setChanging(true)}
              onReset={() => setResetting(true)}
              onOpenFolder={platform.revealPath ? () => void platform.revealPath!(c.path) : undefined}
            />
          )}

          {c.status === "error" && c.error && !c.build_stopped && (
            <Callout tone="danger" title="This connector has a problem">
              {c.error}
            </Callout>
          )}

          <ConnectorWarnings c={c} />

          {!building && (
            <List footer={c.status === "needs_setup" ? "Fill in the connection below first." : c.enabled ? "On: autopilots may use it, and it keeps running." : "Off: autopilots cannot use it and it does not run."}>
              <Row Icon={Plug} title="Turned on" trailing={<Switch checked={c.enabled} onChange={(v) => void run({ op: "connector_enable", id: c.id, enabled: v })} label={`${c.manifest.name} on`} />} />
            </List>
          )}

          {c.manifest.kind === "browser" && <BrowserPair />}

          {c.manifest.guide.length > 0 && !building && c.manifest.kind !== "browser" && (
            <section>
              <h2 className="mb-2 px-1 text-footnote text-dim uppercase tracking-wide">How to connect</h2>
              <Guide steps={c.manifest.guide} />
            </section>
          )}

          {fields.length > 0 && !building && (
            <section>
              <h2 className="mb-2 px-1 text-footnote text-dim uppercase tracking-wide">Connection</h2>
              <ConnectionForm c={c} form={form} />
            </section>
          )}

          {(testing || result) && <TestChecklist testing={testing} result={result} />}
          {!fields.length && !building && c.manifest.kind !== "browser" && (
            <div>
              <Button variant="ghost" busy={testing} onClick={() => void test()}>
                Test connection
              </Button>
            </div>
          )}

          <ToolsList c={c} />
          {!building && <Logs id={c.id} />}

          {mine && (
            <List label="Your connector">
              <Row Icon={Sparkles} title="Change with an agent" detail="Describe what should be different" chevron onClick={() => setChanging(true)} />
              {platform.revealPath && <Row Icon={FolderOpen} title="Open folder" detail={c.path} chevron onClick={() => void platform.revealPath!(c.path)} />}
              <Row Icon={Trash2} title="Remove" danger onClick={() => setRemoving(true)} />
            </List>
          )}
        </div>
      </Page>
      <ChangeSheet open={changing} onClose={() => setChanging(false)} id={c.id} name={c.manifest.name} initial={c.build_stopped ? c.last_request : undefined} />
      <ConfirmSheet
        open={resetting}
        onClose={() => setResetting(false)}
        title="Reset to the template?"
        message="The code goes back to an empty connector. Your settings and secrets stay. What is in the folder now is set aside in a hidden folder, not deleted."
        confirmLabel="Reset"
        destructive
        Icon={RotateCcw}
        onConfirm={async () => {
          await run({ op: "connector_reset", id: c.id }, "Reset to the template");
        }}
      />
      <ConfirmSheet
        open={removing}
        onClose={() => setRemoving(false)}
        title={`Remove “${c.manifest.name}”?`}
        message="Autopilots stop using it and its saved secrets are deleted. The folder stays on the computer."
        confirmLabel="Remove"
        destructive
        Icon={Trash2}
        onConfirm={async () => {
          if ((await run({ op: "connector_remove", id: c.id })) !== undefined) onGone();
        }}
      />
    </div>
  );
}

/** A build that ended without a working result: why, and every way out. The user stays in control. */
export function StoppedCard({ c, recoverable, testing, onCheck, onChange, onReset, onOpenFolder }: {
  c: Connector;
  recoverable: boolean;
  testing: boolean;
  onCheck: () => void;
  onChange: () => void;
  onReset: () => void;
  onOpenFolder?: () => void;
}) {
  const run = useApDo();
  const [busy, setBusy] = useState<string | null>(null);
  const o = recoveryOptions(c, recoverable);
  const go = async (op: "connector_retry" | "connector_restore", done?: string) => {
    setBusy(op);
    await run({ op, id: c.id }, done);
    setBusy(null);
  };
  return (
    <section className="surface flex flex-col gap-4 rounded-list p-4">
      <div className="flex items-start gap-3">
        <OctagonAlert className="mt-0.5 size-icon shrink-0 text-warning" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <div className="text-headline text-bright">Build stopped</div>
          <p className="mt-0.5 text-subhead break-words text-dim">{c.error || "The build did not finish."}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {o.retry && (
          <Button size="sm" variant="accent" busy={busy === "connector_retry"} onClick={() => void go("connector_retry")}>
            Try again
          </Button>
        )}
        <Button size="sm" variant="ghost" Icon={Sparkles} onClick={onChange}>
          Change the request
        </Button>
        {o.restore && (
          <Button size="sm" variant="ghost" Icon={History} busy={busy === "connector_restore"} onClick={() => void go("connector_restore", "Back to the last working version")}>
            Restore last working version
          </Button>
        )}
        {o.reset && (
          <Button size="sm" variant="ghost" Icon={RotateCcw} onClick={onReset}>
            Reset to template
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {onOpenFolder && (
          <Button size="sm" variant="quiet" Icon={FolderOpen} onClick={onOpenFolder}>
            Open folder
          </Button>
        )}
        <Button size="sm" variant="quiet" busy={testing} onClick={onCheck}>
          Check again
        </Button>
      </div>
      <p className="text-footnote text-dim">You can put any code you want in the folder. NeuralAgent runs it after the check passes: you decide.</p>
    </section>
  );
}

/** Started, tools listed, check passed: each as a line; a failure says why in words. */
export function TestChecklist({ testing, result }: { testing: boolean; result: ConnectorTestResult | null }) {
  return (
    <section aria-live="polite">
      <h2 className="mb-2 px-1 text-footnote text-dim uppercase tracking-wide">Test</h2>
      <div className="surface flex flex-col gap-2.5 rounded-list p-4">
        {testing && (
          <div className="flex items-center gap-2 text-subhead text-dim">
            <Spinner size={14} /> Testing the connection…
          </div>
        )}
        {result?.steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className={"mt-0.5 grid size-5 shrink-0 place-items-center rounded-full " + (s.ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>{s.ok ? <Check size={12} strokeWidth={2.4} /> : <X size={12} strokeWidth={2.4} />}</span>
            <div className="min-w-0 flex-1">
              <div className="text-subhead text-bright">{s.label}</div>
              {s.detail && <div className={"text-footnote break-words " + (s.ok ? "text-dim" : "text-danger")}>{s.detail}</div>}
            </div>
          </div>
        ))}
        {result && <p className={"pt-1 text-footnote " + (result.ok ? "text-success" : "text-danger")}>{result.ok ? "All good. Autopilots can use this connector." : "Something did not work. Fix it above and test again."}</p>}
      </div>
    </section>
  );
}

function ToolsList({ c }: { c: Connector }) {
  const tools = toolsOf(c);
  if (tools.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 px-1 text-footnote text-dim uppercase tracking-wide">What it can do</h2>
      <div className="flex flex-col gap-4">
        {CLASS_GROUPS.map((g) => {
          const list = tools.filter((t) => t.class === g.class);
          if (list.length === 0) return null;
          return (
            <List key={g.class} label={g.label} footer={g.detail}>
              {list.map((t) => (
                <Row key={t.name} title={toolLabel(t.name)} detail={t.description || undefined} wrap trailing={<Pill size="sm" tone={CLASS_TONE[t.class]}>{g.label}</Pill>} />
              ))}
            </List>
          );
        })}
      </div>
    </section>
  );
}

/** The last log lines, loaded when the section opens. */
function Logs({ id }: { id: string }) {
  const req = useApRequest();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    req<string[]>({ op: "connector_logs", id }).then(
      (l) => live && setLines(Array.isArray(l) ? l : []),
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [open, id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="surface overflow-hidden rounded-list">
      <Disclosure title="Log" detail="The last lines it wrote" open={open} onOpenChange={setOpen}>
        {error ? (
          <p className="text-footnote text-danger">{error}</p>
        ) : lines === null ? (
          <Spinner size={14} />
        ) : lines.length === 0 ? (
          <p className="text-footnote text-dim">Nothing yet.</p>
        ) : (
          <pre className="selectable max-h-72 overflow-auto font-mono text-caption leading-relaxed break-words whitespace-pre-wrap text-dim">{lines.join("\n")}</pre>
        )}
      </Disclosure>
    </div>
  );
}

export function ChangeSheet({ open, onClose, id, name, initial }: { open: boolean; onClose: () => void; id: string; name: string; initial?: string }) {
  const run = useApDo();
  const [text, setText] = useState("");
  const [profile, setProfile] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && initial) setText((t) => t || initial);
  }, [open, initial]);
  return (
    <Sheet open={open} onClose={onClose} title="Change with an agent" eyebrow={name} size="md">
      <div className="flex flex-col gap-5 pb-4">
        <Field label="What should be different?">
          <TextArea value={text} onChange={(e) => setText(e.target.value)} maxRows={8} placeholder="Also read the closed tickets, and let me mark one as solved." />
        </Field>
        <AgentPicker value={profile} onChange={setProfile} />
        <Button
          size="lg"
          variant="accent"
          busy={busy}
          disabled={!text.trim()}
          block
          onClick={async () => {
            setBusy(true);
            const r = await run({ op: "connector_change", id, request: text.trim(), ...(profile ? { profile } : {}) });
            setBusy(false);
            if (r !== undefined) {
              setText("");
              onClose();
            }
          }}
        >
          Send to an agent
        </Button>
      </div>
    </Sheet>
  );
}
