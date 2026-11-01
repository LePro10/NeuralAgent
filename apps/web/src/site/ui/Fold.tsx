// A heading with its content. On phones the content folds into a closed <details> so long reference lists do not stretch the page;
// wide screens (`wide`) show it as a plain block with the same heading. The caller owns the media query (useMedia).
import type { ReactNode } from "react";
import { ChevronDown } from "../content/icons";
import { Icon } from "./Icon";

export function Fold({ title, wide, className, children }: { title: string; wide: boolean; className?: string; children: ReactNode }) {
  if (wide) {
    return (
      <div className={className}>
        <h3 className="t-h3">{title}</h3>
        {children}
      </div>
    );
  }
  return (
    <details className={`na-fold${className ? ` ${className}` : ""}`}>
      <summary>
        <span className="t-h3">{title}</span>
        <Icon as={ChevronDown} size="md" className="na-fold__chev" />
      </summary>
      <div className="na-fold__body">{children}</div>
    </details>
  );
}
