// Settings → Privacy and support → "Your reports": the problem reports sent from this account and
// the answers the NeuralAgent team wrote back (D91). Shown only when signed in to Remote and the
// computer's service knows `reports_mine`.
import { List, Pill, Row, Spinner } from "@neuralagent/ui";
import { MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { reportDate, reportsMine, reportsSupported, type MyReport } from "../../lib/reports";
import { useClient, useDaemon } from "../../lib/store";

const tone = (s: MyReport["status"]) => (s === "solved" ? "success" : s === "seen" ? "warning" : "neutral");

export function YourReports() {
  const client = useClient();
  const account = useDaemon((c) => c.state?.remote.account);
  const supported = useDaemon((c) => (c.status === "open" ? reportsSupported(c) : false));
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account || !supported) return;
    let live = true;
    reportsMine(client)
      .then((r) => live && setReports(r))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [client, account, supported]);

  if (!account || !supported) return null;
  if (!reports && !error) return <div className="flex justify-center py-4"><Spinner label="Loading your reports" /></div>;
  if (error) return <p className="px-1 text-footnote text-dim">Could not load your reports: {error}</p>;
  if (!reports || reports.length === 0) return null;

  return (
    <List label="Your reports" footer="Answers from the NeuralAgent team appear here and arrive as a notification.">
      {reports.map((r) => (
        <div key={r.id} className="flex flex-col gap-2">
          <Row
            wrap
            title={<span className="flex flex-wrap items-center gap-1.5"><span className="truncate">{r.summary}</span><Pill size="sm" tone={tone(r.status)}>{r.status}</Pill></span>}
            detail={`${r.id} · ${reportDate(r.created_at)}`}
          />
          {r.answers.map((a) => (
            <Row key={a.at + a.text.slice(0, 8)} wrap Icon={MessageSquare} title={a.text} detail={`NeuralAgent · ${reportDate(a.at)}`} />
          ))}
        </div>
      ))}
    </List>
  );
}
