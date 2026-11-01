# Insights: admin dashboard, usage stats, problem reports (D81)

What the operator sees about the product, where it comes from, and what is never collected.

## Data sources

| Source | Sent by | Endpoint | Stored |
|---|---|---|---|
| Usage ping (daily) | desktop daemon (`crates/na-daemon/src/telemetry.rs`) | `POST /api/telemetry` | `installs` row per sha256(install id): app, version, OS + version, arch, locale, country, first/last seen; `install_days`; counters `use:*`, `ping:<app>`, `active:<app>` in `stats` |
| Problem report | user presses Send in Settings → Privacy and support | `POST /api/reports` (bearer optional) | `reports` row: summary, details, contact, app/version/OS/country, diagnostics JSON, status, admin note |
| Website visit | `apps/web/src/site/ui/hit.ts` (sendBeacon) | `POST /api/hit` | counters `page:<path>`, `visit_cc:<CC>`, `ref:<host>`, `dlclick:<kind>` |
| Downloads | relay itself (`releases.rs` `count_download`) | `/download/...` | `dl:<key>`, `dl_v:<version>`, `dl_cc:<CC>`, `update_dl:<platform>`, `update_to:<version>` |
| Update checks | relay itself | `/api/update/...` | `update_check:<platform>`, `update_from:<version>` (installed versions, also with the ping off) |
| Devices | every token refresh (daemon, web remote, Android) | `/api/auth/refresh` body `version`, `os` | `devices.version`, `devices.os`, `devices.country` |
| Admin actions | admin API | — | `audit` table (also "requested access") |

Country: `crates/na-relay/src/geo.rs`. `cf-ipcountry` from a trusted proxy, else the DB-IP Lite CSV
at `NA_RELAY_GEOIP` (default `<db dir>/geoip.csv`, fetched monthly by `deploy/relay/geoip.sh`).
Without either, `--`. **No IP address is written anywhere.**

## What is never collected
Prompts, code, file/project/workspace names, terminal output, agent conversations. The only
exception is a problem report where the user switched on "Attach my recent Neural requests"
(last 20 user messages to Neural, redacted like the log) and then pressed Send after seeing the
JSON. The log is redacted by `telemetry::redact` (tokens after `token=`/`key=`/…, `Bearer x`,
`sk-…`, long random strings, home folder → `~`).

## Switches
- `settings.usage_stats` (protocol `Settings`, `None` = on). Settings → Privacy and support shows
  the exact ping (`diagnostics_preview { usage: true }`).
- Debug builds never ping unless `NEURALAGENT_TELEMETRY=1`; `NEURALAGENT_TELEMETRY=0` always off.
- One-time toast on the desktop (`packages/app/src/lib/usageNotice.ts`, localStorage `na-usage-notice`).
- The website: no cookie, so no banner. DNT / GPC are respected in the browser and on the relay.
  The demo frame and the Vite dev server send nothing; the demo's settings have the ping off.

## Admin area (`apps/web/src/admin/`)
Tabs: Overview, Requests, Users (devices with version/OS/country), Reports (diagnostics viewer,
status open → seen → solved, note, mailto), Usage, Downloads & Website, Activity (audit). Hash
routes (`#reports/R-XXXXXX`) are what the notification mails link to. All data comes from
`GET /api/admin/stats` (counters, `totals`, `installs`), `/reports`, `/audit`, `/users`.

## Notifications to admins
New access request or problem report: mail (Brevo) and push (`Push::notify_admins`, payload
`{t: "admin", kind, title, body}`) to every device of an admin account that registered for push.
The web service worker and the Android `PushService` open `/admin/#requests` or `#reports`.

## Retention (`Db::prune`, once a day)
Installs not seen for 400 days; solved reports 180 days after the last change; audit 365 days.
Daily counters have no person in them and stay.

## Legal note
Opt-out (on by default) rests on legitimate interest for anonymous, minimal product statistics;
the privacy page says so. A random install id is still pseudonymous data. If the owner prefers
opt-in, flip the default in `telemetry::enabled` (`!= Some(false)` → `== Some(true)`) and the
switch text; nothing else changes.

## Open points
- Phones and the web remote do not send their own usage ping (their use shows up as
  `remote_sessions.*` counters of the computer and as devices).
- Android `PushService` admin branch not run on a device yet.
- The relay loads the GeoIP table only at start (`geoip.sh` restarts it).
