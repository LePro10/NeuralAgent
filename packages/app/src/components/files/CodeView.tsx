// Files explorer (D68): text and code with line numbers and light highlighting (highlight.ts).
// Lines render in blocks that skip layout while off screen, so long files stay smooth.
import { cn } from "@neuralagent/ui";
import { memo, useMemo, type CSSProperties } from "react";
import { highlight, type Line } from "./highlight";

const BLOCK = 400;

export const CodeView = memo(function CodeView({ text, lang, wrap, className }: { text: string; lang: string; wrap: boolean; className?: string }) {
  const lines = useMemo(() => {
    const out = highlight(text, lang);
    // A trailing newline does not make an empty last line.
    if (out.length > 1 && out.at(-1)!.length === 0 && text.endsWith("\n")) out.pop();
    return out;
  }, [text, lang]);
  const blocks = useMemo(() => {
    const out: Line[][] = [];
    for (let i = 0; i < lines.length; i += BLOCK) out.push(lines.slice(i, i + BLOCK));
    return out;
  }, [lines]);
  const gutter = `${Math.max(2, String(lines.length).length)}ch`;
  return (
    <div className={cn("fv-code", className)} data-wrap={wrap} style={{ "--fv-gutter": gutter } as CSSProperties}>
      {blocks.map((b, bi) => (
        <div key={bi} className="fv-block" style={{ "--fv-rows": b.length } as CSSProperties}>
          {b.map((line, li) => (
            <div key={li} className="fv-line" data-n={bi * BLOCK + li + 1}>
              <span>
                {line.map((t, ti) =>
                  t.c ? (
                    <span key={ti} className={`fv-${t.c}`}>
                      {t.s}
                    </span>
                  ) : (
                    t.s
                  ),
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});
