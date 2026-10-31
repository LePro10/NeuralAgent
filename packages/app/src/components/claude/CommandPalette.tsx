/**
 * Every Claude Code command in one place: built-ins grouped the way people think about them,
 * then the user's own commands, skills and plugins. Search matches names, aliases and words
 * in the description. A command with arguments opens a small step with the hint, known
 * values as chips, Run and "Insert into message". Commands that end or clear something ask
 * first. Full height on phones; Back returns from a step, then closes.
 */
import { cn, SearchField, Sheet, SNAPS, useLayer } from "@neuralagent/ui";
import { ArrowLeft, ArrowUp, ChevronRight, CornerDownLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Command, commandLine, loadRecent, paletteSections } from "./commands";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  phone: boolean;
  /** The app's own screen for a command (model, effort, context, tasks…). */
  onNative: (name: string) => void;
  /** Send this line now. */
  onRun: (line: string) => void;
  /** Put this line into the composer to finish typing. */
  onInsert: (line: string) => void;
}

const hasArgs = (c: Command) => !!c.args || !!c.values?.length;

export function CommandPalette({ open, onClose, commands, phone, onNative, onRun, onInsert }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<Command | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setStep(null);
    setRecent(loadRecent());
  }, [open]);
  useLayer(open && step !== null, () => setStep(null));
  const sections = useMemo(() => paletteSections(commands, query, recent, phone), [commands, query, recent, phone]);

  const choose = (c: Command) => {
    if (c.kind === "native" && !(query.includes(" ") && hasArgs(c))) return onNative(c.native ?? c.name);
    if (hasArgs(c) || c.confirm) return setStep(c);
    onRun(commandLine(c, ""));
  };

  return (
    <Sheet open={open} onClose={onClose} title={step ? undefined : "Commands"} snaps={phone ? SNAPS.full : undefined} size="md" hideClose={!!step} bodyClassName="pb-4">
      <div className="cv-sheet -mx-1 font-cv-sans">
        {step ? (
          <ArgStep c={step} phone={phone} onBack={() => setStep(null)} onRun={onRun} onInsert={onInsert} />
        ) : (
          <>
            <div className="sticky top-0 z-10 bg-cv-surface px-3 pb-2">
              <SearchField value={query} onChange={setQuery} placeholder="Search commands and skills" autoFocus={!phone} hint="/" />
            </div>
            {sections.length === 0 && (
              <div className="px-4 py-8 text-center text-cv-ui text-cv-muted">
                No command matches “{query}”.
                <button type="button" onClick={() => onInsert(`/${query.trim().replace(/^\//, "")}`)} className="mx-auto mt-3 flex h-11 items-center gap-2 rounded-full bg-cv-chip px-4 text-cv-ui text-cv-text">
                  Type /{query.trim().replace(/^\//, "")} anyway
                </button>
              </div>
            )}
            {sections.map((s) => (
              <section key={s.title} aria-label={s.title} className="mb-1">
                <h3 className="px-4 pt-3 pb-1 text-cv-meta text-cv-muted">{s.title}</h3>
                {s.items.map((c) => (
                  <button
                    key={`${s.title}:${c.name}`}
                    type="button"
                    onClick={() => choose(c)}
                    className="flex min-h-13 w-full items-center gap-3 rounded-cv-md px-4 py-2 text-left transition-colors hover:bg-cv-hover active:bg-cv-press"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="shrink-0 font-cv-mono text-cv-code text-cv-text">/{c.name}</span>
                        {c.args && <span className="min-w-0 truncate font-cv-mono text-cv-meta text-cv-muted">{c.args}</span>}
                      </span>
                      <span className="block truncate text-cv-meta text-cv-muted">{c.description}</span>
                    </span>
                    {c.source !== "builtin" && <span className="shrink-0 rounded-full bg-cv-chip px-2 py-px text-cv-meta text-cv-muted">{c.source}</span>}
                    {(hasArgs(c) || c.kind === "native" || c.confirm) && <ChevronRight size={16} className="shrink-0 text-cv-muted" />}
                  </button>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </Sheet>
  );
}

function ArgStep({ c, phone, onBack, onRun, onInsert }: { c: Command; phone: boolean; onBack: () => void; onRun: (line: string) => void; onInsert: (line: string) => void }) {
  const [args, setArgs] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Phones: only lift the keyboard when the argument is needed; chips are enough otherwise.
    if (!phone || (c.needsArgs && !c.values?.length)) field.current?.focus();
  }, [c, phone]);
  const blocked = !!c.needsArgs && !args.trim();
  const line = commandLine(c, args);
  const run = () => !blocked && onRun(line);
  return (
    <div className="px-1">
      <div className="flex items-center gap-1 pb-2">
        <button type="button" onClick={onBack} aria-label="Back to all commands" className="grid size-11 place-items-center rounded-full text-cv-text-2 hover:bg-cv-hover">
          <ArrowLeft size={20} strokeWidth={1.8} />
        </button>
        <span className="font-cv-mono text-cv-h3 text-cv-text">/{c.name}</span>
      </div>
      <p className="px-3 pb-3 text-cv-ui text-cv-text-2">{c.description}</p>
      {c.confirm ? (
        <div className="mx-3 rounded-cv-card border border-cv-line-soft p-4">
          <p className="pb-3 text-cv-ui text-cv-text">{c.confirm}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onBack} className="h-11 flex-1 rounded-full bg-cv-chip text-cv-ui text-cv-text">
              Cancel
            </button>
            <button type="button" onClick={() => onRun(line)} className="h-11 flex-1 rounded-full bg-cv-danger text-cv-ui text-cv-on-primary">
              Run /{c.name}
            </button>
          </div>
        </div>
      ) : (
        <>
          {!!c.values?.length && (
            <div className="flex flex-wrap gap-2 px-3 pb-3" role="group" aria-label="Values">
              {c.values.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onRun(commandLine(c, v))}
                  className={cn("h-11 rounded-full border px-4 font-cv-mono text-cv-code transition-colors hover:bg-cv-hover", args.trim() === v ? "border-cv-line-strong text-cv-text" : "border-cv-line-soft text-cv-text-2")}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          <form
            className="mx-3 flex items-center gap-1 rounded-cv-card border border-cv-line-soft bg-cv-surface p-1 focus-within:border-cv-line"
            onSubmit={(e) => (e.preventDefault(), run())}
          >
            <input
              ref={field}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={c.args ? c.args.replace(/^[[<]|[\]>]$/g, "") : "Arguments"}
              aria-label={`Arguments for /${c.name}`}
              enterKeyHint="send"
              autoCapitalize="off"
              className="h-11 min-w-0 flex-1 bg-transparent px-3 font-cv-mono text-cv-input text-cv-text outline-none placeholder:text-cv-placeholder"
            />
            <button type="submit" disabled={blocked} aria-label={`Run ${line}`} className="grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-40">
              <span className="grid size-9 place-items-center rounded-full bg-cv-clay text-cv-on-clay">
                <ArrowUp size={19} strokeWidth={2.2} />
              </span>
            </button>
          </form>
          <div className="flex items-center gap-2 px-3 pt-2">
            <span className="min-w-0 flex-1 truncate font-cv-mono text-cv-meta text-cv-muted">{line}</span>
            <button type="button" onClick={() => onInsert(line)} className="flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-cv-meta text-cv-text-2 hover:bg-cv-hover">
              <CornerDownLeft size={14} />
              Insert into message
            </button>
          </div>
          {c.needsArgs && <p className="px-3 pt-1 text-cv-meta text-cv-muted">This command needs an argument.</p>}
        </>
      )}
    </div>
  );
}
