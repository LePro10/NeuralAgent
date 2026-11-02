/**
 * The input at the bottom, shaped like Claude's. Resting: one 48px pill (attach "+", the text,
 * mic ↔ send, stop while Claude works). Focused or holding text, a second row grows in:
 * permission mode, model · effort, "/" (command palette), "@" (files) and the
 * context ring (background work sits in the strip above it, `WorkStrip`). It grows to about 40%
 * of the visible height, then scrolls inside.
 * Choices pour out of it on phones (`Picker`) and open as popovers above it on desktop.
 * `!cmd` runs a shell command (the CLI's bash mode), `# note` asks Claude to save a memory.
 */
import type { CvCommand, CvMessage, CvMeta } from "@neuralagent/protocol";
import { cn, prefersReducedMotion } from "@neuralagent/ui";
import { ArrowUp, AtSign, BookmarkPlus, Camera, ChevronDown, ChevronRight, ClipboardPaste, FileText, Images, Loader, Mic, Paperclip, Plus, RotateCw, Slash, SquareTerminal, Terminal, X, Zap } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useClient, usePlatform } from "../../lib/store";
import { takeInsert } from "../files/send";
import { act, cycleMode, memoryPrompt, resolveInput, runKeys, sendPrompt, serverActions, shellSteps, type Armed, typedMode } from "./actions";
import { CommandPalette } from "./CommandPalette";
import { type Command, mergeCommands, opensDialog, saveRecent, searchCommands } from "./commands";
import { ContextRing, ContextSheet } from "./ContextSheet";
import { filesOf, isImage, pastedImages, pathToken, readClipboardFiles, uploadFile } from "./files";
import { contextOf, fastOf, queuedOf } from "./metaInfo";
import { DEFAULT_EFFORT, EFFORT_NOTE, EFFORTS, effortName, MODELS, MODES, modeOf, modelAlias, modelName } from "./models";
import { PickNote, PickRow, PickSection, Picker } from "./Picker";
import { addQueued, expire, type Queued, reconcile, SEND_NOW, shownQueue, TAKE_BACK } from "./queue";
import { QueueChips } from "./QueueChips";
import { RewindSheet } from "./RewindSheet";
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
const draftModes = new Map<string, Armed>();
/** Messages sent while Claude worked, per session (the client's guess until the daemon reports the queue). */
const queues = new Map<string, Queued[]>();
/** Modes this session has shown (bypass / don't ask only exist when Claude was started with them). */
const seenModes = new Map<string, Set<string>>();
let chipId = 1;

export interface ComposerProps {
  sid: string;
  meta: CvMeta;
  busy: boolean;
  phone: boolean;
  /** Nothing said yet: the greeting placeholder. */
  empty?: boolean;
  disabled?: boolean;
  /** Hidden while a prompt card takes its place (it stays mounted so drafts and uploads survive). */
  hidden?: boolean;
  /** The conversation: queued chips clear once their message arrives. */
  messages?: CvMessage[];
  /** A command that needs the terminal UI was sent. */
  onTerminal: (why: string) => void;
  onSubmitted: () => void;
  /** Opens the Tasks sheet (subagents, background shells); without it `/tasks` opens the terminal. */
  onTasks?: () => void;
}

export function Composer({ sid, meta, busy, phone, empty, disabled, hidden, messages, onTerminal, onSubmitted, onTasks }: ComposerProps) {
  const client = useClient();
  const platform = usePlatform();
  const [text, setText] = useState(() => drafts.get(sid) ?? "");
  const [armed, setArmed] = useState<Armed>(() => draftModes.get(sid) ?? null);
  const [caret, setCaret] = useState(0);
  const [chips, setChips] = useState<Chip[]>([]);
  const [daemonCommands, setDaemonCommands] = useState<CvCommand[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [menu, setMenu] = useState(0);
  const [menuOff, setMenuOff] = useState(false);
  const [popup, setPopup] = useState<Popup>(null);
  const [palette, setPalette] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [queue, setQueue] = useState<Queued[]>(() => queues.get(sid) ?? []);
  const [cap, setCap] = useState(168);
  const area = useRef<HTMLTextAreaElement>(null);
  const capsule = useRef<HTMLDivElement>(null);
  const sendIcon = useRef<HTMLSpanElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const anyFile = useRef<HTMLInputElement>(null);
  const lastFetch = useRef(0);
  const pressing = useRef(false);
  const idleSince = useRef(0);
  /** Uploads go one after another: seven photos at once only made all seven slow (and time out together). */
  const uploads = useRef<Promise<void>>(Promise.resolve());
  const shown = useRef(chips);
  shown.current = chips;
  const modeNow = useRef(meta.mode);
  modeNow.current = meta.mode;

  useEffect(() => {
    drafts.set(sid, text);
    draftModes.set(sid, armed);
  }, [sid, text, armed]);

  useEffect(() => {
    queues.set(sid, queue);
  }, [sid, queue]);

  useEffect(() => {
    if (!meta.mode) return;
    const s = seenModes.get(sid) ?? new Set<string>();
    s.add(meta.mode);
    seenModes.set(sid, s);
  }, [sid, meta.mode]);

  // ── queue: drop chips that arrived in the transcript, or once the turn has been over a while ──
  const sent = useMemo(() => recentPrompts(messages), [messages]);
  useEffect(() => {
    if (sent.length) setQueue((q) => reconcile(q, sent));
  }, [sent]);
  useEffect(() => {
    if (busy) {
      idleSince.current = 0;
      return;
    }
    idleSince.current = Date.now();
    const t = setTimeout(() => setQueue((q) => expire(q, false, idleSince.current, Date.now())), 6500);
    return () => clearTimeout(t);
  }, [busy]);
  const queued = shownQueue(queue, queuedOf(meta));

  // ── height: up to ~40% of what is visible (phone), then the text scrolls ──
  useEffect(() => {
    if (!phone) return setCap(280);
    const vv = window.visualViewport;
    const fit = () => setCap(Math.max(72, Math.round((vv?.height ?? window.innerHeight) * 0.4) - 64));
    fit();
    vv?.addEventListener("resize", fit);
    return () => vv?.removeEventListener("resize", fit);
  }, [phone]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, [text, cap, hidden]);

  const flash = useCallback((m: string) => {
    setNotice(m);
    setTimeout(() => setNotice((cur) => (cur === m ? null : cur)), 4000);
  }, []);
  const close = useCallback(() => setPopup(null), []);
  const toggle = (p: Exclude<Popup, null>) => setPopup((cur) => (cur === p ? null : p));
  const prompt = (t: string) => sendPrompt(client, sid, t).catch((e: Error) => flash(e.message));
  const live = serverActions(meta);
  const stop = () => void act(client, sid, live, { k: "interrupt" }, [{ write: "\x1b" }]).catch((e: Error) => flash(e.message));

  // ── commands (the palette and the `/` list) ──
  const loadCommands = useCallback(
    (force = false) => {
      // Commands change (new files in ~/.claude/commands, skills): look again when a list opens.
      if (!force && Date.now() - lastFetch.current < 15_000) return;
      lastFetch.current = Date.now();
      client.req<CvCommand[]>({ m: "cv_commands", p: { sid } }).then(setDaemonCommands).catch(() => {});
    },
    [client, sid],
  );
  const commands = useMemo(() => mergeCommands(daemonCommands), [daemonCommands]);

  // ── `/` and `@` lists ──
  const slash = /^\/([^\s]*)$/.exec(text.slice(0, caret));
  const at = !slash ? /(^|\s)@([^\s]*)$/.exec(text.slice(0, caret)) : null;
  const slashQ = slash ? slash[1]! : null;
  const atQ = at ? at[2]! : null;

  useEffect(() => {
    if (slashQ !== null) loadCommands();
  }, [slashQ === null, loadCommands]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (atQ === null) return;
    const t = setTimeout(() => client.req<string[]>({ m: "cv_files", p: { sid, query: atQ } }).then(setFiles).catch(() => setFiles([])), 100);
    return () => clearTimeout(t);
  }, [atQ, client, sid]);

  const cmdItems = useMemo(() => (slashQ === null ? [] : searchCommands(commands, slashQ, phone, phone ? 24 : 40)), [commands, slashQ, phone]);

  const items: { key: string; label: string; detail: string; badge?: string; args?: string; cmd?: Command }[] =
    slashQ !== null
      ? cmdItems.map((c) => ({ key: c.name, label: `/${c.name}`, detail: c.description, badge: c.source === "builtin" ? undefined : c.source, args: c.args, cmd: c }))
      : atQ !== null
        ? files.map((f) => ({ key: f, label: f.split("/").filter(Boolean).pop() ?? f, detail: f }))
        : [];
  const menuOpen = items.length > 0 && !menuOff && !hidden;
  useEffect(() => setMenu(0), [slashQ, atQ]);
  useEffect(() => setMenuOff(false), [slashQ, atQ]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${menu}"]`)?.scrollIntoView({ block: "nearest" });
  }, [menu]);

  const focusEnd = (pos?: number) =>
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      const p = pos ?? el.value.length;
      el.setSelectionRange(p, p);
      setCaret(p);
    });

  const insertAt = (replace: RegExp, value: string) => {
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const head = before.replace(replace, value);
    setText(head + after);
    focusEnd(head.length);
  };

  const accept = (i: number) => {
    const it = items[i];
    if (!it) return;
    if (slashQ !== null) {
      // Model, effort, context…: the app's own screen instead of a command line.
      if (it.cmd?.kind === "native" && !text.slice(caret).trim() && native(it.cmd.native ?? it.cmd.name)) return setText("");
      insertAt(/^\/[^\s]*$/, `${it.label} `);
    } else insertAt(/@[^\s]*$/, `@${it.detail} `);
  };

  const typeIn = (s: string) => {
    setText((t) => `${t}${t && !/\s$/.test(t) && s !== "/" ? " " : ""}${s}`);
    focusEnd();
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
    const got = pastedImages(e, platform.readClipboardImage);
    if (got) void got.then((f) => { if (f.length) void addFiles(f); });
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
  // Files' "Send to agent" (files/send.ts): paths queued for this agent's next message.
  useEffect(() => {
    const take = () => {
      const t = takeInsert(sid);
      if (t) setText((x) => `${x}${x && !/\s$/.test(x) ? " " : ""}${t} `);
    };
    take();
    window.addEventListener("na-insert-text", take);
    return () => window.removeEventListener("na-insert-text", take);
  }, [sid]);
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
    try {
      if (live) await client.cvAction(sid, { k: "set_mode", mode: target });
      else if (!(await cycleMode(client, sid, cur, target, MODES.length + 1))) flash(`${modeOf(target).label} isn't available in this session.`);
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setSwitching(null);
    }
  };

  /** The app's own screen for a command; false when there is none. */
  const native = (name: string): boolean => {
    switch (name) {
      case "mode":
        setPopup("mode");
        return true;
      case "model":
        setPopup("model");
        return true;
      case "effort":
        setPopup("effort");
        return true;
      case "context":
      case "usage":
      case "cost":
      case "stats":
        setContextOpen(true);
        return true;
      case "tasks":
      case "bashes":
        if (!onTasks) return false;
        onTasks();
        return true;
      case "rewind":
      case "checkpoint":
      case "undo":
        flash("Long-press one of your messages and choose Rewind to here.");
        return true;
      case "fast":
        setFast(!fastOf(meta));
        return true;
      default:
        return false;
    }
  };

  const setFast = (on: boolean) => void act(client, sid, live, { k: "fast", on }, [{ prompt: on ? "/fast on" : "/fast off" }]).catch((e: Error) => flash(e.message));
  const setModel = (m: string) => void act(client, sid, live, { k: "model", model: m }, [{ prompt: `/model ${m}` }]).catch((e: Error) => flash(e.message));
  const setEffort = (l: string) => void act(client, sid, live, { k: "effort", level: l }, [{ prompt: `/effort ${l}` }]).catch((e: Error) => flash(e.message));

  // ── send ──
  const squash = () => {
    if (prefersReducedMotion()) return;
    capsule.current?.animate(
      [{ transform: "scale(1, 1)" }, { transform: "scale(1.012, 1.022)", offset: 0.3 }, { transform: "scale(0.985, 0.965)", offset: 0.62 }, { transform: "scale(1, 1)" }],
      { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    sendIcon.current?.animate(
      [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-14px)", opacity: 0, offset: 0.5 }, { transform: "translateY(10px)", opacity: 0, offset: 0.51 }, { transform: "translateY(0)", opacity: 1 }],
      { duration: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  };

  /** `!` and `#` mode lines (the chip is on): the text is the command or the note, without the prefix. */
  const submitArmed = (t: string, mode: "shell" | "memory"): boolean => {
    const { body } = resolveInput(mode, t);
    if (!body) return false;
    if (mode === "shell") void act(client, sid, live, { k: "shell", command: body }, shellSteps(body)).catch((e: Error) => flash(e.message));
    else {
      void prompt(memoryPrompt(body));
      if (busy) setQueue((q) => addQueued(q, body, Date.now()));
    }
    return true;
  };

  /** Sends a line the way the CLI expects it; returns false when nothing went out. */
  const submit = (t: string, mode: Armed = null): boolean => {
    if (mode) return submitArmed(t, mode);
    const bare = /^\/([\w:.-]+)\s*$/.exec(t)?.[1];
    // `/model`, `/effort`, `/context`… alone open the app's own screen.
    if (bare && native(bare)) return true;
    if (t.startsWith("/")) {
      const name = /^\/([\w:.-]+)/.exec(t)?.[1];
      if (name) saveRecent(name);
    }
    void prompt(t);
    if (busy && !t.startsWith("/")) setQueue((q) => addQueued(q, t, Date.now()));
    if (opensDialog(t, commands)) onTerminal(`/${/^\/([\w:.-]+)/.exec(t)?.[1] ?? ""}`);
    return true;
  };

  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    if (chips.some((c) => c.state === "queued" || c.state === "uploading")) return flash("Wait for the attachments to finish uploading.");
    if (!submit(t, armed)) return;
    squash();
    setText("");
    setArmed(null);
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
    if (e.key === "Backspace" && armed && !text) return e.preventDefault(), setArmed(null);
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      client.write(sid, "\x1b[Z");
      return;
    }
    if (e.key === "Escape" && busy) return stop();
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !phone) {
      e.preventDefault();
      send();
    }
  };

  // ── focus: the second row stays while a finger is down inside (a tap on it blurs the field first) ──
  useEffect(() => {
    const up = () => setTimeout(() => (pressing.current = false), 400);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);
  const onBlur = () => {
    const check = () => {
      if (pressing.current) return void setTimeout(check, 120);
      setFocused(document.activeElement === area.current);
    };
    setTimeout(check, 0);
  };

  const mode = modeOf(switching ?? meta.mode);
  const canSend = text.trim().length > 0 && !disabled;
  const alias = modelAlias(meta.model);
  const effort = meta.effort || DEFAULT_EFFORT;
  const ctx = contextOf(meta);
  const fast = fastOf(meta);
  const kind = armed ?? "prompt";
  const expanded = !phone || focused || text.length > 0 || chips.length > 0 || popup !== null;
  const placeholder = disabled
    ? "This session has ended"
    : dict.recording
      ? "Listening…"
      : kind === "shell"
        ? "Shell command"
        : empty
          ? "How can I help you today?"
          : busy
            ? "Queue another message…"
            : "Reply to Claude…";
  const modes = MODES.filter((m) => !["bypassPermissions", "dontAsk"].includes(m.id) || seenModes.get(sid)?.has(m.id) || meta.mode === m.id);

  return (
    <div
      ref={card}
      className={cn("relative", hidden && "hidden")}
      onPointerDownCapture={() => (pressing.current = true)}
      onDragOver={(e) => (e.dataTransfer.types.includes("Files") ? (e.preventDefault(), setDragging(true)) : null)}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {notice && (
        <div role="status" className="mb-2 flex items-start gap-2 rounded-cv-md bg-cv-surface px-3.5 py-2.5 text-cv-meta text-cv-text-2 shadow-cv-card animate-cv-rise">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="relative grid size-5 shrink-0 place-items-center rounded-full text-cv-muted after:absolute after:-inset-3 hover:text-cv-text">
            <X size={13} />
          </button>
        </div>
      )}

      {queued.length > 0 && !disabled && (
        <QueueChips
          items={queued}
          busy={busy}
          onSendNow={() => void act(client, sid, live, { k: "send_queued_now" }, [{ write: SEND_NOW }]).catch((e: Error) => flash(e.message))}
          onTakeBack={() => {
            void runKeys(client, sid, [{ write: TAKE_BACK[0] }, { wait: 200 }, { write: TAKE_BACK[1] }]);
            setText((t) => [t.trim(), ...queued.map((q) => q.text)].filter(Boolean).join("\n"));
            setQueue([]);
            focusEnd();
          }}
        />
      )}

      {menuOpen && (
        <div ref={list} role="listbox" aria-label={slashQ !== null ? "Commands" : "Files"} className="cv-scroll absolute inset-x-0 bottom-full z-20 mb-2 max-h-80 overflow-y-auto rounded-cv-card bg-cv-surface p-1.5 shadow-cv-pop animate-cv-pop">
          <div className="flex items-center px-2.5 pt-1 pb-1.5 text-cv-meta text-cv-muted">
            <span className="flex-1">{slashQ !== null ? "Commands" : "Files"}</span>
            {slashQ !== null && (
              <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => (setText(""), setPalette(true))} className="relative rounded-full px-2 text-cv-meta text-cv-text-2 after:absolute after:-inset-2 hover:text-cv-text">
                All commands
              </button>
            )}
          </div>
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
                  <span className="shrink-0 font-cv-mono text-cv-code text-cv-text">
                    {it.label}
                    {it.args && <span className="text-cv-muted"> {it.args}</span>}
                  </span>
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

      <div
        ref={capsule}
        className={cn(
          "relative border bg-cv-surface shadow-cv-composer transition-colors duration-200 focus-within:border-cv-line",
          expanded ? "rounded-cv-card" : "rounded-cv-composer",
          popup && phone && "z-30",
          dragging ? "border-cv-clay" : kind === "shell" ? "border-cv-line-strong" : "border-cv-line-soft",
        )}
      >
        {chips.length > 0 && (
          <div className="cv-noscrollbar flex gap-2 overflow-x-auto px-3 pt-3">
            {chips.map((c) => (
              <Thumb key={c.id} c={c} onRetry={() => retryChip(c)} onRemove={() => removeChip(c)} />
            ))}
          </div>
        )}
        <div className="flex items-end gap-0.5 p-1">
          <Round label="Add files and more" active={popup === "plus"} onClick={() => toggle("plus")} trigger>
            <Plus size={21} strokeWidth={1.8} />
          </Round>
          {kind !== "prompt" && (
            <span className="mb-3 inline-flex shrink-0 items-center gap-1 rounded-full bg-cv-chip py-px pl-2 pr-1 font-cv-mono text-cv-meta text-cv-text-2" title={kind === "shell" ? "Runs in the shell, like ! in Claude Code" : "Claude adds this to CLAUDE.md"}>
              {kind === "shell" ? "Shell" : "Memory"}
              <button type="button" aria-label="Leave this mode" onPointerDown={(e) => e.preventDefault()} onClick={() => (setArmed(null), area.current?.focus())} className="rounded-full px-1 hover:text-cv-text">
                ×
              </button>
            </span>
          )}
          <textarea
            ref={area}
            value={text}
            rows={1}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              const m = armed ? null : typedMode(text, v, (e.nativeEvent as InputEvent).inputType);
              if (m) setArmed(m), setText("");
              else setText(v);
              setCaret(m ? 0 : e.target.selectionStart);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKey}
            onPaste={onPaste}
            onFocus={() => setFocused(true)}
            onBlur={onBlur}
            placeholder={placeholder}
            enterKeyHint={phone ? "enter" : "send"}
            autoCapitalize="sentences"
            aria-label="Message Claude"
            className={cn(
              "cv-scroll block min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-2.5 text-cv-input text-cv-text outline-none placeholder:text-cv-placeholder disabled:opacity-60",
              kind === "shell" ? "font-cv-mono" : "font-cv-sans",
            )}
          />
          {canSend ? (
            <>
              {phone && !busy && (
                <Round label={dict.recording ? "Stop dictation" : dict.busy ? "Transcribing…" : "Dictate"} active={dict.recording} onClick={dict.toggle}>
                  {dict.busy ? <Loader size={19} className="animate-spin" /> : <Mic size={20} strokeWidth={1.8} className={cn(dict.recording && "text-cv-clay")} />}
                </Round>
              )}
              <Drop label={busy ? "Queue message" : "Send"} onClick={send} kind="send">
                <span ref={sendIcon} className="grid place-items-center">
                  <ArrowUp size={20} strokeWidth={2.2} />
                </span>
              </Drop>
            </>
          ) : busy ? (
            <Drop label="Stop (Esc)" onClick={stop} kind="stop">
              <span className="size-3 rounded-cv-xs bg-current" />
            </Drop>
          ) : phone ? (
            <Round label={dict.recording ? "Stop dictation" : dict.busy ? "Transcribing…" : "Dictate"} active={dict.recording} onClick={dict.toggle}>
              {dict.busy ? <Loader size={19} className="animate-spin" /> : <Mic size={20} strokeWidth={1.8} className={cn(dict.recording && "text-cv-clay")} />}
            </Round>
          ) : (
            // Desktop: the mic lives in the second row; the send drop waits, dimmed.
            <Drop label="Send" onClick={send} kind="send" disabled>
              <ArrowUp size={20} strokeWidth={2.2} />
            </Drop>
          )}
        </div>

        <div className="cv-fold -mt-1" data-open={expanded} inert={!expanded}>
          <div>
            <div className="flex items-center gap-0.5 px-1 pb-1">
              <button
                type="button"
                data-cv-trigger
                onClick={() => toggle("mode")}
                aria-label={`Permission mode: ${mode.label}`}
                title={`${mode.label}: ${mode.hint} (Shift+Tab)`}
                className={cn(
                  "flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-cv-meta transition-colors hover:bg-cv-hover",
                  popup === "mode" && "bg-cv-hover",
                  mode.warning ? "text-cv-danger" : mode.id === "default" ? "text-cv-muted" : "text-cv-text-2",
                )}
              >
                {switching ? <Loader size={16} className="animate-spin" /> : <mode.Icon size={16} strokeWidth={1.8} />}
                <span className={cn(phone && mode.id === "default" && "hidden")}>{phone ? mode.short : mode.label}</span>
              </button>
              <button
                type="button"
                data-cv-trigger
                onClick={() => toggle("model")}
                className={cn("flex h-11 min-w-0 items-center gap-1 rounded-full px-2.5 text-cv-meta text-cv-text-2 transition-colors hover:bg-cv-hover", popup === "model" && "bg-cv-hover")}
                aria-label={`Model and effort: ${modelName(meta.model)}, ${effortName(effort)}`}
              >
                {fast && <Zap size={13} strokeWidth={2} className="shrink-0 text-cv-clay" aria-label="Fast mode" />}
                <span className="shrink-0">{modelName(meta.model)}</span>
                <span className="min-w-0 truncate text-cv-muted">· {effortName(effort)}</span>
                <ChevronDown size={14} className="shrink-0 text-cv-muted" />
              </button>
              <Round label="Commands" onClick={() => (loadCommands(true), setPalette(true))}>
                <Slash size={17} strokeWidth={1.9} />
              </Round>
              <Round label="Mention a file" onClick={() => typeIn("@")}>
                <AtSign size={18} strokeWidth={1.8} />
              </Round>
              <span className="min-w-0 flex-1" />
              {busy && canSend && (
                <Round label="Stop (Esc)" onClick={stop}>
                  <span className="size-2.5 rounded-cv-xs bg-current" />
                </Round>
              )}
              {ctx && (
                <button type="button" onClick={() => setContextOpen(true)} aria-label={`${ctx.pct}% of the context used`} title={`${ctx.pct}% of the context used`} className="grid size-11 shrink-0 place-items-center rounded-full transition-colors hover:bg-cv-hover">
                  <ContextRing pct={ctx.pct} />
                </button>
              )}
              {!phone && (
                <Round label={dict.recording ? "Stop dictation" : dict.busy ? "Transcribing…" : "Dictate"} active={dict.recording} onClick={dict.toggle}>
                  {dict.busy ? <Loader size={18} className="animate-spin" /> : <Mic size={18} strokeWidth={1.8} className={cn(dict.recording && "text-cv-clay")} />}
                </Round>
              )}
            </div>
          </div>
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
        <PickRow icon={<Slash size={19} strokeWidth={1.7} />} label="Commands and skills" hint="Every Claude Code command, grouped" onClick={() => (close(), loadCommands(true), setPalette(true))} />
        <PickRow icon={<Terminal size={19} strokeWidth={1.7} />} label="Run a shell command" hint="Starts with !, like in Claude Code" onClick={() => (close(), setText(""), setArmed("shell"), focusEnd(0))} />
        <PickRow icon={<BookmarkPlus size={19} strokeWidth={1.7} />} label="Remember something" hint="Starts with #, Claude adds it to CLAUDE.md" onClick={() => (close(), setText(""), setArmed("memory"), focusEnd(0))} />
        <PickRow icon={<SquareTerminal size={19} strokeWidth={1.7} />} label="Open the terminal" hint="Every Claude Code menu" onClick={() => (close(), onTerminal("terminal"))} />
      </Picker>

      <Picker open={popup === "mode"} onClose={close} phone={phone} title="Permission mode" wide>
        {!phone && <PickSection first>Permission mode</PickSection>}
        {modes.map((m) => (
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
        <PickNote>Shift+Tab switches to the next mode.{modes.length < MODES.length ? " Bypass needs Claude started with it." : ""}</PickNote>
      </Picker>

      <Picker open={popup === "model"} onClose={close} phone={phone} title="Model" align="end">
        {!phone && <PickSection first>Model</PickSection>}
        {MODELS.map((m) => (
          <PickRow key={m.alias} label={m.name} hint={m.hint} checked={alias === m.alias} onClick={() => (close(), setModel(m.alias))} />
        ))}
        <PickRow label={<span className="text-cv-text-2">All options in the terminal…</span>} onClick={() => (close(), void prompt("/model"), onTerminal("/model"))} />
        <PickSection>Thinking</PickSection>
        <PickRow label="Effort" hint={EFFORTS.find((e) => e.level === effort)?.hint} trailing={<>{effortName(effort)}<ChevronRight size={17} /></>} onClick={() => setPopup("effort")} />
        <PickRow
          icon={<Zap size={18} strokeWidth={1.7} />}
          label="Fast mode"
          hint="Quicker output on the same model, uses more of your limits"
          trailing={<Toggle on={!!fast} />}
          onClick={() => (close(), setFast(!fast))}
        />
        {ctx && <PickRow label="Context" hint={`${ctx.pct}% of ${ctx.window.toLocaleString()} tokens used`} trailing={<ChevronRight size={17} />} onClick={() => (close(), setContextOpen(true))} />}
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
            onClick={() => (close(), setEffort(e.level))}
          />
        ))}
        <PickNote>{EFFORT_NOTE}</PickNote>
        {meta.effort && meta.effort !== DEFAULT_EFFORT && <PickRow label={<span className="text-cv-text-2">Reset to default</span>} onClick={() => (close(), setEffort("auto"))} />}
      </Picker>

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        commands={commands}
        phone={phone}
        onNative={(name) => (setPalette(false), native(name) || (void prompt(`/${name}`), onTerminal(`/${name}`)))}
        onRun={(line) => {
          setPalette(false);
          submit(line);
          onSubmitted();
        }}
        onInsert={(line) => {
          setPalette(false);
          setText(`${line} `);
          focusEnd(line.length + 1);
        }}
      />

      <ContextSheet
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        meta={meta}
        onCommand={(line, terminal) => {
          setContextOpen(false);
          void prompt(line);
          if (terminal) onTerminal(line);
        }}
      />

      <RewindSheet sid={sid} keys={client} live={live} busy={busy} onError={flash} />

      <input ref={photos} type="file" accept="image/*" multiple hidden onChange={(e) => (void addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
      <input ref={anyFile} type="file" multiple hidden onChange={(e) => (void addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
    </div>
  );
}

/** The last few things the user said (text + time). */
function recentPrompts(messages?: CvMessage[]): { text: string; ts: number }[] {
  const out: { text: string; ts: number }[] = [];
  for (let i = (messages?.length ?? 0) - 1; i >= 0 && out.length < 6; i--) {
    const m = messages![i]!;
    if (m.role !== "user" || (m.kind && m.kind !== "prompt")) continue;
    const text = m.blocks.map((b) => (b.k === "text" ? b.text : "")).join("\n").trim();
    if (text) out.push({ text, ts: m.ts });
  }
  return out;
}

/** A switch's look inside a row (the row is the button: no nested buttons). */
function Toggle({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("relative block h-5 w-8.5 shrink-0 rounded-full transition-colors", on ? "bg-cv-clay" : "bg-cv-press")}>
      <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-cv-surface shadow-cv-pill transition-transform", on && "translate-x-3.5")} />
    </span>
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
      className={cn("grid size-11 shrink-0 place-items-center rounded-full text-cv-text-2 transition-colors hover:bg-cv-hover hover:text-cv-text active:bg-cv-press", active && "bg-cv-hover text-cv-text")}
    >
      {children}
    </button>
  );
}

/** The primary drop at the right: send (clay) or stop (ink). 44px target, 36px visible. */
function Drop({ children, label, kind, disabled, onClick }: { children: ReactNode; label: string; kind: "send" | "stop"; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="group grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-35">
      <span
        className={cn(
          "grid size-9 place-items-center rounded-full transition duration-150 group-active:scale-92",
          kind === "send" ? "bg-cv-clay text-cv-on-clay group-hover:bg-cv-clay-strong" : "bg-cv-primary text-cv-on-primary animate-cv-pop",
        )}
      >
        {children}
      </span>
    </button>
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
