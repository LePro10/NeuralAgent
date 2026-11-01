// Files explorer (D67): the one switch that lets phones and browsers browse the home folder, not
// only approved projects. Shown in Settings → Remote access on the computer; the daemon ignores
// this field when a phone sends it, so it can only be turned on here.
import { List, Row, Switch, toast } from "@neuralagent/ui";
import { FolderOpen } from "lucide-react";
import { phoneRouter } from "../../lib/phoneRoute";
import { useClient, useDaemon, usePlatform } from "../../lib/store";

export function FilesHomeAccess() {
  const client = useClient();
  const platform = usePlatform();
  const settings = useDaemon((c) => c.state?.settings);
  const supported = useDaemon((c) => c.has("files"));
  if (!settings || !supported || platform.kind !== "desktop") return null;
  const on = settings.remote_files_home === true;
  return (
    <List label="Files" footer="Phones always see the files of approved projects. Desktop, Documents and Downloads are never opened in the background.">
      <Row
        Icon={FolderOpen}
        title="Home folder on phones"
        detail={on ? "Phones can browse your whole home folder" : "Phones see approved projects only"}
        trailing={
          <Switch
            label="Home folder on phones"
            checked={on}
            onChange={(v) =>
              void client.req({ m: "settings_set", p: { settings: { ...settings, remote_files_home: v } } }).catch((e: Error) => toast(e.message, { tone: "danger" }))
            }
          />
        }
      />
    </List>
  );
}

/** Phones, Projects tab: the home folder, once it is allowed on the computer. */
export function HomeFolderRow() {
  const platform = usePlatform();
  const on = useDaemon((c) => c.has("files") && c.state?.settings.remote_files_home === true);
  if (!on || platform.kind === "desktop") return null;
  return <Row Icon={FolderOpen} title="Home folder" chevron onClick={() => phoneRouter().push({ k: "files", ws: "home", path: "~" })} />;
}
