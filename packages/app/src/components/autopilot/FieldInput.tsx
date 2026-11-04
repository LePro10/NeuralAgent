// One setup field of a connector, drawn from its manifest (all FieldKinds). Used by the connector
// form and by a pilot's per-source scope (channels, repositories, subreddits).
import type { FieldOption, SetupField } from "@neuralagent/protocol";
import { Button, Check, Field, Input, Menu, Row, Spinner, Switch, TextArea } from "@neuralagent/ui";
import { ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { asList, parseList } from "../../lib/autopilot";
import { useOpenLink } from "./bits";
import { useApRequest } from "./hooks";

/** Choices of a `pick` field, asked from the running connector. */
export function useFieldOptions(connectorId: string, field: SetupField, ready: boolean) {
  const req = useApRequest();
  const [options, setOptions] = useState<FieldOption[] | null>(field.options.length ? field.options : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!field.from) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await req<FieldOption[]>({ op: "connector_options", id: connectorId, field: field.key });
      if (mine === seq.current) setOptions(Array.isArray(r) ? r : []);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [connectorId, field.key, field.from]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ready && field.from) void load();
  }, [ready, load, field.from]);
  return { options, loading, error, reload: load };
}

interface Props {
  connectorId: string;
  field: SetupField;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Secrets: a value is stored already. */
  isSet?: boolean;
  /** Secrets: what is typed now. */
  draft?: string;
  onDraft?: (v: string) => void;
  onClear?: () => void;
  cleared?: boolean;
  /** The connector runs, so a pick field can ask it for choices. */
  ready: boolean;
  /** Hide the label (the caller shows its own). */
  compact?: boolean;
}

export function FieldInput(p: Props) {
  const { field } = p;
  const open = useOpenLink();
  const help = (
    <>
      {field.help && <span className="block">{field.help}</span>}
      {field.link && (
        <button type="button" onClick={() => open(field.link!)} className="mt-0.5 inline-flex items-center gap-1 text-accent hover:underline">
          Where do I find this? <ExternalLink size={12} strokeWidth={2} />
        </button>
      )}
    </>
  );
  const label = field.required ? field.label : `${field.label} (optional)`;
  if (field.type === "bool") {
    return (
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-body text-bright">{field.label}</div>
          {(field.help || field.link) && <div className="mt-0.5 text-footnote text-dim">{help}</div>}
        </div>
        <Switch checked={!!p.value} onChange={p.onChange} label={field.label} />
      </div>
    );
  }
  return (
    <Field label={label} hint={field.help || field.link ? help : undefined}>
      <Body {...p} />
    </Field>
  );
}

function Body({ connectorId, field, value, onChange, isSet, draft, onDraft, onClear, cleared, ready }: Props) {
  switch (field.type) {
    case "secret":
      return (
        <div className="flex items-center gap-2">
          <Input
            className="flex-1"
            type="password"
            autoComplete="off"
            value={draft ?? ""}
            onChange={(e) => onDraft?.(e.target.value)}
            placeholder={isSet && !cleared ? "Set. Type to replace" : (field.placeholder ?? "Paste it here")}
            aria-label={field.label}
          />
          {isSet && !cleared && (
            <Button size="sm" variant="quiet" onClick={onClear}>
              Remove
            </Button>
          )}
        </div>
      );
    case "number":
      return <Input type="number" inputMode="decimal" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} aria-label={field.label} />;
    case "url":
      return <Input type="url" inputMode="url" autoCapitalize="none" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? "https://"} aria-label={field.label} />;
    case "select":
      return <SelectField field={field} options={field.options} value={String(value ?? "")} onChange={onChange} />;
    case "pick":
      return <PickField connectorId={connectorId} field={field} value={asList(value)} onChange={onChange} ready={ready} />;
    case "list":
      return <ListField field={field} value={asList(value)} onChange={onChange} />;
    default:
      return <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} aria-label={field.label} autoCapitalize="none" />;
  }
}

function SelectField({ field, options, value, onChange }: { field: SetupField; options: FieldOption[]; value: string; onChange: (v: unknown) => void }) {
  const current = options.find((o) => o.value === value);
  return (
    <Menu
      block
      align="start"
      title={field.label}
      items={options.map((o) => ({ label: o.label, checked: o.value === value, kind: "radio" as const, onSelect: () => onChange(o.value) }))}
      trigger={(show) => (
        <button type="button" onClick={show} className="pressable flex h-control w-full items-center justify-between gap-2 rounded-field bg-fill-2 px-3.5 text-input text-bright shadow-edge">
          <span className={"truncate " + (current ? "" : "text-faint")}>{current?.label ?? field.placeholder ?? "Choose…"}</span>
          <ChevronDown className="size-icon-sm shrink-0 text-dim" />
        </button>
      )}
    />
  );
}

/** Several values from a list the connector provides; without a running connector, typed by hand. */
function PickField({ connectorId, field, value, onChange, ready }: { connectorId: string; field: SetupField; value: string[]; onChange: (v: unknown) => void; ready: boolean }) {
  const { options, loading, error, reload } = useFieldOptions(connectorId, field, ready);
  if (!options) {
    return (
      <div className="flex flex-col gap-2">
        {loading ? (
          <div className="flex items-center gap-2 text-subhead text-dim">
            <Spinner size={14} /> Loading choices…
          </div>
        ) : (
          <p className="text-footnote text-dim">{error ? `Could not load the list: ${error}` : ready ? "No list yet." : "Save and test the connection first, then you can choose from a list. Until then, type the names."}</p>
        )}
        <ListField field={field} value={value} onChange={onChange} />
        {ready && !loading && (
          <div>
            <Button size="xs" variant="quiet" Icon={RefreshCw} onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const known = new Set(options.map((o) => o.value));
  const all = [...options, ...value.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="surface list-rows max-h-72 overflow-y-auto rounded-list">
        {all.length === 0 && <p className="px-4 py-3 text-footnote text-dim">Nothing to choose from yet.</p>}
        {all.map((o) => (
          <Row key={o.value} title={o.label} onClick={() => toggle(o.value)} trailing={<Check checked={value.includes(o.value)} label={o.label} display />} />
        ))}
      </div>
      <div className="flex items-center justify-between px-1 text-footnote text-dim">
        <span>{value.length ? `${value.length} chosen` : "None chosen"}</span>
        <Button size="xs" variant="quiet" Icon={RefreshCw} busy={loading} onClick={() => void reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}

/** A free list, one per line or separated by commas (subreddits, keywords). */
function ListField({ field, value, onChange }: { field: SetupField; value: string[]; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value.join("\n"));
  const mine = useRef(value.join("\n"));
  // Follow outside changes (a reset), not our own typing.
  useEffect(() => {
    const now = value.join("\n");
    if (now !== mine.current) {
      mine.current = now;
      setText(now);
    }
  }, [value]);
  return (
    <TextArea
      value={text}
      maxRows={6}
      onChange={(e) => {
        setText(e.target.value);
        const list = parseList(e.target.value);
        mine.current = list.join("\n");
        onChange(list);
      }}
      placeholder={field.placeholder ?? "One per line"}
      aria-label={field.label}
    />
  );
}
