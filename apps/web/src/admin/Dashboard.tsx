import { Avatar, Button, Pill, Segmented } from "@neuralagent/ui";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { Brand } from "../brand";
import { api, type Session } from "./api";
import { usePolled } from "./hooks";
import { Requests } from "./Requests";
import { Stats } from "./Stats";
import { Users } from "./Users";

type Tab = "requests" | "users" | "stats";

export function Dashboard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("requests");
  // Shared with the Requests and Users tabs; also drives the badge.
  const users = usePolled(() => api.users(), 10_000);
  const pending = users.data?.filter((u) => u.status === "pending").length ?? 0;
  const me = session.user;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6 px-4 pb-12">
      <header className="flex items-center justify-between gap-3 py-5">
        <Brand />
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 text-detail text-dim sm:flex">
            <Avatar name={me.name || me.email} src={me.avatar ?? undefined} size={24} />
            {me.name || me.email}
          </span>
          <Button size="sm" variant="glass" Icon={LogOut} onClick={onSignOut}>Sign out</Button>
        </div>
      </header>

      <div className="flex items-center gap-3">
        <Segmented
          label="Section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "requests", label: "Requests" },
            { value: "users", label: "Users" },
            { value: "stats", label: "Stats" },
          ]}
        />
        {pending > 0 && <Pill tone="warning" size="sm">{pending} pending</Pill>}
      </div>

      {tab === "requests" && <Requests users={users} />}
      {tab === "users" && <Users users={users} me={me.id} />}
      {tab === "stats" && <Stats />}
    </div>
  );
}
