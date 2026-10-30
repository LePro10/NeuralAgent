import { IconButton, haptic } from "@neuralagent/ui";
import { ArrowUp, ClipboardPaste, ImagePlus, TextSelect } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClient, usePlatform } from "../lib/store";
import {
  filesOf,
  isImage,
  pathToken,
  readClipboardFiles,
  uploadFile,
} from "./claude/files";
import { showTerminalText } from "./TerminalText";

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
      const paths = await Promise.all(
        imgs.map((f) => uploadFile(client, sid, f)),
      );
      setText(
        (t) =>
          `${t}${t && !/\s$/.test(t) ? " " : ""}${paths.map(pathToken).join(" ")} `,
      );
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
  // Keep the terminal (and the on-screen keyboard) focused while tapping keys.
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <div className="material flex shrink-0 flex-col gap-2 border-t border-line px-2 pt-2 pb-2">
      <div className="scroll-x flex gap-1.5" data-no-swipe>
        <span onPointerDown={keep} className="contents">
          <IconButton
            type="button"
            variant="fill"
            label="Select and copy text"
            onClick={() => showTerminalText(sid)}
            className="!size-10 shrink-0 !rounded-item"
          >
            <TextSelect />
          </IconButton>
          <IconButton
            type="button"
            variant="fill"
            label="Paste image from clipboard"
            onClick={() => void paste()}
            className="!size-10 shrink-0 !rounded-item"
          >
            <ClipboardPaste />
          </IconButton>
        </span>
        <span aria-hidden className="mx-0.5 my-2 w-px shrink-0 bg-line" />
        {KEYS.map(([label, seq]) => (
          <button
            key={label}
            type="button"
            onPointerDown={keep}
            onClick={() => {
              haptic("select");
              client.write(sid, seq);
            }}
            className="pressable h-10 min-w-11 shrink-0 rounded-item bg-fill-2 px-3 font-mono text-subhead text-ink shadow-edge active:bg-fill-4"
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <IconButton
          type="button"
          variant="fill"
          label="Add a photo or image"
          onClick={() => pick.current?.click()}
          className="shrink-0"
        >
          <ImagePlus />
        </IconButton>
        <div className="flex h-11 min-w-0 flex-1 items-center rounded-full bg-fill-2 pr-1 pl-4 shadow-edge">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const f = filesOf(e.clipboardData);
              if (f.length) {
                e.preventDefault();
                void add(f);
              } else if (
                !e.clipboardData.getData("text/plain") &&
                platform.readClipboardImage
              ) {
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
          <IconButton
            type="submit"
            size="sm"
            variant="solid"
            label="Send"
            className="shrink-0"
          >
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
      {note && (
        <div className="px-2 text-footnote text-dim" role="status">
          {note}
        </div>
      )}
    </div>
  );
}
