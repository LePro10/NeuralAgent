// Phones: before the computer's state is in (cold start, reconnect, "Continue anyway" on the launch
// screen) a page must not claim "No agents yet" / "Add a project": it says it is connecting.
import { Spinner } from "@neuralagent/ui";
import { useDaemon } from "../../lib/store";

/** The daemon state is there (a page's empty state is real). */
export const useHasState = () => useDaemon((c) => !!c.state);

export function Waiting() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-footnote text-dim" role="status">
      <Spinner size={14} />
      Connecting to your computer…
    </div>
  );
}
