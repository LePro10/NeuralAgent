// Files explorer (D68): whether the computer's service knows the `file_*` requests. It lists
// "files" in `HelloOk.features`; an older one would close a relay session on an unknown request,
// so nothing about Files is shown or sent to it.
import { useDaemon } from "../../lib/store";

/** True when the connected service has Files, false for an older one, null while connecting. */
export function useFilesSupported(): boolean | null {
  return useDaemon((c) => (c.status === "open" ? c.has("files") : null));
}
