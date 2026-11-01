import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconSize } from "./Icon";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, ArrowUpRight } from "lucide-react";

type Common = {
  variant?: "primary" | "secondary" | "ghost" | "icon";
  size?: "sm" | "md" | "lg";
  /** Leading icon. */
  icon?: LucideIcon;
  /** Trailing arrow: "go" (slides right on hover) or "up" (north-east, for external links). */
  arrow?: "go" | "up";
  children?: ReactNode;
};

function Inner({ icon, arrow, children, size }: Pick<Common, "icon" | "arrow" | "children" | "size">) {
  const px: IconSize = size === "lg" ? 18 : 16;
  return (
    <>
      {icon && <Icon as={icon} size={px} />}
      {children != null && <span>{children}</span>}
      {arrow === "go" && <Icon as={ArrowRight} size={px} className="na-btn__go" />}
      {arrow === "up" && <Icon as={ArrowUpRight} size={px} className="na-btn__up" />}
    </>
  );
}

/**
 * Button. primary = solid bright (one per view), secondary = hairline, ghost = text, icon = square icon-only
 * (needs aria-label). 44 px tall by default, 52 `lg`. Press = scale .975. Focus ring = accent.
 */
export function Button({ variant = "secondary", size = "md", icon, arrow, children, className, ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`na-btn${className ? ` ${className}` : ""}`} data-variant={variant} data-size={size} {...rest}>
      <Inner icon={icon} arrow={arrow} size={size}>{children}</Inner>
    </button>
  );
}

/** Same look as <Button>, but a link. External `https://` links open in a new tab with `rel="noopener"`. */
export function LinkButton({ variant = "secondary", size = "md", icon, arrow, children, className, href, ...rest }: Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const external = /^https?:\/\//.test(href) && !href.startsWith(location.origin);
  return (
    <a
      className={`na-btn${className ? ` ${className}` : ""}`}
      data-variant={variant}
      data-size={size}
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...rest}
    >
      <Inner icon={icon} arrow={arrow ?? (external ? "up" : undefined)} size={size}>{children}</Inner>
    </a>
  );
}
