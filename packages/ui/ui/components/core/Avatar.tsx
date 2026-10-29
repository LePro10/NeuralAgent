/**
 * Avatar: photo, or initials on a tile. With `color` the tile becomes a
 * glossy disc in that colour (accounts, people in a thread) — a soft top-left
 * highlight over the colour, like a lit bead.
 */
import { cn } from '../../lib/cn';

export function Avatar({ name, src, size = 32, color, ring, className }: { name: string; src?: string; size?: number; color?: string; ring?: boolean; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  const style = {
    width: size, height: size, fontSize: Math.round(size * 0.38),
    background: src ? undefined : color
      ? `radial-gradient(120% 120% at 28% 18%, rgb(255 255 255 / .4), transparent 45%), ${color}`
      : 'var(--color-card-3)',
  };
  return (
    <span
      className={cn('relative inline-grid shrink-0 select-none place-items-center overflow-hidden rounded-full font-medium tracking-[-.02em]', color ? 'text-bg' : 'text-ink', ring && 'ring-2 ring-bg', className)}
      style={style}
      role="img"
      aria-label={name}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials}
      <i aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border-hair border-white/10" />
    </span>
  );
}

/** Overlapping avatars with a "+n" tail. */
export function AvatarStack({ people, max = 4, size = 28 }: { people: { name: string; src?: string; color?: string }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((p, i) => <Avatar key={p.name + i} {...p} size={size} ring className={i ? '-ml-2' : ''} />)}
      {rest > 0 && <span className="-ml-2 grid place-items-center rounded-full bg-card-3 text-meta text-ink ring-2 ring-bg" style={{ width: size, height: size }}>+{rest}</span>}
    </span>
  );
}
