// Files explorer (D67), phones: each folder and each file is its own page in the router
// (lib/phoneRoute.ts), so Android back and browser back walk up the way you came.
import type { FileListing } from "@neuralagent/protocol";
import { Empty, Page } from "@neuralagent/ui";
import { FolderX } from "lucide-react";
import { useCallback, useState } from "react";
import { phoneRouter, usePhoneNav } from "../../lib/phoneRoute";
import { useDaemon } from "../../lib/store";
import { useFileActions } from "./actions";
import { FileViewer } from "./FileViewer";
import { Crumbs, FolderView, crumbsFor } from "./FolderView";
import { baseName } from "./model";
import { useFilesSupported } from "./support";

/** A folder further up: back to its page when it is already under this one, else a new page. */
function goUp(ws: string, root: string, path: string) {
  const { tab, stack } = usePhoneNav.getState();
  const i = stack.findIndex((r) => r.k === "files" && r.ws === ws && (r.path ?? root) === path);
  if (i >= 0) phoneRouter().go({ tab, stack: stack.slice(0, i + 1) });
  else phoneRouter().push({ k: "files", ws, path });
}

function Unsupported() {
  return (
    <Page title="Files">
      <Empty Icon={FolderX} title="Update NeuralAgent on the computer" detail="Files need the newest NeuralAgent on the computer this device controls." />
    </Page>
  );
}

export function FilesFolderPage({ ws, path }: { ws: string; path?: string }) {
  const w = useDaemon((c) => c.state?.workspaces.find((x) => x.id === ws));
  const supported = useFilesSupported();
  const actions = useFileActions({ workspaceId: ws, phone: true, onSent: (sid) => phoneRouter().openAgent(sid) });
  const [listing, setListing] = useState<FileListing | null>(null);
  const onListing = useCallback((l: FileListing | null) => setListing(l), []);
  if (supported === false) return <Unsupported />;
  const at = path ?? w?.path;
  if (!at) {
    return (
      <Page title="Files">
        <Empty Icon={FolderX} title="This project is gone" detail="It was removed on the computer." />
      </Page>
    );
  }
  const root = listing?.root ?? w?.path ?? at;
  const crumbs = crumbsFor(listing, at, root, w?.name ?? listing?.root_name ?? "Files");
  const here = listing?.path ?? at;
  const atRoot = here === root || (!listing && !path);
  const title = atRoot ? (w?.name ?? listing?.root_name ?? baseName(at)) : baseName(here);
  return (
    <>
      <Page
        title={title}
        eyebrow={atRoot ? "Files" : undefined}
        header={crumbs.length > 1 ? <Crumbs crumbs={crumbs} onGo={(p) => goUp(ws, root, p)} className="-mx-1.5 mb-3" /> : undefined}
      >
        <FolderView
          path={at}
          phone
          actions={actions}
          onListing={onListing}
          onOpenFolder={(p) => phoneRouter().push({ k: "files", ws, path: p })}
          onOpenFile={(e) => phoneRouter().push({ k: "file", ws, path: e.path })}
        />
      </Page>
      {actions.sheet}
    </>
  );
}

export function FilePage({ ws, path }: { ws: string; path: string }) {
  const supported = useFilesSupported();
  const actions = useFileActions({ workspaceId: ws, phone: true, onSent: (sid) => phoneRouter().openAgent(sid) });
  if (supported === false) return <Unsupported />;
  return (
    <FileViewer
      path={path}
      phone
      actions={actions}
      chrome={({ title, eyebrow, tools, body }) => (
        <Page title={title} eyebrow={eyebrow} actions={tools}>
          {body}
        </Page>
      )}
    />
  );
}
