// Autopilot → Instructions: the playbook as a form. Mission, how to work, tone, routines, sources
// (react to new events, narrow the scope), permissions per tool (On its own / Ask me / Never,
// grouped Reads / Changes / Speaks for you) and notifications. Saved with one button.
import type { Allow, Connector, Pilot, Playbook, Routine } from "@neuralagent/protocol";
import { Button, Field, Input, List, Menu, Row, Segmented, Sheet, Switch, TextArea, Disclosure, Callout } from "@neuralagent/ui";
import { Bell, Clock, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ALLOW_LABEL,
  ALLOW_OPTIONS,
  BUILTIN_TOOLS,
  CLASS_GROUPS,
  DAY_OPTIONS,
  NOTIFY_LABEL,
  addableSources,
  effectiveAllow,
  formToSchedule,
  newRoutine,
  patchSource,
  permissionSummary,
  scheduleLabel,
  scheduleToForm,
  scopeFields,
  setAllow,
  toolLabel,
  toolsOf,
  withSource,
  type ScheduleForm,
} from "../../lib/autopilot";
import { FieldInput } from "./FieldInput";
import { connectorIcon } from "./bits";
import { useApDo, useAutopilot } from "./hooks";
import { SuggestionCard } from "./SuggestionCard";

export function Instructions({ pilot, onConnectors }: { pilot: Pilot; onConnectors: () => void }) {
  const state = useAutopilot();
  const run = useApDo();
  const [draft, setDraft] = useState<Playbook>(pilot.playbook);
  const [saving, setSaving] = useState(false);
  const base = useRef(JSON.stringify(pilot.playbook));
  const dirty = JSON.stringify(draft) !== base.current;
  // New playbook from the daemon (applied suggestion, another device): follow it unless the user is editing.
  const incoming = JSON.stringify(pilot.playbook);
  useEffect(() => {
    if (incoming !== base.current) {
      if (!dirty) setDraft(pilot.playbook);
      base.current = incoming;
    }
  }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Playbook>) => setDraft((d) => ({ ...d, ...p }));
  const suggestions = state.suggestions.filter((s) => s.pilot_id === pilot.id);
  const save = async () => {
    setSaving(true);
    const ok = await run({ op: "pilot_update", id: pilot.id, playbook: draft }, "Instructions saved");
    setSaving(false);
    if (ok !== undefined) base.current = JSON.stringify(draft);
  };

  return (
    <div className="flex flex-col gap-8 pb-24">
      {suggestions.map((s) => (
        <SuggestionCard key={s.id} suggestion={s} />
      ))}
      {!pilot.setup_done && (
        <Callout tone="accent">Saving the instructions finishes the setup. You can change everything later.</Callout>
      )}

      <Section title="What is this project?" hint="A few sentences: what it is, who uses it, whether it is public.">
        <TextArea value={draft.mission} onChange={(e) => set({ mission: e.target.value })} maxRows={8} placeholder="A habit tracker app for iPhone. Small team, public on the App Store." aria-label="What is this project" />
      </Section>
      <Section title="How to work" hint="Your exact instructions: what to do with a bug report, a question, a feature wish. Write it like you would for a new helper.">
        <TextArea value={draft.instructions} onChange={(e) => set({ instructions: e.target.value })} maxRows={16} placeholder={"Bug reports: let an agent look at it and tell me what it found.\nQuestions: draft an answer for me to approve.\nFeature wishes: just collect them."} aria-label="How to work" />
      </Section>
      <Section title="How to talk to people" hint="Used for every draft it writes in your name.">
        <TextArea value={draft.tone} onChange={(e) => set({ tone: e.target.value })} maxRows={5} placeholder="Friendly and short. No emojis. Reply in the language of the person." aria-label="How to talk to people" />
      </Section>

      <Routines playbook={draft} onChange={(routines) => set({ routines })} />
      <Sources playbook={draft} onChange={setDraft} onConnectors={onConnectors} />
      <Permissions playbook={draft} onChange={(rules) => set({ rules })} />

      <List label="Notifications" footer="On your phone these arrive as push messages.">
        <div className="px-4 py-3">
          <Segmented
            className="w-full"
            label="When to notify"
            value={draft.notify}
            onChange={(notify) => set({ notify })}
            options={(["needs_you", "all", "never"] as const).map((v) => ({ value: v, label: v === "needs_you" ? "When needed" : v === "all" ? "Everything" : "Never" }))}
          />
          <p className="mt-2 text-footnote text-dim">{NOTIFY_LABEL[draft.notify]}</p>
        </div>
      </List>

      {dirty && (
        <div className="sticky bottom-3 z-10 flex gap-2 rounded-full bg-navbar p-2 shadow-lg backdrop-blur-xl" style={{ bottom: "calc(var(--tabbar-space) + 8px)" }}>
          <Button variant="ghost" onClick={() => setDraft(pilot.playbook)} className="rounded-full">
            Undo
          </Button>
          <Button variant="accent" busy={saving} onClick={() => void save()} className="flex-1 rounded-full">
            Save instructions
          </Button>
        </div>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="px-1 text-headline text-bright">{title}</h2>
      {hint && <p className="px-1 text-footnote text-dim">{hint}</p>}
      <div className="mt-1">{children}</div>
    </section>
  );
}

// ───────────────────────────── routines ─────────────────────────────

function Routines({ playbook, onChange }: { playbook: Playbook; onChange: (r: Routine[]) => void }) {
  const [editing, setEditing] = useState<Routine | null>(null);
  const isNew = editing ? !playbook.routines.some((r) => r.id === editing.id) : false;
  const save = (r: Routine) => {
    onChange(isNew ? [...playbook.routines, r] : playbook.routines.map((x) => (x.id === r.id ? r : x)));
    setEditing(null);
  };
  return (
    <>
      <List label="Routines" footer="Things it does by itself on a schedule. Leave it empty to only react when you ask or something comes in.">
        {playbook.routines.map((r) => (
          <Row
            key={r.id}
            Icon={Clock}
            title={r.task || "Untitled routine"}
            detail={scheduleLabel(r.schedule)}
            wrap
            value={r.enabled ? undefined : "Paused"}
            onClick={() => setEditing(r)}
          />
        ))}
        <Row Icon={Plus} title="Add a routine" onClick={() => setEditing(newRoutine(`r${Date.now().toString(36)}`))} />
      </List>
      <RoutineSheet
        routine={editing}
        isNew={isNew}
        onClose={() => setEditing(null)}
        onSave={save}
        onRemove={() => {
          if (editing) onChange(playbook.routines.filter((x) => x.id !== editing.id));
          setEditing(null);
        }}
      />
    </>
  );
}

function RoutineSheet({ routine, isNew, onClose, onSave, onRemove }: { routine: Routine | null; isNew: boolean; onClose: () => void; onSave: (r: Routine) => void; onRemove: () => void }) {
  const [task, setTask] = useState("");
  const [on, setOn] = useState(true);
  const [form, setForm] = useState<ScheduleForm>(scheduleToForm({ kind: "every", minutes: 360 }));
  useEffect(() => {
    if (routine) {
      setTask(routine.task);
      setOn(routine.enabled);
      setForm(scheduleToForm(routine.schedule));
    }
  }, [routine?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const schedule = formToSchedule(form);
  const ok = task.trim() !== "" && schedule !== null;
  const patch = (p: Partial<ScheduleForm>) => setForm((f) => ({ ...f, ...p }));
  return (
    <Sheet open={!!routine} onClose={onClose} title={isNew ? "New routine" : "Routine"} eyebrow="Instructions" size="md">
      <div className="flex flex-col gap-5 pb-4">
        <Field label="What should it do?">
          <TextArea value={task} onChange={(e) => setTask(e.target.value)} maxRows={6} placeholder="Read new Reddit posts about the app" />
        </Field>
        <Field label="How often?" error={schedule === null && form.kind === "every" ? "At least every 5 minutes." : undefined}>
          <div className="flex flex-col gap-3">
            <Segmented
              className="w-full"
              value={form.kind}
              onChange={(kind) => patch({ kind })}
              options={[
                { value: "every", label: "Every" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
              ]}
            />
            {form.kind === "every" ? (
              <div className="flex items-center gap-2">
                <Input className="w-24" type="number" inputMode="numeric" min={1} value={form.amount} onChange={(e) => patch({ amount: e.target.value })} aria-label="Amount" />
                <Segmented
                  className="flex-1"
                  value={form.unit}
                  onChange={(unit) => patch({ unit })}
                  options={[
                    { value: "minutes", label: "Minutes" },
                    { value: "hours", label: "Hours" },
                  ]}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {form.kind === "weekly" && (
                  <Segmented scroll className="w-full" value={form.day} onChange={(day) => patch({ day })} options={DAY_OPTIONS.map((d) => ({ value: d.value, label: d.label.slice(0, 3) }))} />
                )}
                <Input type="time" value={form.at} onChange={(e) => patch({ at: e.target.value })} aria-label="Time" />
              </div>
            )}
            {schedule && <p className="text-footnote text-dim">{scheduleLabel(schedule)}</p>}
          </div>
        </Field>
        <List>
          <Row title="Run on schedule" detail={on ? undefined : "Paused until you turn it on again"} wrap trailing={<Switch checked={on} onChange={setOn} label="Routine on" />} />
        </List>
        <Button size="lg" variant="accent" disabled={!ok} block onClick={() => routine && schedule && onSave({ ...routine, task: task.trim(), schedule, enabled: on })}>
          {isNew ? "Add routine" : "Done"}
        </Button>
        {!isNew && (
          <Button size="lg" variant="danger" Icon={Trash2} block onClick={onRemove}>
            Remove routine
          </Button>
        )}
      </div>
    </Sheet>
  );
}

// ───────────────────────────── sources ─────────────────────────────

function Sources({ playbook, onChange, onConnectors }: { playbook: Playbook; onChange: (p: Playbook) => void; onConnectors: () => void }) {
  const { connectors } = useAutopilot();
  const addable = addableSources(playbook, connectors);
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="px-1 text-headline text-bright">Sources</h2>
        <p className="px-1 text-footnote text-dim">Where it looks. Switch on “react to new events” to have new messages and issues land in the inbox on their own.</p>
      </div>
      {playbook.sources.length === 0 && <p className="px-1 text-subhead text-dim">No sources yet.</p>}
      {playbook.sources.map((s) => {
        const c = connectors.find((x) => x.id === s.connector_id);
        return c ? <SourceCard key={s.connector_id} c={c} listen={s.listen} scope={s.scope} onChange={(patch) => onChange(patchSource(playbook, c.id, patch))} onRemove={() => onChange({ ...playbook, sources: playbook.sources.filter((x) => x.connector_id !== c.id) })} /> : (
          <Row key={s.connector_id} title={s.connector_id} detail="This connector is gone" trailing={<Button size="xs" variant="quiet" onClick={() => onChange({ ...playbook, sources: playbook.sources.filter((x) => x.connector_id !== s.connector_id) })}>Remove</Button>} />
        );
      })}
      <div className="flex flex-wrap gap-2">
        {addable.length > 0 ? (
          <Menu
            align="start"
            title="Add a source"
            items={addable.map((c) => ({ label: c.manifest.name, detail: c.manifest.description, Icon: connectorIcon(c), onSelect: () => onChange(withSource(playbook, c.id)) }))}
            trigger={(show) => (
              <Button variant="ghost" size="sm" Icon={Plus} onClick={show} className="rounded-full">
                Add a source
              </Button>
            )}
          />
        ) : null}
        <Button variant="quiet" size="sm" onClick={onConnectors}>
          {addable.length === 0 ? "Set up a connector first" : "Set up more connectors"}
        </Button>
      </div>
    </section>
  );
}

function SourceCard({ c, listen, scope, onChange, onRemove }: { c: Connector; listen: boolean; scope: Record<string, unknown>; onChange: (p: { listen?: boolean; scope?: Record<string, unknown> }) => void; onRemove: () => void }) {
  const Icon = connectorIcon(c);
  const fields = scopeFields(c);
  const ready = c.status === "running";
  return (
    <div className="surface list-rows overflow-hidden rounded-list">
      <Row Icon={Icon} title={c.manifest.name} detail={ready ? undefined : c.status === "needs_setup" ? "Needs setup" : "Not running"} trailing={<Button size="xs" variant="quiet" onClick={onRemove}>Remove</Button>} />
      <Row title="React to new events" detail="New messages and issues land in the inbox" trailing={<Switch checked={listen} onChange={(v) => onChange({ listen: v })} label={`React to new events in ${c.manifest.name}`} />} wrap />
      {fields.length > 0 && (
        <div className="flex flex-col gap-4 px-4 py-3" data-lead="">
          {fields.map((f) => (
            <FieldInput key={f.key} connectorId={c.id} field={{ ...f, required: false, label: f.label }} value={scope[f.key]} onChange={(v) => onChange({ scope: { ...scope, [f.key]: v } })} ready={ready} />
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── permissions ─────────────────────────────

function Permissions({ playbook, onChange }: { playbook: Playbook; onChange: (r: Playbook["rules"]) => void }) {
  const { connectors } = useAutopilot();
  const used = playbook.sources.map((s) => connectors.find((c) => c.id === s.connector_id)).filter((c): c is Connector => !!c);
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="px-1 text-headline text-bright">What it may do</h2>
        <p className="px-1 text-footnote text-dim">For every tool: do it on its own, ask you first, or never. Looking is free by default. Changing things and writing to people asks first.</p>
      </div>
      <div className="surface list-rows overflow-hidden rounded-list">
        <Disclosure title="The autopilot itself" detail="Starting and guiding coding agents" Icon={Bell} defaultOpen={false}>
          <div className="-mx-3.5">
            {BUILTIN_TOOLS.map((t) => (
              <AllowRow key={t.name} label={t.label} detail={t.detail} allow={effectiveAllow(playbook.rules, undefined, t.name, t.class)} onPick={(a) => onChange(setAllow(playbook.rules, undefined, t.name, t.class, a))} />
            ))}
          </div>
        </Disclosure>
        {used.map((c) => (
          <Disclosure key={c.id} title={c.manifest.name} detail={permissionSummary(playbook.rules, c)} Icon={connectorIcon(c)}>
            <div className="-mx-3.5 flex flex-col gap-3">
              {toolsOf(c).length === 0 && <p className="px-3.5 text-footnote text-dim">No tools yet. Test the connector first.</p>}
              {CLASS_GROUPS.map((g) => {
                const list = toolsOf(c).filter((t) => t.class === g.class);
                if (!list.length) return null;
                return (
                  <div key={g.class}>
                    <div className="px-3.5 pb-0.5 text-footnote text-dim uppercase tracking-wide">{g.label}</div>
                    {list.map((t) => (
                      <AllowRow key={t.name} label={toolLabel(t.name)} detail={t.description} allow={effectiveAllow(playbook.rules, c.id, t.name, t.class)} onPick={(a) => onChange(setAllow(playbook.rules, c.id, t.name, t.class, a))} />
                    ))}
                  </div>
                );
              })}
            </div>
          </Disclosure>
        ))}
      </div>
      {used.length === 0 && <p className="px-1 text-footnote text-dim">Add a source above to set what the autopilot may do there.</p>}
    </section>
  );
}

function AllowRow({ label, detail, allow, onPick }: { label: string; detail?: string; allow: { allow: Allow; custom: boolean }; onPick: (a: Allow) => void }) {
  return (
    <Menu
      title={label}
      items={ALLOW_OPTIONS.map((o) => ({ label: o.label, checked: o.value === allow.allow, kind: "radio" as const, onSelect: () => onPick(o.value) }))}
      block
      trigger={(show) => <Row title={label} detail={detail || undefined} value={ALLOW_LABEL[allow.allow]} chevron onClick={show} />}
    />
  );
}
