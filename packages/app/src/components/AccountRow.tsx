// The user at the foot of the sidebar: photo (Google/GitHub when the relay knows it), name, email,
// initials as fallback. A small menu opens from it: Settings, Remote, Sign out.
import { Avatar, Menu, toast, type MenuEntry } from "@neuralagent/ui";
import { ChevronsUpDown, LogOut, Settings, Smartphone } from "lucide-react";
import { useDaemon, useClient, usePlatform } from "../lib/store";

export function AccountRow({ open, active, onSettings, onRemote, plain }: { open: boolean; active?: boolean; onSettings: () => void; onRemote?: () => void; plain?: boolean }) {
  const client = useClient();
  const platform = usePlatform();
  const account = useDaemon((c) => c.state?.remote.account);
  const name = account?.name || account?.email || "NeuralAgent";
  const detail = account ? account.email : "Local only";

  const items: MenuEntry[] = [
    { label: "Settings", Icon: Settings, onSelect: onSettings },
    ...(onRemote ? [{ label: platform.account?.label ?? "Remote", Icon: Smartphone, onSelect: onRemote }] : []),
    ...(account && platform.kind === "desktop"
      ? [
          {
            label: "Sign out",
            Icon: LogOut,
            destructive: true,
            divider: true,
            onSelect: () => void client.req({ m: "remote_sign_out" }).then(() => toast("Signed out"), (e) => toast((e as Error).message, { tone: "danger" })),
          } satisfies MenuEntry,
        ]
      : []),
  ];

  if (plain) {
    // Phone: one tap opens Settings, where the account lives.
    return (
      <button type="button" onClick={onSettings} aria-label={`${name}, settings`} className="pressable flex h-11 w-full items-center gap-3 rounded-field bg-fill-2 px-3 text-left shadow-edge">
        <Avatar name={name} src={account?.avatar} size={32} color={account?.avatar ? undefined : "var(--color-accent)"} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-chip leading-tight text-bright">{name}</span>
          <span className="block truncate text-tiny leading-tight text-dim">{detail}</span>
        </span>
        <Settings size={16} strokeWidth={1.6} className="shrink-0 text-dim" />
      </button>
    );
  }
  return (
    <Menu
      block
      align="start"
      title="Account"
      width={230}
      items={items}
      trigger={(openMenu) => (
        <button
          type="button"
          onClick={openMenu}
          aria-label={`${name}, account menu`}
          className={"pressable group flex h-11 w-full items-center gap-2.5 rounded-field px-2 text-left hover:bg-fill-2 " + (active ? "bg-fill-3 shadow-edge" : "")}
        >
          <Avatar name={name} src={account?.avatar} size={30} color={account?.avatar ? undefined : "var(--color-accent)"} />
          <span className="min-w-0 flex-1 whitespace-nowrap transition-opacity duration-200" style={{ opacity: open ? 1 : 0, transitionDelay: open ? "60ms" : "0ms" }}>
            <span className="block truncate text-chip leading-tight text-bright">{name}</span>
            <span className="block truncate text-tiny leading-tight text-dim">{detail}</span>
          </span>
          {open && <ChevronsUpDown size={14} strokeWidth={1.6} className="shrink-0 text-faint transition-colors group-hover:text-ink" />}
        </button>
      )}
    />
  );
}
