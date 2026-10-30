import { IconButton } from "@neuralagent/ui";
import { ArrowUp, ClipboardPaste, ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClient, usePlatform } from "../lib/store";
import { filesOf, isImage, pathToken, readClipboardFiles, uploadFile } from "./claude/files";

// Keys a phone keyboard lacks, for answering agent prompts (menus, approvals, interrupts).
const KEYS: [string, string][] = [
  ["Esc", "\x1b"],
  ["Tab", "\t"],
  ["⇧Tab", "\x1b[Z"],
  ["↑", "\x1b[A"],
  ["↓", "\x1b[B"],
  ["←", "\x1b[D"],
  ["→", "\x1b[C"],
  ["^C", "\x03"],
  ["Enter", "\r"],
];

/** Phones: a line to type in (autocorrect and dictation work) and the keys a phone keyboard lacks. */
export function KeyBar({ sid }: { sid: string }) {
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
    const on = (e: Event) => void add([(e as CustomEvent<File>).detail]);
    window.addEventListener("na-paste-image", on);
    return () => window.removeEventListener("na-paste-image", on);
  });
  const send = () => {
    // Text first, Enter a moment later: agents read text and CR in one chunk as a paste.
    if (text) client.write(sid, text);
    setText("");
    setTimeout(() => client.write(sid, "\r"), text ? 60 : 0);
  };
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-line px-2 py-1.5">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
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
          className="h-9 min-w-0 flex-1 rounded-field bg-fill-2 px-3 text-input text-bright outline-none placeholder:text-faint"
        />
        <IconButton type="button" size="sm" variant="ghost" label="Paste image from clipboard" onClick={() => void paste()}>
          <ClipboardPaste />
        </IconButton>
        <IconButton type="button" size="sm" variant="ghost" label="Add a photo or image" onClick={() => pick.current?.click()}>
          <ImagePlus />
        </IconButton>
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
        <IconButton type="submit" size="sm" variant="tint" label="Send">
          <ArrowUp />
        </IconButton>
      </form>
      {note && <div className="px-1 text-meta text-faint" role="status">{note}</div>}
      <div className="flex gap-1 overflow-x-auto">
      {KEYS.map(([label, seq]) => (
        <button
          key={label}
          type="button"
          // Keep the terminal (and the on-screen keyboard) focused.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => client.write(sid, seq)}
          className="h-8 min-w-10 shrink-0 rounded-xs bg-fill-2 px-2.5 font-mono text-meta text-ink active:bg-fill-4"
        >
          {label}
        </button>
      ))}
      </div>
    </div>
  );
}
