/**
 * The assistant's input: a slim glass pill (44px on phones, 40 on desktop)
 * that grows to five lines.
 *
 * - The right-hand button morphs with intent: a quiet mic + voice orb when
 *   empty, a 32px send button once there is something to send, and — when a
 *   reply starts — the arrow flies up and out while a stop square scales in,
 *   with a thin ring running around it until the reply ends. Typing stays
 *   open during a reply (the button turns back into send).
 * - Attach opens a small translucent pull-down from the + button.
 * - Attachments are preview tiles: images as thumbnails, other files as small
 *   cards; very long pasted text becomes a card instead of a wall of text.
 *   Files arrive by picker, paste (screenshots) or drop.
 * - Enter sends only with a real keyboard (fine pointer); on phones Enter is
 *   a new line and the button sends.
 * - Dictation uses the browser's speech recognition and is hidden where there
 *   is none. While recording, the field shows a live waveform and a timer.
 *
 * Put it in <ComposerDock> at the bottom of a chat: it keeps the composer
 * above the tab bar, drops that gap when the keyboard opens, and fades the
 * conversation out underneath.
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Camera, FileText, Image as ImageIcon, Mic, Plus, Square, TextQuote, X } from 'lucide-react';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { cn } from '../../lib/cn';
import { MENU_SURFACE } from '../overlays/MenuList';
import { haptic } from '../../lib/haptics';
import { useFinePointer, useKeyboardOpen } from '../../lib/hooks';
import { EASE, SPRING } from '../../lib/motion';
import { AssistantOrb } from './AssistantOrb';
import { Waveform } from './Waveform';

export type Attachment =
  | { id: number; kind: 'file'; file: File; url?: string }
  | { id: number; kind: 'text'; name: string; text: string };

export interface ComposerHandle {
  focus: () => void;
  setText: (t: string) => void;
  addFiles: (files: File[]) => void;
}

/** From here on, pasted text becomes a card. */
const LONG_CHARS = 2500;
const LONG_LINES = 40;
const LINE = 22;

let nextId = 1;
const sizeLabel = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ext = (n: string) => (n.includes('.') ? n.split('.').pop()!.toUpperCase().slice(0, 5) : 'FILE');

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
const RecognitionClass = (): (new () => Recognition) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export interface ComposerProps {
  /** Return false to refuse (text and attachments stay). */
  onSend: (text: string, attachments: Attachment[]) => void | boolean;
  placeholder?: string;
  /** A reply is streaming: shows Stop (with a running ring) while the field is empty. */
  busy?: boolean;
  /** 0–1 progress of the reply, if known — draws the ring instead of the spinning arc. */
  progress?: number;
  onStop?: () => void;
  /** Shows the voice-mode orb. */
  onVoice?: () => void;
  /** Hero variant: no attach button, darker and lighter-weight. */
  compact?: boolean;
  /** Allow attachments (default true unless compact). */
  attachments?: boolean;
  /** Browser dictation, where available (default true). */
  dictation?: boolean;
  maxRows?: number;
  disabled?: boolean;
  defaultValue?: string;
  onTextChange?: (t: string) => void;
  autoFocus?: boolean;
  ref?: Ref<ComposerHandle>;
  className?: string;
}

export function Composer({ onSend, placeholder = 'Ask anything', busy, progress, onStop, onVoice, compact, attachments: allowFiles = !compact, dictation = true, maxRows = 5, disabled, defaultValue = '', onTextChange, autoFocus, ref, className }: ComposerProps) {
  const [text, setText] = useState(defaultValue);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [menu, setMenu] = useState(false);
  const [recording, setRecording] = useState(false);
  const [drag, setDrag] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const fine = useFinePointer();
  const canDictate = dictation && !!RecognitionClass();
  // Send reads from refs: a second click on the fading send button would otherwise see the old text.
  const state = useRef({ text, files });
  state.current = { text, files };

  useEffect(() => { onTextChange?.(text); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const f of state.current.files) if (f.kind === 'file' && f.url) URL.revokeObjectURL(f.url); recognition.current?.stop(); }, []);

  // Auto-size up to maxRows, then scroll.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, LINE * maxRows + 14)}px`;
  }, [text, maxRows, recording]);

  const add = (list: Attachment[]) => { if (list.length) { haptic('select'); setFiles((f) => [...f, ...list]); } };
  const addFiles = (fs: File[]) => add(fs.map((file) => ({ id: nextId++, kind: 'file' as const, file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined })));
  const remove = (id: number) => setFiles((f) => { const x = f.find((a) => a.id === id); if (x?.kind === 'file' && x.url) URL.revokeObjectURL(x.url); return f.filter((a) => a.id !== id); });

  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus(), setText, addFiles }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const canSend = !!text.trim() || files.length > 0;
  const send = () => {
    const { text: t, files: f } = state.current;
    if (!t.trim() && !f.length) return;
    if (onSend(t.trim(), f) === false) return;
    haptic('heavy');
    setText('');
    setFiles([]);
  };

  const startRec = () => {
    const K = RecognitionClass();
    if (!K) return;
    const r = new K();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let heard = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) heard += e.results[i][0].transcript;
      if (heard.trim()) setText((t) => (t ? `${t.trimEnd()} ` : '') + heard.trim());
    };
    r.onend = r.onerror = () => { setRecording(false); recognition.current = null; };
    recognition.current = r;
    try { r.start(); setRecording(true); } catch { recognition.current = null; }
  };
  const stopRec = () => { recognition.current?.stop(); setRecording(false); requestAnimationFrame(() => area.current?.focus()); };

  const pick = (kind: 'image' | 'doc' | 'camera') => {
    setMenu(false);
    const input = document.createElement('input');
    input.type = 'file';
    if (kind === 'camera') { input.accept = 'image/*'; input.setAttribute('capture', 'environment'); } else input.multiple = true;
    if (kind === 'image') input.accept = 'image/*';
    input.onchange = () => addFiles(Array.from(input.files ?? []));
    input.click();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (!allowFiles) return;
    const fs = Array.from(e.clipboardData.files ?? []);
    if (fs.length) { e.preventDefault(); addFiles(fs); return; }
    const raw = e.clipboardData.getData('text/plain');
    if (raw.length > LONG_CHARS || raw.split('\n').length > LONG_LINES) { e.preventDefault(); add([{ id: nextId++, kind: 'text', name: 'Pasted text', text: raw }]); }
  };

  const showStop = busy && !canSend && !!onStop;
  const showSend = (canSend || showStop) && !recording;
  return (
    <div className={cn('relative', className)}
      onDragOver={(e) => { if (allowFiles && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
      onDrop={(e) => { if (!allowFiles) return; e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer.files)); }}>
      {/* Attach: a small pull-down that grows out of the + button, not a panel. */}
      <AnimatePresence>
        {menu && (
          <motion.div role="menu" initial={{ opacity: 0, scale: 0.86, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }} transition={SPRING.pop}
            className={`absolute bottom-full left-0 z-10 mb-1.5 w-[172px] ${MENU_SURFACE}`} style={{ transformOrigin: '18px 100%' }}>
            {([...(!fine ? [['Take photo', Camera, 'camera']] as const : []), ['Photo', ImageIcon, 'image'], ['File', FileText, 'doc']] as const).map(([label, Icon, kind], i) => (
              <motion.button key={label} role="menuitem" type="button" onClick={() => pick(kind)}
                initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.03 + i * 0.022 }}
                className="flex h-9 w-full items-center gap-2.5 rounded-item px-2.5 text-chip text-bright hover:bg-fill-3 active:bg-fill-4">
                <Icon size={15} strokeWidth={1.6} className="text-dim" />{label}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn('relative rounded-sheet border-hair transition-[border-color,box-shadow] duration-300 focus-within:border-white/20 min-[900px]:rounded-dialog',
        compact ? 'border-transparent well' : 'glass !shadow-none', drag && '!border-accent/50 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_12%,transparent)]')}>
        <AnimatePresence initial={false}>
          {files.length > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING.sheet} className="overflow-hidden">
              <div data-no-swipe className="scroll-x flex gap-1.5 px-2.5 pt-2.5">
                <AnimatePresence initial={false}>{files.map((a) => <Tile key={a.id} a={a} onRemove={() => remove(a.id)} />)}</AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end gap-0.5 p-1 min-[900px]:p-[3px]">
          {allowFiles && (
            <button type="button" aria-label="Attach" aria-haspopup="menu" aria-expanded={menu} onClick={() => { haptic('select'); setMenu((o) => !o); }}
              className="pressable relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-fill-3 hover:text-bright after:absolute after:-inset-1 after:content-[''] min-[900px]:h-[34px] min-[900px]:w-[34px]">
              <motion.span animate={{ rotate: menu ? 45 : 0 }} transition={SPRING.toggle}><Plus size={18} strokeWidth={1.6} /></motion.span>
            </button>
          )}
          <div className="relative min-h-9 min-w-0 flex-1 min-[900px]:min-h-[34px]">
            <AnimatePresence initial={false} mode="popLayout">
              {recording ? (
                <motion.div key="rec" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} className="flex h-9 min-w-0 items-center gap-2.5 pl-2.5">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-danger" />
                  <Waveform className="flex-1" bars={36} height={18} color="var(--color-ink)" />
                  <RecTimer />
                </motion.div>
              ) : (
                <motion.textarea key="txt" ref={area} rows={1} value={text} disabled={disabled} autoFocus={autoFocus}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={onPaste}
                  onFocus={() => setMenu(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && fine) { e.preventDefault(); send(); } }}
                  placeholder={placeholder} aria-label={placeholder}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  className={cn('scroller block min-h-9 w-full resize-none bg-transparent py-[7px] text-input leading-[22px] text-bright outline-none placeholder:truncate placeholder:text-faint min-[900px]:min-h-[34px] min-[900px]:py-[6px] min-[900px]:text-button', allowFiles ? 'pl-0.5' : 'pl-3')} />
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence initial={false} mode="popLayout">
            {showSend ? (
              <motion.div key="send" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.12 } }} transition={SPRING.pop}>
                <SendButton mode={showStop ? 'stop' : 'send'} busy={!!busy} progress={progress}
                  onClick={() => { if (showStop) { haptic('select'); onStop!(); } else send(); }} />
              </motion.div>
            ) : (
              <motion.div key="voice" className="flex" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.12 } }} transition={SPRING.pop}>
                {canDictate && (
                  <button type="button" aria-label={recording ? 'Stop dictation' : 'Dictate'} onClick={() => { haptic('select'); if (recording) stopRec(); else startRec(); }}
                    className={cn('pressable relative grid h-9 w-9 shrink-0 place-items-center rounded-full after:absolute after:-inset-1 after:content-[""] min-[900px]:h-[34px] min-[900px]:w-[34px]', recording ? 'bg-danger/15 text-danger' : 'text-dim hover:bg-fill-3 hover:text-bright')}>
                    {recording ? <Square size={12} fill="currentColor" strokeWidth={0} /> : <Mic size={17} strokeWidth={1.6} />}
                  </button>
                )}
                {onVoice && !recording && (
                  <button type="button" aria-label="Voice mode" title="Talk" onClick={() => { haptic('select'); onVoice(); }}
                    className="orb-trigger relative grid h-9 w-9 shrink-0 place-items-center rounded-full after:absolute after:-inset-1 after:content-[''] min-[900px]:h-[34px] min-[900px]:w-[34px]">
                    <AssistantOrb size={24} state="rest" />
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/**
 * Send ⇄ stop. The arrow flies up and out when a reply starts; a stop square
 * scales in and a thin ring runs around the button while the answer comes
 * (real `progress` 0–1 if you have it, else an indeterminate arc). When the
 * reply ends the arrow comes back from below.
 */
export function SendButton({ mode, busy, progress, onClick, className }: {
  mode: 'send' | 'stop'; busy?: boolean; progress?: number; onClick: () => void; className?: string;
}) {
  const ring = busy || mode === 'stop';
  return (
    <button type="button" aria-label={mode === 'stop' ? 'Stop reply' : 'Send'} onClick={onClick}
      className={cn('group relative grid h-9 w-9 shrink-0 place-items-center min-[900px]:h-[34px] min-[900px]:w-[34px]', className)}>
      <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-bright text-bg transition-transform duration-200 group-active:scale-90 min-[900px]:h-[30px] min-[900px]:w-[30px]">
        <AnimatePresence initial={false} mode="popLayout">
          {mode === 'send' ? (
            <motion.span key="arrow" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0, transition: { duration: 0.22, ease: [0.55, 0, 0.75, 0.2] } }} transition={{ duration: 0.26, ease: EASE.outSoft }}>
              <ArrowUp size={16} strokeWidth={2.2} />
            </motion.span>
          ) : (
            <motion.span key="stop" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.14 } }} transition={SPRING.pop}>
              <Square size={10} fill="currentColor" strokeWidth={0} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <AnimatePresence>
        {ring && (
          <motion.svg key="ring" viewBox="0 0 36 36" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}>
            <circle cx="18" cy="18" r="17" fill="none" stroke="var(--color-line-2)" strokeWidth="1.25" />
            {progress === undefined
              ? <circle cx="18" cy="18" r="17" fill="none" stroke="var(--color-bright)" strokeWidth="1.25" strokeLinecap="round" pathLength={1} strokeDasharray="0.22 0.78" className="origin-center animate-[spin_1.2s_linear_infinite] [transform-box:fill-box]" />
              : <motion.circle cx="18" cy="18" r="17" fill="none" stroke="var(--color-bright)" strokeWidth="1.25" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" initial={false} animate={{ strokeDashoffset: 1 - Math.max(0, Math.min(1, progress)) }} transition={{ duration: 0.3, ease: 'linear' }} />}
          </motion.svg>
        )}
      </AnimatePresence>
    </button>
  );
}

function Tile({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const name = a.kind === 'file' ? a.file.name || 'File' : a.name;
  return (
    <motion.div layout initial={{ scale: 0.88, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.88, opacity: 0, transition: { duration: 0.12 } }} transition={SPRING.pop} className="relative mt-1 shrink-0" title={name}>
      <button type="button" aria-label={`Remove ${name}`} onClick={onRemove}
        className="absolute -top-1 -right-1 z-10 grid h-[18px] w-[18px] place-items-center rounded-full bg-card-3 text-ink shadow-[0_1px_3px_rgb(0_0_0/.5)] after:absolute after:-inset-3 after:content-[''] hover:text-bright">
        <X size={10} strokeWidth={2.4} />
      </button>
      {a.kind === 'file' && a.url ? (
        <img src={a.url} alt={name} className="h-12 w-12 rounded-tile border-hair border-white/10 object-cover" />
      ) : (
        <div className="flex h-12 w-[168px] items-center gap-2 surface rounded-field pr-2.5 pl-1.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-tile bg-fill-3 text-dim">
            {a.kind === 'text' ? <TextQuote size={14} strokeWidth={1.7} /> : <span className="font-mono text-[8.5px]">{ext(a.file.name)}</span>}
          </span>
          <div className="min-w-0">
            <div className="truncate text-meta text-bright">{name}</div>
            <div className="truncate text-tiny text-dim">{a.kind === 'file' ? `${ext(a.file.name)} · ${sizeLabel(a.file.size)}` : `${a.text.split('\n').length.toLocaleString('en')} lines`}</div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function RecTimer() {
  const [s, setS] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setS((v) => v + 1), 1000); return () => window.clearInterval(t); }, []);
  return <span className="shrink-0 pr-1 font-mono text-tiny text-dim tabular">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

/**
 * Bottom dock for a chat: holds the composer above the tab bar (or 10px above
 * the keyboard when it is open) and fades the conversation out beneath it.
 * Place it absolutely at the bottom of the chat column.
 */
export function ComposerDock({ children, className }: { children: ReactNode; className?: string }) {
  const keyboard = useKeyboardOpen();
  return (
    <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 z-20', className)}
      style={{ paddingBottom: keyboard ? 8 : 'calc(var(--tabbar-space) + 6px)' }}>
      <div aria-hidden="true" className="absolute inset-x-0 -top-8 bottom-0 bg-[linear-gradient(180deg,rgb(8_9_9/0),rgb(8_9_9/.82)_45%,var(--color-bg))]" />
      <div className="pointer-events-auto relative mx-auto w-full max-w-[760px] px-3">{children}</div>
    </div>
  );
}
