import { Button, Callout } from "@neuralagent/ui";
import { Fingerprint, KeyRound } from "lucide-react";
import { useState } from "react";
import { passkeysSupported, createPasskey, unlockWithPasskey } from "./passkey";

function Flow({ title, text, label, Icon, run, onDone, onSignOut }: {
  title: string;
  text: string;
  label: string;
  Icon: typeof KeyRound;
  run: () => Promise<void>;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await run();
      onDone();
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "The passkey prompt was cancelled." : (e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="display text-display">{title}</h1>
        <p className="text-body text-dim">{text}</p>
      </div>
      {!passkeysSupported() && <Callout tone="danger" title="Passkeys are not available">This browser or connection (HTTPS or localhost is required) does not support passkeys.</Callout>}
      {error && <Callout tone="danger">{error}</Callout>}
      <div className="flex gap-2">
        <Button Icon={Icon} busy={busy} disabled={!passkeysSupported()} onClick={() => void go()}>{label}</Button>
        <Button variant="quiet" onClick={onSignOut}>Sign out</Button>
      </div>
    </>
  );
}

export const CreatePasskey = (p: { onDone: () => void; onSignOut: () => void }) => (
  <Flow
    {...p}
    title="Create a passkey"
    text="The passkey is the second factor for the admin area. Signing in alone is not enough; you also unlock with this passkey."
    label="Create passkey"
    Icon={KeyRound}
    run={createPasskey}
  />
);

export const UnlockPasskey = (p: { onDone: () => void; onSignOut: () => void }) => (
  <Flow {...p} title="Unlock with your passkey" text="Confirm with your passkey to open the admin area." label="Unlock" Icon={Fingerprint} run={unlockWithPasskey} />
);
