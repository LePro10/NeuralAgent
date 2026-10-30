import "./styles.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Brand, Footer } from "./brand";

const MAIL = "agent@neuralhub.dev";
const UPDATED = "30 October 2026";
const B = ({ children }: { children: ReactNode }) => <b className="font-medium text-bright">{children}</b>;
const Mail = () => <a className="text-bright underline decoration-line-2 underline-offset-4" href={`mailto:${MAIL}`}>{MAIL}</a>;
const WHO = (
  <>
    NeuralAgent and the NeuralHub website are operated by <B>Leandro Probst</B>, a private person. Contact: <Mail />.
  </>
);

const H = ({ children }: { children: ReactNode }) => <h2 className="mt-10 text-title text-bright">{children}</h2>;
const UL = ({ children }: { children: ReactNode }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>;

const Imprint = () => (
  <>
    <H>Operator</H>
    <p>{WHO}</p>
    <H>Contact</H>
    <p>Email: <Mail /></p>
    <H>Liability for content and links</H>
    <p>The content of this site is prepared with care. No guarantee is given for its accuracy or completeness. External links lead to third-party sites whose content the operator does not control.</p>
    <H>Software</H>
    <p>NeuralAgent is provided as is. It starts third-party programs (AI coding agents) on your computer at your request; their terms and costs are between you and their providers.</p>
  </>
);

const Privacy = () => (
  <>
    <H>Who is responsible</H>
    <p>{WHO} Questions about your data: <Mail />.</p>

    <H>The short version</H>
    <UL>
      <li>The desktop app works on your computer and does not need an account. Your code, terminals and agent output are not sent to us.</li>
      <li>This website sets no cookies and uses no analytics, advertising or tracking.</li>
      <li>An account exists only for remote access from a phone or browser. It stores what is listed below, and nothing about what your agents do.</li>
    </UL>

    <H>This website</H>
    <p>Pages are served by our own server. Like any web server it handles your IP address and the usual request details to answer the request. The relay keeps IP addresses only in memory, for a per-minute rate limit on sign-in endpoints, and does not write them to its database. The site sets no cookies. The web remote stores its sign-in session and device keys in your browser (local storage and IndexedDB) so you stay signed in; clearing site data removes them.</p>

    <H>Remote access: account and relay</H>
    <p>If you sign in for remote access, the relay stores:</p>
    <UL>
      <li>Account: email address, name, avatar link and the sign-in provider (Google or GitHub), as supplied by that provider after you agree on its sign-in page.</li>
      <li>Your access request status and the optional message you write when you ask for access.</li>
      <li>Devices: device name, platform, public key, time created and last seen, a hash of its refresh token, and a byte counter of traffic.</li>
      <li>Push addresses: for notifications, an Android push token (Firebase Cloud Messaging) or a browser or home screen web push subscription.</li>
      <li>Daily counters such as sign-ins, connections and active devices. They are not linked to a person.</li>
    </UL>
    <p className="mt-2">Everything your agents and terminals show or do travels end-to-end encrypted between your own devices. The relay passes sealed messages and cannot read their content.</p>

    <H>Sign-in providers</H>
    <p>Google and GitHub process your sign-in under their own privacy policies. We receive only the profile data named above and never your password.</p>

    <H>Push notifications</H>
    <p>To notify your phone, the relay sends a short message through Google Firebase Cloud Messaging (Android) or through the web push service of your browser (Google, Apple or Mozilla). The message names the event, for example that an agent needs you, so the push service sees that a notification was sent to that device.</p>

    <H>Email</H>
    <p>When your access request is approved or denied, we send you an email from {MAIL}, and the operator is notified of new access requests. Mail is delivered through Brevo (SMTP), which receives the recipient address and the message for that purpose.</p>

    <H>Updates and downloads</H>
    <p>The desktop app checks <B>agent.neuralhub.dev</B> for new versions. The request contains your operating system, architecture and current app version, plus the usual connection details. Downloads come from the same server. Optional voice models are downloaded from public model hosts (for example GitHub releases) when you choose to install them, and run locally.</p>

    <H>Neural and third-party AI services</H>
    <p>Neural, the voice orchestrator, sends your conversation to the model provider you configure (an OpenAI-compatible API, Anthropic or a local Ollama) with your own key, which is kept in your system keychain. The AI coding agents you start talk to their own providers. We receive none of this. Please read those providers&rsquo; terms.</p>

    <H>Discord status</H>
    <p>If you switch it on, the app shows a status in your local Discord client. It talks to the Discord app on your computer and is off by default.</p>

    <H>Retention and your rights</H>
    <p>Account and device data are kept until you remove a device, delete your account or ask us to. You can ask for access to, correction of, or deletion of your data at any time: <Mail />. Removing a device or deleting your account removes its data from the relay.</p>

    <H>Changes</H>
    <p>If the product changes what it does with data, this page changes first. Last updated: {UPDATED}.</p>
  </>
);

const Terms = () => (
  <>
    <H>Scope</H>
    <p>These terms cover the NeuralAgent app, the remote relay and this website. {WHO}</p>
    <H>The app</H>
    <p>The desktop app runs on your computer and is yours to use. It starts programs you choose, such as AI coding agents, with the permissions you give them.</p>
    <H>Remote access</H>
    <p>Remote access is granted on request and can be declined, paused or withdrawn at any time, for example to protect the service.</p>
    <H>Your responsibility</H>
    <UL>
      <li>You are responsible for what your agents do on your computer, including changes to files and costs at their providers.</li>
      <li>Keep your devices, sign-in accounts and API keys secure.</li>
      <li>Do not misuse the service, attack it, or use it for anything unlawful.</li>
    </UL>
    <H>Availability and liability</H>
    <p>The service is provided as is, without a guarantee of availability or of results. Liability is excluded as far as the law allows.</p>
    <H>Law</H>
    <p>Swiss law applies, as far as mandatory consumer law does not say otherwise.</p>
    <H>Contact</H>
    <p><Mail /></p>
  </>
);

const PAGES: Record<string, { title: string; body: ReactNode }> = {
  imprint: { title: "Imprint", body: <Imprint /> },
  privacy: { title: "Privacy", body: <Privacy /> },
  terms: { title: "Terms", body: <Terms /> },
};

function Legal({ page }: { page: string }) {
  const { title, body } = PAGES[page] ?? PAGES.imprint!;
  return (
    <>
      <main className="mx-auto w-full max-w-3xl px-4">
        <header className="py-5"><Brand /></header>
        <h1 className="display mt-8 text-display sm:text-display-lg">{title}</h1>
        <p className="mt-2 text-detail text-faint">Last updated {UPDATED}</p>
        <div className="mt-2 pb-8 text-body text-dim [&_p]:mt-2">{body}</div>
      </main>
      <Footer />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Legal page={document.body.dataset.page ?? "imprint"} />
  </StrictMode>,
);
