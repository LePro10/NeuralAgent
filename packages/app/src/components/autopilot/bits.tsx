// Small pieces the autopilot screens share: connector icons and status dots, external links.
import type { Connector, ConnectorStatus } from "@neuralagent/protocol";
import { Callout, StatusDot } from "@neuralagent/ui";
import { Bot, Compass, Globe, MessageCircle, Plug, Rss, Sparkles, type LucideIcon } from "lucide-react";
import { STATUS_LABEL, STATUS_TONE } from "../../lib/autopilot";
import { usePlatform } from "../../lib/store";

/** The manifest's `icon` is a name; unknown ones fall back to the kind of connector. */
const ICONS: Record<string, LucideIcon> = {
  discord: MessageCircle,
  github: Bot,
  browser: Compass,
  reddit: Compass,
  feed: Rss,
  rss: Rss,
  "web-api": Globe,
  api: Globe,
  globe: Globe,
  mcp: Plug,
  bot: Bot,
  sparkles: Sparkles,
};

export function connectorIcon(c: Pick<Connector, "id" | "manifest">): LucideIcon {
  return ICONS[c.manifest.icon] ?? ICONS[c.id] ?? (c.manifest.kind === "feed" ? Rss : c.manifest.kind === "browser" ? Compass : c.manifest.kind === "api" ? Globe : c.manifest.kind === "mcp" ? Plug : MessageCircle);
}

export function StatusMark({ status }: { status: ConnectorStatus }) {
  return <StatusDot tone={STATUS_TONE[status]} pulse={status === "starting" || status === "building"} label={STATUS_LABEL[status]} size={8} />;
}

/** Opens a link in the system browser (desktop) or a new tab. */
export function useOpenLink() {
  const platform = usePlatform();
  return (url: string) => {
    if (platform.openExternal) platform.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };
}

/** Things worth knowing about a connector (a tool skipped because its schema was unusable). */
export function ConnectorWarnings({ c }: { c: Pick<Connector, "warnings"> }) {
  const list = c.warnings ?? [];
  if (list.length === 0) return null;
  return (
    <Callout tone="warning" title={list.length === 1 ? "Heads up" : `${list.length} things to know`}>
      <ul className="flex flex-col gap-1 text-footnote break-words">
        {list.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </Callout>
  );
}
