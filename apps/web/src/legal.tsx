import "./styles.css";
import { Callout } from "@neuralagent/ui";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Brand, Footer } from "./brand";

// Legal pages are drafts: the operator fills the placeholders and has them reviewed before launch.
const WHO = (
  <>
    NeuralHub, operated by <b className="font-medium text-bright">[Name]</b>, a private person in Switzerland,{" "}
    <b className="font-medium text-bright">[Address]</b>, <b className="font-medium text-bright">[Email]</b>.
  </>
);

const H = ({ children }: { children: ReactNode }) => <h2 className="mt-8 text-title text-bright">{children}</h2>;
const UL = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>;

const Imprint = () => (
  <>
    <H>Operator</H>
    <p>{WHO}</p>
    <H>Contact</H>
    <p>Email: <b className="font-medium text-bright">[Email]</b></p>
    <H>Liability</H>
    <p>The content of this site is prepared with care. No guarantee is given for its accuracy, and the service is provided as is.</p>
  </>
);

const Privacy = () => (
  <>
    <H>Who is responsible</H>
    <p>{WHO}</p>
    <H>What the relay stores</H>
    <p>NeuralAgent works without an account on your own computer. The account and the remote relay (needed for phone and web access) store:</p>
    <UL>
      <li>Account: email address, name, avatar URL and the sign-in provider (Google or GitHub).</li>
      <li>If you ask for access: the optional message you write.</li>
      <li>Devices: device name, platform and public key, the time it was last seen, and a byte counter of traffic per device.</li>
      <li>Daily anonymous counters: sign-ins, connections, pairings, requests and active devices. They are not linked to a person.</li>
    </UL>
    <H>What the relay cannot read</H>
    <p>Everything your agents and terminals show or do is end-to-end encrypted between your devices. The relay only passes sealed messages and cannot read their content.</p>
    <H>Email</H>
    <p>When access is approved or denied, we send you an email. Mails are sent through Brevo (SMTP), which receives your address for that purpose.</p>
    <H>Hosting</H>
    <p>The service runs on our own server in Switzerland.</p>
    <H>Cookies and tracking</H>
    <p>No tracking, no analytics and no advertising. The only cookie is the admin session cookie, set for administrators after the passkey check. Visitors get no cookies.</p>
    <H>Your rights</H>
    <p>You can ask for access to, correction of, or deletion of your data at any time: <b className="font-medium text-bright">[Email]</b>. Removing a device or deleting your account removes its data.</p>
  </>
);

const Terms = () => (
  <>
    <H>Scope</H>
    <p>These terms cover use of the NeuralAgent relay and website, run by {WHO}</p>
    <H>Access</H>
    <p>Remote access is granted on request and can be declined, paused or withdrawn at any time.</p>
    <H>Your responsibility</H>
    <UL>
      <li>You are responsible for what your agents do on your computer.</li>
      <li>Do not misuse the service, attack it, or use it for anything unlawful.</li>
      <li>Keep your devices and sign-in accounts secure.</li>
    </UL>
    <H>Availability and liability</H>
    <p>The service is provided as is, without a guarantee of availability. Liability is excluded as far as the law allows.</p>
    <H>Law</H>
    <p>Swiss law applies. Place of jurisdiction: <b className="font-medium text-bright">[Address]</b>.</p>
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
        <Callout tone="warning" title="Draft — to be reviewed">
          This text is a draft with placeholders in [brackets]. It is not legal advice.
        </Callout>
        <h1 className="display mt-8 text-display sm:text-display-lg">{title}</h1>
        <div className="mt-4 text-body text-dim [&_p]:mt-2">{body}</div>
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
