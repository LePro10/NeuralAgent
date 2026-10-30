// The user at the foot of the sidebar: photo (Google/GitHub when the relay knows it), name, email,
// initials as fallback. One click opens Settings, where the account, remote access and sign-out live.
import { ActivityMark, Avatar, type Activity } from "@neuralagent/ui";
import { Settings } from "lucide-react";
import { useDaemon } from "../lib/store";

export function AccountRow({ open, active, activity, onSettings }: { open: boolean; active?: boolean; activity?: Activity; onSettings: () => void }) {
  const account = useDaemon((c) => c.state?.remote.account);
  const name = account?.name || account?.email || "NeuralAgent";
  const detail = account ? account.email : "Local only";
  return (
    <button
      type="button"
      onClick={onSettings}
      aria-label={`${name}, settings`}
      aria-current={active ? "page" : undefined}
      title={open ? undefined : "Settings"}
      // 6.5 px: the avatar's centre on the rail's centre line, like the nav icons above it.
      style={{ paddingLeft: 6.5 }}
      className={"pressable group flex h-11 w-full items-center gap-2.5 rounded-field px-2 text-left hover:bg-fill-2 " + (active ? "bg-fill-3 shadow-edge" : "")}
    >
      <span className="relative shrink-0">
        <Avatar name={name} src={account?.avatar} size={30} color={account?.avatar ? undefined : "var(--color-accent)"} />
        <ActivityMark activity={activity} edge="ring-chrome" size={8} corner="-top-0.5 -right-0.5" />
      </span>
      <span className="min-w-0 flex-1 whitespace-nowrap transition-opacity duration-200" style={{ opacity: open ? 1 : 0, transitionDelay: open ? "60ms" : "0ms" }}>
        <span className="block truncate text-chip leading-tight text-bright">{name}</span>
        <span className="block truncate text-tiny leading-tight text-dim">{detail}</span>
      </span>
      {open && <Settings size={15} strokeWidth={1.6} className={"shrink-0 transition-colors group-hover:text-ink " + (active ? "text-ink" : "text-faint")} />}
    </button>
  );
}
