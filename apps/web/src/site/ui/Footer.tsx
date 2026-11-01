import { BrandMark } from "../../brand";
import { FOOTER_COLUMNS, GITHUB, MAIL } from "../content";
import { ActivityMark } from "./ActivityMark";
import { GitHubIcon, Icon } from "./Icon";
import { Mail } from "./icons";
import { shortDate, useRelease } from "./release";

/**
 * Footer for every marketing page: columns (Product, Download, Resources, Legal), GitHub, mail, the licence
 * line and a quiet terminal-style status line fed by /api/releases/latest (graceful when offline).
 */
export function Footer() {
  const { latest, status } = useRelease();
  return (
    <footer className="na-footer" aria-label="Site footer">
      <div className="na-frame">
        <div className="na-footer__top">
          <div className="na-footer__brand">
            <a className="na-brand" href="/" aria-label="NeuralAgent, home" style={{ marginRight: 0 }}>
              <BrandMark size={24} />
              <span>NeuralAgent</span>
            </a>
            <p>Thirteen coding agent CLIs in one grid of panes, on your own computer. Open source, local first, end-to-end encrypted to your phone.</p>
            <div className="na-footer__links">
              <a href={GITHUB} target="_blank" rel="noopener noreferrer"><GitHubIcon size={16} />GitHub</a>
              <a href={`mailto:${MAIL}`}><Icon as={Mail} size="sm" />{MAIL}</a>
            </div>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.title} className="na-footer__col" aria-label={col.title}>
              <h3>{col.title.toLowerCase()}/</h3>
              {col.links.map((l) => (
                <a key={l.label} href={l.href} {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{l.label}</a>
              ))}
            </nav>
          ))}
        </div>
        <div className="na-footer__base">
          <span>&copy; {new Date().getFullYear()} Leandro Probst · <a className="na-link" href={`${GITHUB}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>AGPL-3.0</a></span>
          <span className="na-footer__status" role="status" aria-live="polite">
            <ActivityMark kind={status === "ok" ? "working" : "idle"} size="sm" />
            {status === "ok" && latest ? (
              <>
                <span data-state="up">relay online</span>
                <span className="sep">·</span>
                <span>latest v{latest.version}</span>
                {shortDate(latest.pub_date) && (
                  <>
                    <span className="sep na-hide-sm">·</span>
                    <span className="na-hide-sm">{shortDate(latest.pub_date)}</span>
                  </>
                )}
              </>
            ) : status === "loading" ? (
              <span>checking latest release…</span>
            ) : (
              <span>latest release unavailable</span>
            )}
          </span>
        </div>
      </div>
    </footer>
  );
}
