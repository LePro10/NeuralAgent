import { cn, haptic, IconButton, useKeyboardOpen } from "@neuralagent/ui";
import { ArrowUp, ClipboardPaste, CornerDownLeft, Ellipsis, ImagePlus, Keyboard, TextSelect } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CTRL_LETTERS, ctrlSeq, SEQ } from "../lib/termKeys";
import { useClient, usePlatform } from "../lib/store";
import { filesOf, isImage, pathToken, readClipboardFiles, uploadFile } from "./claude/files";
import { showTerminalText } from "./TerminalText";

/**
 * Phones: one compact row of the keys a phone keyboard lacks, right above the keyboard
 * (type · Esc · Tab · Ctrl · arrows · Enter · more). The terminal takes everything else.
 *
 * - The terminal itself takes no keyboard on touch (TerminalView: Android IMEs garble xterm input).
 *   "Type" opens a line above the keys (autocorrect and dictation work; images upload and land as
 *   a path) and brings the keyboard up; sending writes the line plus Enter.
 * - Ctrl is sticky: tap it, then a letter, either on the row it shows (^C ^D ^Z …) or typed in
 *   the line. Tap it again to let go.
 * - Arrows repeat while held.
 * - "More" opens a second row: ⇧Tab, y / n, digits for menus, select text.
 */
export function KeyBar({ sid }: { sid: string }) {
  const client = useClient();
  const kb = useKeyboardOpen();
  const [ctrl, setCtrl] = useState(false);
  const [more, setMore] = useState(false);
  const [line, setLine] = useState(false);
  // An image pasted into the terminal opens the typing line with it.
  const [pending, setPending] = useState<File[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      setLine(true);
      setPending((p) => [...p, (e as CustomEvent<File>).detail]);
    };
    window.addEventListener("na-paste-image", on);
    return () => window.removeEventListener("na-paste-image", on);
  }, []);
  const send = (seq: string) => {
    haptic("select");
    client.write(sid, seq);
  };

  // Ctrl + a key typed on the keyboard (hardware keys on keydown; Android IMEs on beforeinput).
  useEffect(() => {
    if (!ctrl) return;
    const hit = (ch: string | null | undefined, e: Event) => {
      const seq = ch ? ctrlSeq(ch) : null;
      if (!seq) return;
      e.preventDefault();
      e.stopPropagation();
      client.write(sid, seq);
      setCtrl(false);
    };
    const down = (e: KeyboardEvent) => e.key.length === 1 && !e.metaKey && hit(e.key, e);
    const input = (e: InputEvent) => e.inputType === "insertText" && hit(e.data, e);
    document.addEventListener("keydown", down, true);
    document.addEventListener("beforeinput", input, true);
    return () => {
      document.removeEventListener("keydown", down, true);
      document.removeEventListener("beforeinput", input, true);
    };
  }, [ctrl, client, sid]);

  return (
    <div
      className="material flex shrink-0 flex-col border-t border-line"
      style={{ paddingBottom: kb ? 0 : "var(--safe-bottom)" }}
      data-no-swipe
      data-no-hide
    >
      {more && <MoreRow sid={sid} send={send} />}
      {line && <LineInput sid={sid} pending={pending} onTaken={() => setPending([])} />}
      <div role="toolbar" aria-label="Terminal keys" className="flex h-keybar items-center gap-1 px-1.5">
        <Key label={<Keyboard size={18} strokeWidth={1.8} />} aria="Type to the agent" pressed={line} onPress={() => { haptic("select"); setLine((v) => !v); }} />
        <Key label="Esc" onPress={() => send(SEQ.esc)} />
        <Key label="Tab" onPress={() => send(SEQ.tab)} />
        <Key label="Ctrl" pressed={ctrl} onPress={() => { haptic("select"); setCtrl((v) => !v); }} />
        {ctrl ? (
          <div className="scroll-x flex min-w-0 grow-4 basis-0 gap-1">
            {CTRL_LETTERS.map((l) => (
              <Key key={l} label={`^${l}`} aria={`Control ${l}`} wide onPress={() => { send(ctrlSeq(l)!); setCtrl(false); }} />
            ))}
          </div>
        ) : (
          <>
            <Key label="↑" aria="Up" repeat onPress={() => send(SEQ.up)} />
            <Key label="↓" aria="Down" repeat onPress={() => send(SEQ.down)} />
            <Key label="←" aria="Left" repeat onPress={() => send(SEQ.left)} />
            <Key label="→" aria="Right" repeat onPress={() => send(SEQ.right)} />
          </>
        )}
        <Key label={<CornerDownLeft size={17} strokeWidth={1.9} />} aria="Enter" onPress={() => send(SEQ.enter)} />
        <Key label={<Ellipsis size={18} strokeWidth={1.9} />} aria="More keys" pressed={more} onPress={() => { haptic("select"); setMore((v) => !v); }} />
      </div>
    </div>
  );
}

// Keep the terminal (and the on-screen keyboard) focused while tapping keys.
const keep = (e: { preventDefault: () => void }) => e.preventDefault();

function Key({ label, aria, onPress, pressed, repeat, wide }: {
  label: ReactNode;
  aria?: string;
  onPress: () => void;
  /** A toggle (Ctrl, More): aria-pressed and lit. */
  pressed?: boolean;
  /** Repeats while held (arrows). */
  repeat?: boolean;
  wide?: boolean;
}) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      aria-label={aria}
      aria-pressed={pressed}
      onPointerDown={(e) => {
        keep(e);
        if (!repeat) return;
        fired.current = false;
        const tick = (ms: number) => {
          timer.current = window.setTimeout(() => {
            fired.current = true;
            onPress();
            tick(70);
          }, ms);
        };
        tick(380);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        // A held arrow already sent its keys.
        if (repeat && fired.current) { fired.current = false; return; }
        onPress();
      }}
      className={cn(
        "pressable grid h-9 shrink-0 place-items-center rounded-item font-mono text-footnote shadow-edge transition-colors",
        wide ? "min-w-11 px-2" : "min-w-0 flex-1",
        pressed ? "bg-accent text-bg" : "bg-fill-2 text-ink active:bg-fill-4",
      )}
    >
      {label}
    </button>
  );
}

function MoreRow({ sid, send }: { sid: string; send: (s: string) => void }) {
  return (
    <div className="scroll-x flex h-keybar items-center gap-1 border-b border-line px-1.5">
      <Key label="⇧Tab" aria="Shift Tab" wide onPress={() => send(SEQ.shiftTab)} />
      {["y", "n", "1", "2", "3", "4"].map((k) => (
        <Key key={k} label={k} wide onPress={() => send(k)} />
      ))}
      <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />
      <span onPointerDown={keep} className="contents">
        <IconButton type="button" variant="fill" label="Select and copy text" onClick={() => showTerminalText(sid)} className="!size-9 shrink-0 !rounded-item">
          <TextSelect />
        </IconButton>
      </span>
    </div>
  );
}

/** A line to type in (autocorrect and dictation work) with image upload and paste. */
function LineInput({ sid, pending, onTaken }: { sid: string; pending: File[]; onTaken: () => void }) {
  const client = useClient();
  const platform = usePlatform();
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  // Images go to the host; the path lands in the line, ready to send with the prompt.
  const add = async (files: File[]) => {
    const imgs = files.filter(isImage);
    if (!imgs.length) return;
    setNote("Uploading…");
    try {
      const paths = await Promise.all(imgs.map((f) => uploadFile(client, sid, f)));
      setText((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}${paths.map(pathToken).join(" ")} `);
      setNote("");
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const nativePaste = async () => {
    const f = await platform.readClipboardImage?.().catch(() => null);
    if (f) await add([f]);
    return !!f;
  };
  const paste = async () => {
    if (await nativePaste()) return;
    const r = await readClipboardFiles();
    if (r.files.length) await add(r.files);
    else if (r.text) setText((t) => t + r.text);
    else setNote(r.error ?? "No image on the clipboard.");
  };
  useEffect(() => {
    if (!pending.length) return;
    onTaken();
    void add(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  const submit = () => {
    // Text first, Enter a moment later: agents read text and CR in one chunk as a paste.
    if (text) client.write(sid, text);
    setText("");
    setTimeout(() => client.write(sid, "\r"), text ? 60 : 0);
  };
  return (
    <>
      <form className="flex items-center gap-1.5 border-b border-line px-1.5 py-1.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <IconButton type="button" variant="fill" label="Add a photo or image" onClick={() => pick.current?.click()} className="!size-9 shrink-0">
          <ImagePlus />
        </IconButton>
        <IconButton type="button" variant="fill" label="Paste image from clipboard" onClick={() => void paste()} className="!size-9 shrink-0">
          <ClipboardPaste />
        </IconButton>
        <div className="flex h-10 min-w-0 flex-1 items-center rounded-full bg-fill-2 pr-1 pl-3.5 shadow-edge">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const f = filesOf(e.clipboardData);
              if (f.length) {
                e.preventDefault();
                void add(f);
              } else if (!e.clipboardData.getData("text/plain") && platform.readClipboardImage) {
                e.preventDefault();
                void nativePaste();
              }
            }}
            placeholder="Type to the agent"
            enterKeyHint="send"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Type to the agent"
            className="h-full min-w-0 flex-1 bg-transparent text-input text-bright outline-none placeholder:text-faint"
          />
          <IconButton type="submit" size="sm" variant="solid" label="Send" className="shrink-0">
            <ArrowUp />
          </IconButton>
        </div>
        <input
          ref={pick}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </form>
      {note && <div className="px-3 py-1 text-footnote text-dim" role="status">{note}</div>}
    </>
  );
}
