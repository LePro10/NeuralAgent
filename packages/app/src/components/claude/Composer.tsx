/**
 * The input at the bottom, shaped like Claude's: a rounded card with the text, attachments,
 * and a footer with + (attach), the permission mode, model and effort, dictation and send/stop.
 * Pickers are bottom sheets on phones and popovers above the card on desktop.
 */
import type { CvCommand, CvMeta } from "@neuralagent/protocol";
import { cn } from "@neuralagent/ui";
import { ArrowUp, AtSign, Camera, ChevronDown, ChevronRight, ClipboardPaste, FileText, Images, Loader, Mic, Paperclip, Plus, RotateCw, Slash, SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useClient, usePlatform } from "../../lib/store";
import { filesOf, isImage, pathToken, readClipboardFiles, uploadFile } from "./files";
import { contextLimit, DEFAULT_EFFORT, EFFORT_NOTE, EFFORTS, effortName, MODELS, MODES, modeOf, modelAlias, modelName, TERMINAL_COMMANDS } from "./models";
import { PickNote, PickRow, PickSection, Picker } from "./Picker";
import { useDictation } from "./useDictation";

interface Chip {
  id: number;
  name: string;
  url: string;
  /** Kept for a retry. */
  file: File;
  state: "queued" | "uploading" | "done" | "error";
  path?: string;
  error?: string;
}

type Popup = "model" | "effort" | "mode" | "plus" | null;

const drafts = new Map<string, string>();
let chipId = 1;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Composer({ sid, meta, busy, phone, empty, disabled, onTerminal, onSubmitted }: {
  sid: string;
  meta: CvMeta;
  busy: boolean;
  phone: boolean;
  /** Nothing said yet: the greeting placeholder. */
  empty?: boolean;
  disabled?: boolean;
  /** A command that needs the terminal UI was sent. */
  onTerminal: (why: string) => void;
  onSubmitted: () => void;
}) {
  const client = useClient();
  const platform = usePlatform();
  const [text, setText] = useState(() => drafts.get(sid) ?? "");
  const [caret, setCaret] = useState(0);
  const [chips, setChips] = useState<Chip[]>([]);
  const [commands, setCommands] = useState<CvCommand[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [menu, setMenu] = useState(0);
  const [menuOff, setMenuOff] = useState(false);
  const [popup, setPopup] = useState<Popup>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const anyFile = useRef<HTMLInputElement>(null);
  const lastFetch = useRef(0);
  /** Uploads go one after another: seven photos at once only made all seven slow (and time out together). */
  const uploads = useRef<Promise<void>>(Promise.resolve());
  const shown = useRef(chips);
  shown.current = chips;
  const modeNow = useRef(meta.mode);
  modeNow.current = meta.mode;

  useEffect(() => {
    drafts.set(sid, text);
  }, [sid, text]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, phone ? 168 : 280)}px`;
  }, [text, phone]);

  const flash = useCallback((m: string) => {
    setNotice(m);
    setTimeout(() => setNotice((cur) => (cur === m ? null : cur)), 4000);
  }, []);
  const close = useCallback(() => setPopup(null), []);
  const toggle = (p: Exclude<Popup, null>) => setPopup((cur) => (cur === p ? null : p));
  const prompt = (t: string) => client.req({ m: "session_prompt", p: { id: sid, text: t } }).catch((e: Error) => flash(e.message));

  // ── `/` and `@` lists ──
  const slash = /^\/([^\s]*)$/.exec(text.slice(0, caret));
  const at = !slash ? /(^|\s)@([^\s]*)$/.exec(text.slice(0, caret)) : null;
  const slashQ = slash ? slash[1]! : null;
  const atQ = at ? at[2]! : null;

  useEffect(() => {
    if (slashQ === null) return;
    // Commands change (new files in ~/.claude/commands, skills): look again when the list opens.
    if (Date.now() - lastFetch.current < 15_000 && commands.length) return;
    lastFetch.current = Date.now();
    client.req<CvCommand[]>({ m: "cv_commands", p: { sid } }).then(setCommands).catch(() => {});
  }, [slashQ === null, client, sid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (atQ === null) return;
    const t = setTimeout(() => client.req<string[]>({ m: "cv_files", p: { sid, query: atQ } }).then(setFiles).catch(() => setFiles([])), 100);
    return () => clearTimeout(t);
  }, [atQ, client, sid]);

  const cmdItems = useMemo(() => {
    if (slashQ === null) return [];
    const q = slashQ.toLowerCase();
    const score = (c: CvCommand) => (c.name.toLowerCase().startsWith(q) ? 0 : c.name.toLowerCase().includes(q) ? 1 : c.description.toLowerCase().includes(q) ? 2 : 9);
    return commands.filter((c) => score(c) < 9).sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name)).slice(0, 40);
  }, [commands, slashQ]);

  const items: { key: string; label: string; detail: string; badge?: string }[] =
    slashQ !== null
      ? cmdItems.map((c) => ({ key: c.name, label: `/${c.name}`, detail: c.description, badge: c.source === "builtin" ? undefined : c.source }))
      : atQ !== null
        ? files.map((f) => ({ key: f, label: f.split("/").filter(Boolean).pop() ?? f, detail: f }))
        : [];
  const menuOpen = items.length > 0 && !menuOff;
  useEffect(() => setMenu(0), [slashQ, atQ]);
  useEffect(() => setMenuOff(false), [slashQ, atQ]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${menu}"]`)?.scrollIntoView({ block: "nearest" });
  }, [menu]);

  const insertAt = (replace: RegExp, value: string) => {
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const head = before.replace(replace, value);
    setText(head + after);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(head.length, head.length);
      setCaret(head.length);
    });
  };

  const accept = (i: number) => {
    const it = items[i];
    if (!it) return;
    if (slashQ !== null) insertAt(/^\/[^\s]*$/, `${it.label} `);
    else insertAt(/@[^\s]*$/, `@${it.detail} `);
  };

  const typeIn = (s: string) => {
    setText((t) => `${t}${t && !/\s$/.test(t) && s !== "/" ? " " : ""}${s}`);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      setCaret(el.value.length);
    });
  };

  // ── attachments ──
  const upload = useCallback(
    (chip: Chip) => {
      const run = async () => {
        if (!shown.current.some((x) => x.id === chip.id)) return;
        setChips((c) => c.map((x) => (x.id === chip.id ? { ...x, state: "uploading", error: undefined } : x)));
        try {
          const path = await uploadFile(client, sid, chip.file, phone);
          // Removed (or sent) while uploading: no stray path in the text.
          if (!shown.current.some((x) => x.id === chip.id)) return;
          setChips((c) => c.map((x) => (x.id === chip.id ? { ...x, path, state: "done", error: undefined } : x)));
          setText((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}${pathToken(path)} `);
        } catch (e) {
          const msg = (e as Error).message || "Upload failed";
          setChips((c) => c.map((x) => (x.id === chip.id ? { ...x, state: "error", error: msg } : x)));
          flash(`${chip.name}: ${msg}`);
        }
      };
      const next = uploads.current.then(run);
      uploads.current = next;
      return next;
    },
    [client, sid, phone, flash],
  );

  const addFiles = useCallback(
    async (list: File[]) => {
      if (!list.length) return;
      const added: Chip[] = list.map((f) => ({ id: chipId++, name: f.name || "image", file: f, state: "queued", url: isImage(f) ? URL.createObjectURL(f) : "" }));
      setChips((c) => [...c, ...added]);
      shown.current = [...shown.current, ...added];
      await Promise.all(added.map(upload));
      requestAnimationFrame(() => area.current?.focus());
    },
    [upload],
  );

  const retryChip = (c: Chip) => {
    setChips((all) => all.map((x) => (x.id === c.id ? { ...x, state: "queued", error: undefined } : x)));
    void upload(c);
  };

  const removeChip = (c: Chip) => {
    setChips((all) => all.filter((x) => x.id !== c.id));
    if (c.url) URL.revokeObjectURL(c.url);
    if (c.path) setText((t) => t.replace(pathToken(c.path!), "").replace(/ {2,}/g, " "));
  };

  const onPaste = (e: ClipboardEvent) => {
    const f = filesOf(e.clipboardData);
    if (f.length) {
      e.preventDefault();
      void addFiles(f);
    } else if (platform.readClipboardImage && !e.clipboardData?.getData("text/plain")) {
      // Android WebViews paste nothing for an image; the shell reads the clipboard itself.
      e.preventDefault();
      void platform.readClipboardImage().then((img) => img && addFiles([img])).catch(() => {});
    }
  };
  // Desktop shell: OS file drops arrive as local paths (this machine is the host), typed in directly.
  const card = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      platform.onFileDrop?.((d) => {
        const r = card.current?.getBoundingClientRect();
        if (!r || d.x < r.left || d.x > r.right || d.y < r.top || d.y > r.bottom) return;
        setText((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}${d.paths.map(pathToken).join(" ")} `);
        area.current?.focus();
      }),
    [platform],
  );
  useEffect(() => {
    const on = (e: Event) => void addFiles([(e as CustomEvent<File>).detail]);
    window.addEventListener("na-paste-image", on);
    return () => window.removeEventListener("na-paste-image", on);
  });
  const onDrop = (e: DragEvent) => {
    setDragging(false);
    const f = filesOf(e.dataTransfer);
    if (f.length) {
      e.preventDefault();
      void addFiles(f);
    }
  };

  const pasteButton = async () => {
    // A native shell can read the system clipboard when the WebView cannot.
    const native = await platform.readClipboardImage?.().catch(() => null);
    if (native) return void addFiles([native]);
    const r = await readClipboardFiles();
    if (r.files.length) void addFiles(r.files);
    else if (r.text) typeIn(r.text);
    else if (r.error) flash(r.error);
  };

  // ── dictation ──
  const dict = useDictation(client, (t) => typeIn(t), flash);

  // ── permission mode: the CLI only cycles (Shift+Tab), so step until the wanted mode shows ──
  const setMode = async (target: string) => {
    close();
    const cur = () => modeNow.current || "default";
    if (cur() === target || switching) return;
    setSwitching(target);
    const seen = new Set<string>([cur()]);
    try {
      for (let step = 0; step < MODES.length + 1; step++) {
        const before = cur();
        client.write(sid, "\x1b[Z");
        let waited = 0;
        while (cur() === before && waited < 1600) {
          await sleep(60);
          waited += 60;
        }
        if (cur() === target) return;
        if (cur() === before || seen.has(cur())) break;
        seen.add(cur());
      }
      flash(`${modeOf(target).label} isn't available in this session.`);
    } finally {
      setSwitching(null);
    }
  };

  // ── send ──
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    if (chips.some((c) => c.state === "queued" || c.state === "uploading")) return flash("Wait for the attachments to finish uploading.");
    // `/model` or `/effort` alone opens the picker; other menus come from the CLI.
    if (t === "/model" || t === "/effort") {
      setText("");
      setPopup(t === "/model" ? "model" : "effort");
      return;
    }
    void prompt(t);
    const cmd = /^\/([\w:.-]+)\s*$/.exec(t)?.[1];
    if (cmd && TERMINAL_COMMANDS.has(cmd)) onTerminal(`/${cmd}`);
    setText("");
    for (const c of chips) if (c.url) URL.revokeObjectURL(c.url);
    setChips([]);
    drafts.delete(sid);
    onSubmitted();
  };

  const onKey = (e: KeyboardEvent) => {
    if (menuOpen) {
      if (e.key === "ArrowDown") return e.preventDefault(), setMenu((m) => (m + 1) % items.length);
      if (e.key === "ArrowUp") return e.preventDefault(), setMenu((m) => (m - 1 + items.length) % items.length);
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && (atQ !== null || !phone))) {
        // a fully typed command goes straight out on Enter
        if (e.key === "Enter" && slashQ !== null && items[menu]?.label === `/${slashQ}`) return send(), e.preventDefault();
        return e.preventDefault(), accept(menu);
      }
      if (e.key === "Escape") return e.preventDefault(), setMenuOff(true);
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      client.write(sid, "\x1b[Z");
      return;
    }
    if (e.key === "Escape" && busy) {
      client.write(sid, "\x1b");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !phone) {
      e.preventDefault();
      send();
    }
  };

  const mode = modeOf(switching ?? meta.mode);
  const canSend = text.trim().length > 0 && !disabled;
  const alias = modelAlias(meta.model);
  const effort = meta.effort || DEFAULT_EFFORT;
  const tokens = meta.context_tokens ?? 0;
  const used = tokens ? Math.min(100, Math.round((tokens / contextLimit(meta.model)) * 100)) : 0;
  const placeholder = disabled ? "This session has ended" : dict.recording ? "Listening…" : empty ? "How can I help you today?" : busy ? "Queue another message…" : "Reply to Claude…";

  return (
    <div
      ref={card}
      className="relative"
      onDragOver={(e) => (e.dataTransfer.types.includes("Files") ? (e.preventDefault(), setDragging(true)) : null)}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {notice && (
        <div role="status" className="mb-2 flex items-start gap-2 rounded-cv-md bg-cv-surface px-3.5 py-2.5 text-cv-meta text-cv-text-2 shadow-cv-card animate-cv-rise">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="grid size-5 shrink-0 place-items-center rounded-full text-cv-muted hover:text-cv-text">
            <X size={13} />
          </button>
        </div>
      )}

      {menuOpen && (
        <div ref={list} role="listbox" aria-label={slashQ !== null ? "Commands" : "Files"} className="cv-scroll absolute inset-x-0 bottom-full z-20 mb-2 max-h-80 overflow-y-auto rounded-cv-md bg-cv-surface p-1.5 shadow-cv-pop animate-cv-pop">
          <div className="px-2.5 pt-1 pb-1.5 text-cv-meta text-cv-muted">{slashQ !== null ? "Commands" : "Files"}</div>
          {items.map((it, i) => (
            <button
              key={it.key}
              data-i={i}
              type="button"
              role="option"
              aria-selected={i === menu}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => accept(i)}
              onMouseEnter={() => setMenu(i)}
              className={cn("flex min-h-11 w-full items-center gap-3 rounded-cv-sm px-2.5 py-1.5 text-left transition-colors [[data-mode=phone]_&]:min-h-12", i === menu && "bg-cv-hover")}
            >
              {slashQ !== null ? (
                <>
                  <span className="shrink-0 font-cv-mono text-cv-code text-cv-text">{it.label}</span>
                  <span className="min-w-0 flex-1 truncate text-cv-meta text-cv-muted">{it.detail}</span>
                  {it.badge && <span className="shrink-0 rounded-full bg-cv-chip px-1.5 py-px text-cv-meta text-cv-muted">{it.badge}</span>}
                </>
              ) : (
                <>
                  <FileText size={16} strokeWidth={1.7} className="shrink-0 text-cv-muted" />
                  <span className="shrink-0 text-cv-ui text-cv-text">{it.label}</span>
                  <span className="min-w-0 flex-1 truncate text-right font-cv-mono text-cv-meta text-cv-muted [direction:rtl]">{it.detail}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      <div className={cn("rounded-cv-composer border border-cv-line-soft bg-cv-surface shadow-cv-composer transition duration-200 focus-within:border-cv-line", dragging && "border-cv-clay")}>
        {chips.length > 0 && (
          <div className="cv-noscrollbar flex gap-2 overflow-x-auto px-3 pt-3">
            {chips.map((c) => (
              <Thumb key={c.id} c={c} onRetry={() => retryChip(c)} onRemove={() => removeChip(c)} />
            ))}
          </div>
        )}
        <textarea
          ref={area}
          value={text}
          rows={1}
          disabled={disabled}
          onChange={(e) => (setText(e.target.value), setCaret(e.target.selectionStart))}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
          onPaste={onPaste}
          placeholder={placeholder}
          enterKeyHint={phone ? "enter" : "send"}
          autoCapitalize="sentences"
          aria-label="Message Claude"
          className="block min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 font-cv-sans text-cv-input text-cv-text outline-none placeholder:text-cv-placeholder disabled:opacity-60"
        />
        <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
          <Round label="Add files and more" active={popup === "plus"} onClick={() => toggle("plus")} trigger>
            <Plus size={20} strokeWidth={1.8} />
          </Round>
          <button
            type="button"
            data-cv-trigger
            onClick={() => toggle("mode")}
            aria-label={`Permission mode: ${mode.label}`}
            title={`${mode.label}: ${mode.hint} (Shift+Tab)`}
            className={cn(
              "flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-cv-meta transition-colors hover:bg-cv-hover",
              popup === "mode" && "bg-cv-hover",
              mode.warning ? "text-cv-danger" : mode.id === "default" ? "text-cv-muted" : "text-cv-text-2",
            )}
          >
            {switching ? <Loader size={15} className="animate-spin" /> : <mode.Icon size={15} strokeWidth={1.8} />}
            <span className={cn(phone && mode.id === "default" && "hidden")}>{phone ? mode.short : mode.label}</span>
          </button>
          <span className="min-w-0 flex-1" />
          {phone ? (
            <button type="button" data-cv-trigger onClick={() => toggle("model")} className="flex h-9 min-w-0 items-center gap-1 rounded-full px-2.5 text-cv-meta text-cv-text-2 transition-colors hover:bg-cv-hover" aria-label="Model and effort">
              <span className="shrink-0">{modelName(meta.model)}</span>
              <span className="min-w-0 truncate text-cv-muted">· {effortName(effort)}</span>
              <ChevronDown size={14} className="shrink-0 text-cv-muted" />
            </button>
          ) : (
            <>
              {used > 0 && <UsageRing pct={used} tokens={tokens} />}
              <Ghost label="Model" active={popup === "model"} onClick={() => toggle("model")}>{modelName(meta.model)}</Ghost>
              <Ghost label="Effort" active={popup === "effort"} onClick={() => toggle("effort")}>{effortName(effort)}</Ghost>
            </>
          )}
          <Round label={dict.recording ? "Stop dictation" : dict.busy ? "Transcribing…" : "Dictate"} active={dict.recording} onClick={dict.toggle}>
            {dict.busy ? <Loader size={18} className="animate-spin" /> : <Mic size={18} strokeWidth={1.8} className={cn(dict.recording && "text-cv-clay")} />}
          </Round>
          {busy && !canSend ? (
            <button type="button" onClick={() => client.write(sid, "\x1b")} aria-label="Stop" title="Stop (Esc)" className="grid size-9 shrink-0 place-items-center rounded-full bg-cv-primary text-cv-on-primary transition-transform active:scale-92">
              <span className="size-3 rounded-cv-xs bg-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              aria-label={busy ? "Queue message" : "Send"}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-cv-clay text-cv-on-clay transition duration-150 hover:bg-cv-clay-strong active:scale-92 disabled:opacity-40 disabled:active:scale-100"
            >
              <ArrowUp size={19} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      {/* ── pickers ── */}
      <Picker open={popup === "plus"} onClose={close} phone={phone} title="Add to chat">
        <PickRow icon={<Images size={19} strokeWidth={1.7} />} label="Photos" onClick={() => (close(), photos.current?.click())} />
        {phone && <PickRow icon={<Camera size={19} strokeWidth={1.7} />} label="Camera" onClick={() => (close(), camera.current?.click())} />}
        <PickRow icon={<Paperclip size={19} strokeWidth={1.7} />} label="Files" onClick={() => (close(), anyFile.current?.click())} />
        <PickRow icon={<ClipboardPaste size={19} strokeWidth={1.7} />} label="Paste from clipboard" onClick={() => (close(), void pasteButton())} />
        <PickSection>In the project</PickSection>
        <PickRow icon={<AtSign size={19} strokeWidth={1.7} />} label="Mention a file" hint="Type @ and a name" onClick={() => (close(), typeIn("@"))} />
        <PickRow icon={<Slash size={19} strokeWidth={1.7} />} label="Slash commands" hint="Skills, commands and settings" onClick={() => (close(), setText(""), typeIn("/"))} />
        <PickRow icon={<SquareTerminal size={19} strokeWidth={1.7} />} label="Open the terminal" hint="Every Claude Code menu" onClick={() => (close(), onTerminal("terminal"))} />
      </Picker>

      <Picker open={popup === "mode"} onClose={close} phone={phone} title="Permission mode" wide>
        {!phone && <PickSection first>Permission mode</PickSection>}
        {MODES.map((m) => (
          <PickRow
            key={m.id}
            icon={<m.Icon size={18} strokeWidth={1.7} />}
            label={m.label}
            hint={m.hint}
            danger={m.warning}
            checked={(meta.mode || "default") === m.id}
            onClick={() => void setMode(m.id)}
          />
        ))}
        <PickNote>Shift+Tab switches to the next mode.</PickNote>
      </Picker>

      <Picker open={popup === "model"} onClose={close} phone={phone} title="Model" align="end">
        {!phone && <PickSection first>Model</PickSection>}
        {MODELS.map((m) => (
          <PickRow key={m.alias} label={m.name} hint={m.hint} checked={alias === m.alias} onClick={() => (close(), void prompt(`/model ${m.alias}`))} />
        ))}
        <PickRow label={<span className="text-cv-text-2">All options in the terminal…</span>} onClick={() => (close(), void prompt("/model"), onTerminal("/model"))} />
        {phone && (
          <>
            <PickSection>Thinking</PickSection>
            <PickRow label="Effort" hint={EFFORTS.find((e) => e.level === effort)?.hint} trailing={<>{effortName(effort)}<ChevronRight size={17} /></>} onClick={() => setPopup("effort")} />
            {used > 0 && <PickNote>{`${used}% of the context is used (${tokens.toLocaleString()} tokens).`}</PickNote>}
          </>
        )}
      </Picker>

      <Picker open={popup === "effort"} onClose={close} phone={phone} title="Effort" align="end">
        {!phone && <PickSection first>Effort</PickSection>}
        {EFFORTS.map((e) => (
          <PickRow
            key={e.level}
            label={e.name}
            hint={e.hint}
            badge={e.level === DEFAULT_EFFORT ? "Default" : undefined}
            checked={effort === e.level}
            onClick={() => (close(), void prompt(`/effort ${e.level}`))}
          />
        ))}
        <PickNote>{EFFORT_NOTE}</PickNote>
        {meta.effort && meta.effort !== DEFAULT_EFFORT && <PickRow label={<span className="text-cv-text-2">Reset to default</span>} onClick={() => (close(), void prompt("/effort auto"))} />}
      </Picker>

      <input ref={photos} type="file" accept="image/*" multiple hidden onChange={(e) => (void addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
      <input ref={anyFile} type="file" multiple hidden onChange={(e) => (void addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
    </div>
  );
}

function Round({ children, label, active, trigger, onClick }: { children: ReactNode; label: string; active?: boolean; trigger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-cv-trigger={trigger || undefined}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn("grid size-9 shrink-0 place-items-center rounded-full text-cv-text-2 transition-colors hover:bg-cv-hover hover:text-cv-text active:bg-cv-press", active && "bg-cv-hover text-cv-text")}
    >
      {children}
    </button>
  );
}

function Ghost({ children, label, active, onClick }: { children: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-cv-trigger
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn("flex h-8 max-w-40 shrink-0 items-center gap-1 rounded-cv-sm px-2 text-cv-meta text-cv-text-2 transition-colors hover:bg-cv-hover hover:text-cv-text", active && "bg-cv-hover text-cv-text")}
    >
      <span className="truncate">{children}</span>
      <ChevronDown size={13} className="shrink-0 text-cv-muted" />
    </button>
  );
}

function UsageRing({ pct, tokens }: { pct: number; tokens: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const label = `${pct}% of the context used (${tokens.toLocaleString()} tokens)`;
  return (
    <span title={label} aria-label={label} role="img" className="grid size-8 shrink-0 place-items-center">
      <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90">
        <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" className="stroke-cv-line-strong" />
        <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className={pct > 85 ? "stroke-cv-warning" : "stroke-cv-text-2"} />
      </svg>
    </span>
  );
}

function Thumb({ c, onRetry, onRemove }: { c: Chip; onRetry: () => void; onRemove: () => void }) {
  const ext = /\.([a-z0-9]+)$/i.exec(c.name)?.[1]?.toUpperCase();
  return (
    <div className="relative shrink-0 pt-1.5 pr-1.5">
      <div className={cn("relative size-16 overflow-hidden rounded-cv-md border bg-cv-sunken", c.state === "error" ? "border-cv-danger" : "border-cv-line-soft")} title={c.error ?? c.path ?? c.name}>
        {c.url ? (
          <img src={c.url} alt={c.name} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 px-1 text-cv-muted">
            <FileText size={18} strokeWidth={1.6} />
            <span className="max-w-full truncate text-cv-meta">{ext ?? "File"}</span>
          </div>
        )}
        {(c.state === "queued" || c.state === "uploading") && (
          <div className="absolute inset-0 grid place-items-center bg-cv-scrim" role="status" aria-label={c.state === "queued" ? "Waiting to upload" : "Uploading"}>
            <Loader size={18} className={cn("text-cv-on-primary", c.state === "uploading" ? "animate-spin" : "opacity-60")} />
          </div>
        )}
        {c.state === "error" && (
          <button type="button" onClick={onRetry} aria-label={`Retry ${c.name}: ${c.error}`} className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-cv-danger-soft px-1 text-center text-cv-meta text-cv-danger">
            <RotateCw size={15} />
            Retry
          </button>
        )}
      </div>
      <button type="button" aria-label={`Remove ${c.name}`} onClick={onRemove} className="absolute top-0 right-0 grid size-5 place-items-center rounded-full border-2 border-cv-surface bg-cv-primary text-cv-on-primary after:absolute after:-inset-2">
        <X size={11} strokeWidth={2.6} />
      </button>
    </div>
  );
}
