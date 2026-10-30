// Phones: the "More" tab — everything that is not a tab, as a grouped list with quiet icon tiles.
// The account sits on top (one tap: Settings, where it lives), the version or Update button under it.
import { Avatar, List, Page, Row, type Activity } from "@neuralagent/ui";
import type { LucideIcon } from "lucide-react";
import { useDaemon } from "../lib/store";
import { UpdateBadge } from "./UpdateBadge";

export interface MoreItem {
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Right-aligned value ("Waiting", "On"). */
  value?: string;
  /** Activity mark on the tile (see Activity in @neuralagent/ui). */
  activity?: Activity;
  /** Group: rows with the same group share a card. */
  group?: string;
}

export function MorePage({ items, onGo, onAccount }: { items: MoreItem[]; onGo: (id: string) => void; onAccount: () => void }) {
  const account = useDaemon((c) => c.state?.remote.account);
  const name = account?.name || account?.email || "NeuralAgent";
  const groups = [...new Set(items.map((i) => i.group ?? ""))];
  return (
    <Page title="More">
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <List>
            <Row
              leading={<Avatar name={name} src={account?.avatar} size={52} color={account?.avatar ? undefined : "var(--color-accent)"} />}
              title={<span className="text-title-3">{name}</span>}
              detail={account ? account.email : "Local only · Settings and remote access"}
              onClick={onAccount}
            />
          </List>
          <UpdateBadge phone />
        </div>
        {groups.map((g) => (
          <List key={g || "main"} label={g.trim() || undefined}>
            {items
              .filter((i) => (i.group ?? "") === g)
              .map((i) => (
                <Row key={i.id} Icon={i.Icon} activity={i.activity} title={i.label} value={i.value} onClick={() => onGo(i.id)} />
              ))}
          </List>
        ))}
      </div>
    </Page>
  );
}
