/** The input at the bottom: text, `/` commands, `@` files, images, dictation, model and mode. */
import type { CvCommand, CvMeta } from "@neuralagent/protocol";
import { cn, IconButton } from "@neuralagent/ui";
import { ArrowUp, AtSign, Camera, ClipboardPaste, Command, Image as ImageIcon, Loader, Mic, Plus, Square, SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { useClient, usePlatform } from "../../lib/store";
import { filesOf, isImage, pathToken, readClipboardFiles, uploadFile } from "./files";
import { MODELS, MODES, TERMINAL_COMMANDS, modelName } from "./models";
import { useDictation } from "./useDictation";

interface Chip {
  id: number;
  name: string;
  url: string;
  path?: string;
  error?: string;
}

const drafts = new Map<string, string>();
let chipId = 1;

export function Composer({ sid, meta, busy, phone, disabled, onTerminal, onSubmitted }: {
  sid: string;
  meta: CvMeta;
  busy: boolean;
  phone: boolean;
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
  const [popup, setPopup] = useState<"model" | "plus" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const lastFetch = useRef(0);
  const history = useRef<string[]>([]);

  useEffect(() => {
    drafts.set(sid, text);
  }, [sid, text]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, phone ? 140 : 220)}px`;
  }, [text, phone]);

  const flash = useCallback((m: string) => {
    setNotice(m);
    setTimeout(() => setNotice((cur) => (cur === m ? null : cur)), 4000);
  }, []);

  // ── menus ──
  const slash = /^\/([^\s]*)$/.exec(text.slice(0, caret));
  const at = !slash ? /(^|\s)@([^\s]*)$/.exec(text.slice(0, caret)) : null;
  const slashQ = slash ? slash[1]! : null;
  const atQ = at ? at[2]! : null;

  useEffect(() => {
    if (slashQ === null) return;
    // Commands change (new files in ~/.claude/commands, skills): look again when the menu opens.
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
        ? files.map((f) => ({ key: f, label: f.split("/").pop() ?? f, detail: f }))
        : [];
  const menuOpen = items.length > 0 && !menuOff;
  useEffect(() => setMenu(0), [slashQ, atQ]);
  useEffect(() => setMenuOff(false), [slashQ, atQ]);

  const insertAt = (replace: RegExp, value: string) => {
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const next = before.replace(replace, value) + after;
    setText(next);
    const pos = before.replace(replace, value).length;
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const accept = (i: number) => {
    const it = items[i];
    if (!it) return;
    if (slashQ !== null) insertAt(/^\/[^\s]*$/, `${it.label} `);
    else insertAt(/@[^\s]*$/, `@${it.detail} `);
  };

  // ── images ──
  const addFiles = useCallback(
    async (list: File[]) => {
      if (!list.length) return;
      const added: Chip[] = list.map((f) => ({ id: chipId++, name: f.name || "image", url: isImage(f) ? URL.createObjectURL(f) : "" }));
      setChips((c) => [...c, ...added]);
      await Promise.all(
        list.map(async (f, i) => {
          const chip = added[i]!;
          try {
            const path = await uploadFile(client, sid, f);
            setChips((c) => c.map((x) => (x.id === chip.id ? { ...x, path } : x)));
            setText((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}${pathToken(path)} `);
          } catch (e) {
            const msg = (e as Error).message || "Upload failed";
            setChips((c) => c.map((x) => (x.id === chip.id ? { ...x, error: msg } : x)));
          }
        }),
      );
      requestAnimationFrame(() => area.current?.focus());
    },
    [client, sid],
  );

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
  useEffect(
    () =>
      platform.onFileDrop?.((d) => {
        const r = area.current?.closest(".relative")?.getBoundingClientRect();
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
    else if (r.text) {
      setText((t) => t + r.text);
      area.current?.focus();
    } else if (r.error) flash(r.error);
  };

  // ── dictation ──
  const dict = useDictation(client, (t) => {
    setText((cur) => `${cur}${cur && !/\s$/.test(cur) ? " " : ""}${t}`);
    requestAnimationFrame(() => area.current?.focus());
  }, flash);

  // ── send ──
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    history.current.unshift(t);
    // `/model` alone opens the picker; other menus come from the CLI.
    if (t === "/model") {
      setText("");
      setPopup("model");
      return;
    }
    client.req({ m: "session_prompt", p: { id: sid, text: t } }).catch((e: Error) => flash(e.message));
    const cmd = /^\/([\w:.-]+)\s*$/.exec(t)?.[1];
    if (cmd && TERMINAL_COMMANDS.has(cmd)) onTerminal(`/${cmd}`);
    setText("");
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

  const modeInfo = MODES[meta.mode ?? "default"] ?? { label: meta.mode ?? "Ask", hint: "" };
  const canSend = (text.trim().length > 0 || chips.length > 0) && !disabled;

  return (
    <div className="relative shrink-0 px-3 pb-3" onDragOver={(e) => (e.dataTransfer.types.includes("Files") ? (e.preventDefault(), setDragging(true)) : null)} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {notice && <div role="status" className="mb-2 rounded-item bg-fill-3 px-3 py-1.5 text-small text-ink">{notice}</div>}
      {menuOpen && (
        <div className="glass absolute inset-x-3 bottom-full z-20 mb-1 max-h-72 overflow-y-auto rounded-menu p-1 shadow-menu" role="listbox">
          {items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              role="option"
              aria-selected={i === menu}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => accept(i)}
              onMouseEnter={() => setMenu(i)}
              className={cn("flex w-full items-baseline gap-3 rounded-item px-3 py-1.5 text-left", i === menu && "bg-fill-3")}
            >
              <span className={cn("shrink-0 text-chip", slashQ !== null ? "font-mono text-bright" : "text-bright")}>{it.label}</span>
              <span className="min-w-0 flex-1 truncate text-small text-dim">{it.detail}</span>
              {it.badge && <span className="shrink-0 text-meta text-faint">{it.badge}</span>}
            </button>
          ))}
        </div>
      )}
      <div className={cn("well rounded-list p-2 transition-shadow", dragging && "shadow-well-focus")}>
        {chips.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {chips.map((c) => (
              <div key={c.id} className={cn("relative size-16 overflow-hidden rounded-item bg-fill-3", c.error && "shadow-well-focus")} title={c.error ?? c.path ?? c.name}>
                {c.url ? <img src={c.url} alt={c.name} className="size-full object-cover" /> : <div className="grid size-full place-items-center px-1 text-center text-tiny text-dim">{c.name}</div>}
                {!c.path && !c.error && <div className="absolute inset-0 grid place-items-center bg-bg/60"><Loader size={16} className="animate-spin text-ink" /></div>}
                {c.error && <div className="absolute inset-0 grid place-items-center bg-bg/70 px-1 text-center text-tiny text-danger">Failed</div>}
                <button type="button" aria-label={`Remove ${c.name}`} onClick={() => removeChip(c)} className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-bg/80 text-ink">
                  <X size={11} />
                </button>
              </div>
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
          placeholder={disabled ? "This session has ended" : dict.recording ? "Listening…" : phone ? "Message Claude" : "Message Claude — / for commands, @ for files"}
          enterKeyHint={phone ? "enter" : "send"}
          autoCapitalize="sentences"
          aria-label="Message Claude"
          className="block max-h-56 min-h-8 w-full resize-none bg-transparent px-2 py-1 text-input text-bright outline-none placeholder:text-faint @xl:text-body"
        />
        <div className="mt-1 flex items-center gap-1">
          <div className="relative">
            <IconButton size="sm" variant="ghost" label="Add" onClick={() => setPopup(popup === "plus" ? null : "plus")}>
              <Plus />
            </IconButton>
            {popup === "plus" && (
              <Pop onClose={() => setPopup(null)} className="bottom-full left-0 mb-2 w-56">
                <PopItem icon={<ImageIcon size={15} />} onClick={() => (setPopup(null), picker.current?.click())}>Photo or image</PopItem>
                {phone && <PopItem icon={<Camera size={15} />} onClick={() => (setPopup(null), camera.current?.click())}>Take a photo</PopItem>}
                <PopItem icon={<ClipboardPaste size={15} />} onClick={() => (setPopup(null), void pasteButton())}>Paste from clipboard</PopItem>
                <PopItem icon={<AtSign size={15} />} onClick={() => (setPopup(null), setText((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}@`), area.current?.focus())}>Mention a file</PopItem>
                <PopItem icon={<Command size={15} />} onClick={() => (setPopup(null), setText("/"), area.current?.focus())}>Slash commands</PopItem>
                <PopItem icon={<SquareTerminal size={15} />} onClick={() => (setPopup(null), onTerminal("terminal"))}>Open the terminal</PopItem>
              </Pop>
            )}
          </div>
          <button
            type="button"
            onClick={() => client.write(sid, "\x1b[Z")}
            title={`${modeInfo.hint} — tap to change (Shift+Tab)`}
            className={cn("hoverable h-8 min-w-0 truncate rounded-full px-3 text-chip", meta.mode === "plan" ? "text-signal-teal" : meta.mode === "acceptEdits" || meta.mode === "auto" ? "text-signal-green" : meta.mode === "bypassPermissions" ? "text-warning" : "text-dim")}
          >
            {modeInfo.label}
          </button>
          <span className="flex-1" />
          <div className="relative">
            <button type="button" onClick={() => setPopup(popup === "model" ? null : "model")} className="hoverable h-8 max-w-36 truncate rounded-full px-3 text-chip text-dim" aria-label="Model">
              {modelName(meta.model)}
            </button>
            {popup === "model" && (
              <Pop onClose={() => setPopup(null)} className="right-0 bottom-full mb-2 w-72">
                <div className="px-3 py-1.5 text-meta text-faint">Model</div>
                {MODELS.map((m) => (
                  <PopItem
                    key={m.alias}
                    onClick={() => {
                      setPopup(null);
                      client.req({ m: "session_prompt", p: { id: sid, text: `/model ${m.alias}` } }).catch((e: Error) => flash(e.message));
                    }}
                  >
                    <span className="flex flex-col">
                      <span className="text-chip text-bright">{m.name}</span>
                      <span className="text-meta text-dim">{m.hint}</span>
                    </span>
                  </PopItem>
                ))}
                <PopItem onClick={() => (setPopup(null), client.req({ m: "session_prompt", p: { id: sid, text: "/model" } }).catch(() => {}), onTerminal("/model"))}>
                  <span className="text-chip text-dim">All options in the terminal…</span>
                </PopItem>
              </Pop>
            )}
          </div>
          <IconButton size="sm" variant={dict.recording ? "tint" : "ghost"} label={dict.recording ? "Stop dictation" : dict.busy ? "Transcribing…" : "Dictate"} onClick={dict.toggle}>
            {dict.busy ? <Loader className="animate-spin" /> : dict.recording ? <Square /> : <Mic />}
          </IconButton>
          {busy && !canSend ? (
            <IconButton size="sm" variant="tint" label="Stop" onClick={() => client.write(sid, "\x1b")}>
              <Square />
            </IconButton>
          ) : (
            <IconButton size="sm" variant="solid" label="Send" className={canSend ? "" : "pointer-events-none opacity-40"} onClick={send}>
              <ArrowUp />
            </IconButton>
          )}
        </div>
      </div>
      <input ref={picker} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => (void addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
    </div>
  );
}

function Pop({ children, className, onClose }: { children: React.ReactNode; className?: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    const click = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-pop]")) onClose();
    };
    window.addEventListener("keydown", h);
    const t = setTimeout(() => window.addEventListener("click", click), 0);
    return () => {
      window.removeEventListener("keydown", h);
      clearTimeout(t);
      window.removeEventListener("click", click);
    };
  }, [onClose]);
  return (
    <div data-pop className={cn("glass absolute z-30 rounded-menu p-1 shadow-menu", className)} role="menu">
      {children}
    </div>
  );
}

function PopItem({ children, icon, onClick }: { children: React.ReactNode; icon?: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="hoverable flex w-full items-center gap-3 rounded-item px-3 py-2 text-left text-chip text-ink">
      {icon && <span className="text-dim">{icon}</span>}
      {children}
    </button>
  );
}
