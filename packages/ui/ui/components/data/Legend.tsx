import { cn } from '../../lib/cn';

export interface Series { name: string; color: string }

/** With more than one series a legend is always shown — colour alone never carries meaning. */
export function Legend({ series, className }: { series: Series[]; className?: string }) {
  if (series.length < 2) return null;
  return (
    <div className={cn('flex flex-wrap gap-x-3.5 gap-y-1 text-meta text-dim', className)}>
      {series.map((s) => <span key={s.name} className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.name}</span>)}
    </div>
  );
}
