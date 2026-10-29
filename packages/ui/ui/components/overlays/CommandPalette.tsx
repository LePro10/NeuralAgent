/**
 * Command palette (⌘K / Ctrl+K): one field that reaches everything.
 * Keyboard first — arrows move, Enter runs, Escape clears the field and
 * then closes, Home/End jump. The mouse only highlights where it rests, so
 * moving it never fights the arrow keys. Matching is forgiving (subsequence,
 * word starts weigh most) and the matched letters are lit in the accent.
 *
 * Desktop: a glass panel high on the screen (eye level, not centred).
 * Phones: full screen with the field at the top and Cancel in reach.
 * Empty query shows `recent` first, then the groups.
 */
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useFocusTrap } from '../../lib/focus-trap';
import { haptic } from '../../lib/haptics';
import { MOD_KEY } from '../../lib/hooks';
import { useLayer } from '../../lib/layers';
import { SPRING } from '../../lib/motion';
import { useLayoutMode, usePortalTarget } from '../../lib/surface';

export interface Command {
  id: string;
  label: string;
  detail?: string;
  Icon?: LucideIcon;
  /** Avatar, file icon, colour dot. */
  glyph?: ReactNode;
  /** Shown at the right on desktop ("⌘N"). */
  shortcut?: string;
  /** Extra words that should find it (synonyms, ids). */
  keywords?: string;
  onSelect: () => void;
}
export interface CommandGroup { label: string; items: Command[] }

/** Score a candidate: higher is better, null if it does not match. Returns matched indices for highlighting. */
export function fuzzyMatch(query: string, text: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return { score: 0, hits: [] };
  const direct = t.indexOf(q);
  if (direct >= 0) return { score: 100 - direct + (direct === 0 || /\W/.test(t[direct - 1]) ? 40 : 0), hits: Array.from({ length: q.length }, (_, i) => direct + i) };
  const hits: number[] = [];
  let score = 0, ti = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return null;
    const wordStart = i === 0 || /\W/.test(t[i - 1]);
    score += wordStart ? 8 : i === ti ? 4 : 1;
    hits.push(i);
    ti = i + 1;
  }
  return { score, hits };
}

function Lit({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return <>{[...text].map((c, i) => (set.has(i) ? <span key={i} className="text-accent">{c}</span> : c))}</>;
}

/** ⌘K / Ctrl+K toggles. */
export function useCommandShortcut(toggle: () => void) {
  const ref = useRef(toggle);
  ref.current = toggle;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
}

export function CommandPalette({ open, onClose, groups, recent, placeholder = 'Search or jump to…', empty }: {
  open: boolean;
  onClose: () => void;
  groups: CommandGroup[];
  /** Shown first while the field is empty. */
  recent?: Command[];
  placeholder?: string;
  /** Shown when nothing matches (e.g. "Ask Luna about …" as a fallback action). */
  empty?: (query: string) => ReactNode;
}) {
  const mode = useLayoutMode();
  const target = usePortalTarget();
  // Escape: the field clears itself first (preventDefault), then the layer closes.
  useLayer(open, onClose);
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(open, box);
  return createPortal(
    <AnimatePresence>
      {open && <Panel key="p" box={box} phone={mode === 'phone'} onClose={onClose} groups={groups} recent={recent} placeholder={placeholder} empty={empty} />}
    </AnimatePresence>,
    target,
  );
}

function Panel({ box, phone, onClose, groups, recent, placeholder, empty }: {
  box: React.RefObject<HTMLDivElement | null>; phone: boolean; onClose: () => void; groups: CommandGroup[]; recent?: Command[]; placeholder: string; empty?: (q: string) => ReactNode;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pointerMoved = useRef(false);

  const sections = useMemo(() => {
    if (!q.trim()) {
      const s = recent?.length ? [{ label: 'Recent', items: recent.map((c) => ({ c, hits: [] as number[] })) }] : [];
      return [...s, ...groups.map((g) => ({ label: g.label, items: g.items.map((c) => ({ c, hits: [] as number[] })) }))];
    }
    const found = groups.map((g) => ({
      label: g.label,
      items: g.items
        .map((c) => {
          const m = fuzzyMatch(q, c.label);
          const k = m ? null : fuzzyMatch(q, `${c.detail ?? ''} ${c.keywords ?? ''}`);
          return m ? { c, hits: m.hits, score: m.score + 10 } : k ? { c, hits: [], score: k.score } : null;
        })
        .filter((x): x is { c: Command; hits: number[]; score: number } => !!x)
        .sort((a, b) => b.score - a.score),
    })).filter((s) => s.items.length);
    // The single best hit across all groups goes first, so Enter does the obvious thing.
    const best = found.flatMap((s) => s.items).sort((a, b) => b.score - a.score)[0];
    if (!best || found[0]?.items[0] === best) return found;
    return [{ label: 'Best match', items: [best] }, ...found.map((s) => ({ ...s, items: s.items.filter((i) => i !== best) })).filter((s) => s.items.length)];
  }, [q, groups, recent]);
  const flat = sections.flatMap((s) => s.items.map((i) => i.c));

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { requestAnimationFrame(() => field.current?.focus({ preventScroll: true })); }, []);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const run = (c?: Command) => { if (!c) return; haptic('select'); onClose(); c.onSelect(); };
  const onKey = (e: React.KeyboardEvent) => {
    const n = flat.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); pointerMoved.current = false; setActive((a) => (n ? (a + 1) % n : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pointerMoved.current = false; setActive((a) => (n ? (a - 1 + n) % n : 0)); }
    else if (e.key === 'Home' && !q) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && !q) { e.preventDefault(); setActive(Math.max(0, n - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(flat[active]); }
    else if (e.key === 'Escape' && q) { e.preventDefault(); setQ(''); }
  };

  let idx = -1;
  const body = (
    <div ref={list} role="listbox" aria-label="Results" className="scroller scroller-subtle min-h-0 flex-1 p-2" onPointerMove={() => { pointerMoved.current = true; }}>
      {sections.length === 0 && (
        <div className="px-3 py-10 text-center">
          {empty ? empty(q) : <p className="text-chip text-dim">Nothing for “{q}”.</p>}
        </div>
      )}
      {sections.map((s) => (
        <div key={s.label} className="mb-1">
          <div className="px-2.5 pt-3 pb-1 text-tiny text-faint">{s.label}</div>
          {s.items.map(({ c, hits }) => {
            idx++;
            const i = idx;
            const on = i === active;
            return (
              <button key={`${s.label}-${c.id}`} type="button" role="option" aria-selected={on} data-active={on}
                onMouseEnter={() => { if (pointerMoved.current) setActive(i); }}
                onClick={() => run(c)}
                className={cn('relative flex w-full items-center gap-2.5 rounded-field px-2.5 text-left transition-colors', phone ? 'min-h-[46px] py-1.5' : 'h-10', on ? 'text-bright' : 'text-ink')}>
                {on && <motion.span layoutId="cmd-active" className="absolute inset-0 rounded-field bg-fill-3" transition={SPRING.snap} />}
                <span className="relative grid h-[26px] w-[26px] shrink-0 place-items-center rounded-tile bg-fill-3 text-ink">
                  {c.glyph ?? (c.Icon && <c.Icon size={14} strokeWidth={1.7} />)}
                </span>
                <span className="relative min-w-0 flex-1 truncate text-body"><Lit text={c.label} hits={hits} /></span>
                {c.detail && <span className="relative max-w-[40%] truncate text-meta text-dim">{c.detail}</span>}
                {!phone && c.shortcut && <kbd className="relative font-mono text-tiny text-faint">{c.shortcut}</kbd>}
                {!phone && on && <CornerDownLeft size={13} className="relative text-dim" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  const input = (
    <label className={cn('flex shrink-0 items-center gap-2.5 border-b-hair border-line', phone ? 'px-4' : 'px-4')}>
      <Search size={16} strokeWidth={1.75} className="text-dim" />
      <input ref={field} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={placeholder}
        role="combobox" aria-expanded="true" aria-autocomplete="list" enterKeyHint="go"
        className="h-12 min-w-0 flex-1 bg-transparent text-input text-bright outline-none placeholder:text-faint min-[900px]:text-body" />
      {phone
        ? <button type="button" onClick={onClose} className="py-2 pl-1 text-body text-ink">Cancel</button>
        : <kbd className="rounded-xs bg-fill-2 px-1.5 py-px font-mono text-tiny text-faint shadow-key">esc</kbd>}
    </label>
  );

  if (phone) {
    return (
      <motion.div ref={box} role="dialog" aria-modal="true" aria-label="Command palette"
        className="fixed inset-0 z-[var(--z-search)] flex flex-col bg-bg/90 backdrop-blur-xl outline-none"
        style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8, transition: { duration: 0.14 } }} transition={SPRING.sheet}>
        {input}
        {body}
      </motion.div>
    );
  }
  return (
    <div className="fixed inset-0 z-[var(--z-search)] flex justify-center px-6 pt-[12vh]">
      <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.14 } }} onClick={onClose} />
      <motion.div ref={box} role="dialog" aria-modal="true" aria-label="Command palette"
        className="glass relative flex max-h-[min(520px,72vh)] w-full max-w-[600px] flex-col overflow-hidden !rounded-dialog outline-none"
        initial={{ opacity: 0, scale: 0.97, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }} transition={{ ...SPRING.snap, damping: 38 }}>
        {input}
        {body}
        <div className="flex shrink-0 items-center gap-4 border-t-hair border-line px-4 py-2 text-meta text-faint">
          <span><kbd className="font-mono">↑↓</kbd> move</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
          <span className="ml-auto font-mono">{MOD_KEY}K</span>
        </div>
      </motion.div>
    </div>
  );
}
