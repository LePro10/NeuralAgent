// The legal texts. The wording is the legal text of the site: change it only when the owner asks.
// (Moved here unchanged from src/legal.tsx; the layout around it lives in Legal.tsx.)
// The imprint has no postal address on purpose: it has not been provided. Do not invent one.
import type { ReactNode } from "react";
import { MAIL } from "../../content";

export const UPDATED = "1 November 2026";

const B = ({ children }: { children: ReactNode }) => <b className="lg-b">{children}</b>;
const Mail = () => <a href={`mailto:${MAIL}`}>{MAIL}</a>;
const UL = ({ children }: { children: ReactNode }) => <ul>{children}</ul>;
const WHO = (
  <>
    NeuralAgent and the NeuralHub website are operated by <B>Leandro Probst</B>, a private person. Contact: <Mail />.
  </>
);

export interface Section { title: string; body: ReactNode }
export interface Doc { slug: "imprint" | "privacy" | "terms"; title: string; blurb: string; sections: Section[] }

const IMPRINT: Section[] = [
  { title: "Operator", body: <p>{WHO}</p> },
  { title: "Contact", body: <p>Email: <Mail /></p> },
  { title: "Liability for content and links", body: <p>The content of this site is prepared with care. No guarantee is given for its accuracy or completeness. External links lead to third-party sites whose content the operator does not control.</p> },
  { title: "Software", body: <p>NeuralAgent is provided as is. It starts third-party programs (AI coding agents) on your computer at your request; their terms and costs are between you and their providers.</p> },
];

const PRIVACY: Section[] = [
  { title: "Who is responsible", body: <p>{WHO} Questions about your data: <Mail />.</p> },
  {
    title: "The short version",
    body: (
      <UL>
        <li>The desktop app works on your computer and does not need an account. Your code, terminals and agent output are not sent to us.</li>
        <li>This website sets no cookies and uses no advertising or tracking. It counts page views anonymously, without cookies or IDs.</li>
        <li>The desktop app sends anonymous usage statistics once a day (no prompts, code or names). You can turn this off in Settings → Privacy and support.</li>
        <li>Problem reports are sent only when you press Send, after you have seen exactly what they contain.</li>
        <li>An account exists only for remote access from a phone or browser. It stores what is listed below, and nothing about what your agents do.</li>
      </UL>
    ),
  },
  { title: "This website", body: <p>Pages are served by our own server. Like any web server it handles your IP address and the usual request details to answer the request. The relay keeps IP addresses only in memory, for a per-minute rate limit, and does not write them to its database. From the IP address it derives the country (using the DB-IP country table, or the country our network provider passes on) and stores only that two-letter code in daily counters. Each page view is counted anonymously: the page, the website that linked to it (its domain only), the country and download button clicks; there is no cookie, no ID and nothing that links visits together. Browsers that send Do Not Track or Global Privacy Control are not counted. The site sets no cookies. The web remote stores its sign-in session and device keys in your browser (local storage and IndexedDB) so you stay signed in; clearing site data removes them.</p> },
  {
    title: "Remote access: account and relay",
    body: (
      <>
        <p>If you sign in for remote access, the relay stores:</p>
        <UL>
          <li>Account: email address, name, avatar link and the sign-in provider (Google or GitHub), as supplied by that provider after you agree on its sign-in page.</li>
          <li>Your access request status and the optional message you write when you ask for access.</li>
          <li>Devices: device name, platform, app version, operating system version, country (not the IP address), public key, time created and last seen, a hash of its refresh token, and a byte counter of traffic. The version, system and country help us answer support questions.</li>
          <li>Push addresses: for notifications, an Android push token (Firebase Cloud Messaging) or a browser or home screen web push subscription.</li>
          <li>Daily counters such as sign-ins, connections and active devices. They are not linked to a person.</li>
        </UL>
        <p>Everything your agents and terminals show or do travels end-to-end encrypted between your own devices. The relay passes sealed messages and cannot read their content.</p>
      </>
    ),
  },
  { title: "Sign-in providers", body: <p>Google and GitHub process your sign-in under their own privacy policies. We receive only the profile data named above and never your password.</p> },
  { title: "Push notifications", body: <p>To notify your phone, the relay sends a short message through Google Firebase Cloud Messaging (Android) or through the web push service of your browser (Google, Apple or Mozilla). The message names the event, for example that an agent needs you, so the push service sees that a notification was sent to that device.</p> },
  { title: "Email", body: <p>When your access request is approved or denied, we send you an email from {MAIL}, and the operator is notified of new access requests and problem reports (by email and push notification). Mail is delivered through Brevo (SMTP), which receives the recipient address and the message for that purpose.</p> },
  {
    title: "Anonymous usage statistics",
    body: (
      <>
        <p>
          Once a day the desktop app sends: a random install ID created on your computer (not linked to your account or email), the app version,
          operating system and its version, processor type, language, and counters of how often features were used (for example agents started per
          agent CLI, Neural messages, calls, teams, phone connections). The relay adds the country derived from the IP address and does not store
          the address. It never contains prompts, file or project names, code, terminal output or anything your agents do.
        </p>
        <p>
          We use it to see which systems and versions are in use and which features matter (legitimate interest, Art. 6(1)(f) GDPR). It is on by
          default and you can switch it off at any time in Settings → Privacy and support, where you can also see the exact data that is sent.
          Installs that stop sending are deleted after 400 days.
        </p>
      </>
    ),
  },
  {
    title: "Problem reports",
    body: (
      <p>
        In Settings → Privacy and support you can send us a problem report. It contains what you write, an optional email address for our answer,
        and diagnostics you can read before sending: app and system versions, settings without keys, installed agent CLIs and their versions,
        how many agents run and their states, and, if you leave it on, the end of the service log with tokens, keys and your home folder name
        removed. Your recent messages to Neural are included only if you switch that on. If you are signed in for remote access, the report is
        linked to your account. Reports are kept until the problem is solved and deleted 180 days after that, or earlier on request.
      </p>
    ),
  },
  { title: "Updates and downloads", body: <p>The desktop app checks <B>agent.neuralhub.dev</B> for new versions. The request contains your operating system, architecture and current app version, plus the usual connection details; we count these checks and downloads per platform, version and country, without storing IP addresses. Downloads come from the same server. Optional voice models are downloaded from public model hosts (for example GitHub releases) when you choose to install them, and run locally.</p> },
  { title: "Neural and third-party AI services", body: <p>Neural, the voice orchestrator, sends your conversation to the model provider you configure (an OpenAI-compatible API, Anthropic or a local Ollama) with your own key, which is kept in your system keychain. The AI coding agents you start talk to their own providers. We receive none of this. Please read those providers&rsquo; terms.</p> },
  { title: "Discord status", body: <p>If you switch it on, the app shows a status in your local Discord client. It talks to the Discord app on your computer and is off by default.</p> },
  { title: "Retention and your rights", body: <p>Account and device data are kept until you remove a device, delete your account or ask us to. You can ask for access to, correction of, or deletion of your data at any time: <Mail />. Removing a device or deleting your account removes its data from the relay.</p> },
  { title: "Changes", body: <p>If the product changes what it does with data, this page changes first. Last updated: {UPDATED}.</p> },
];

const TERMS: Section[] = [
  { title: "Scope", body: <p>These terms cover the NeuralAgent app, the remote relay and this website. {WHO}</p> },
  { title: "The app", body: <p>The desktop app runs on your computer and is yours to use. It starts programs you choose, such as AI coding agents, with the permissions you give them. The source code is licensed under the AGPL-3.0. These terms cover the hosted relay and this website.</p> },
  { title: "Remote access", body: <p>Remote access is granted on request and can be declined, paused or withdrawn at any time, for example to protect the service.</p> },
  {
    title: "Your responsibility",
    body: (
      <UL>
        <li>You are responsible for what your agents do on your computer, including changes to files and costs at their providers.</li>
        <li>Keep your devices, sign-in accounts and API keys secure.</li>
        <li>Do not misuse the service, attack it, or use it for anything unlawful.</li>
      </UL>
    ),
  },
  { title: "Availability and liability", body: <p>The service is provided as is, without a guarantee of availability or of results. Liability is excluded as far as the law allows.</p> },
  { title: "Law", body: <p>Swiss law applies, as far as mandatory consumer law does not say otherwise.</p> },
  { title: "Contact", body: <p><Mail /></p> },
];

/** Page title, one-line description and sections per document. `blurb` is the line under the title and in the index pane. */
export const DOCS: Record<Doc["slug"], Doc> = {
  imprint: { slug: "imprint", title: "Imprint", blurb: "Who operates NeuralAgent and how to reach them.", sections: IMPRINT },
  privacy: { slug: "privacy", title: "Privacy", blurb: "What the app, the relay and this website do with data.", sections: PRIVACY },
  terms: { slug: "terms", title: "Terms", blurb: "The rules for the app, the remote relay and this website.", sections: TERMS },
};
export const ORDER: Doc["slug"][] = ["imprint", "privacy", "terms"];

/** `Remote access: account and relay` → `remote-access-account-and-relay`. */
export const slugOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
