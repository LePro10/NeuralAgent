import { Button, Callout, Spinner } from "@neuralagent/ui";
import { LogOut } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "../brand";
import { ApiError, api, finishSignIn, hasStoredSession, onSignedOut, restore, signOut, type Session } from "./api";
import { Dashboard } from "./Dashboard";
import { CreatePasskey, UnlockPasskey } from "./PasskeyScreens";
import { SignIn } from "./SignIn";

type State =
  | { at: "loading" }
  | { at: "signin"; error?: string }
  | { at: "denied"; email: string }
  | { at: "ready"; session: Session }
  | { at: "failed"; message: string };

/** Centered card used by every pre-dashboard screen. */
export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Brand />
      {children}
    </main>
  );
}

export function App() {
  const [state, setState] = useState<State>({ at: "loading" });

  const check = useCallback(async () => {
    try {
      const session = await api.session();
      setState({ at: "ready", session });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setState({ at: "denied", email: "" });
      else if (e instanceof ApiError && e.status === 401) setState({ at: "signin" });
      else setState({ at: "failed", message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    const off = onSignedOut(() => setState({ at: "signin" }));
    void (async () => {
      const done = await finishSignIn();
      if (done?.error) return setState({ at: "signin", error: done.error });
      if (!done && !hasStoredSession()) return setState({ at: "signin" });
      try {
        if (!done) await restore();
      } catch {
        return; // onSignedOut already switched to the sign-in screen
      }
      await check();
    })();
    return off;
  }, [check]);

  const out = () => void signOut();

  switch (state.at) {
    case "loading":
      return (
        <Screen>
          <div className="flex items-center gap-3 text-meta text-dim">
            <Spinner /> Loading…
          </div>
        </Screen>
      );
    case "signin":
      return (
        <Screen>
          <SignIn error={state.error} />
        </Screen>
      );
    case "denied":
      return (
        <Screen>
          <Callout tone="danger" title="This account is not an admin">
            You are signed in, but this account has no access to the admin area.
          </Callout>
          <Button variant="glass" Icon={LogOut} onClick={out}>Sign out</Button>
        </Screen>
      );
    case "failed":
      return (
        <Screen>
          <Callout tone="danger" title="Could not load the admin area">{state.message}</Callout>
          <div className="flex gap-2">
            <Button onClick={() => void check()}>Retry</Button>
            <Button variant="glass" onClick={out}>Sign out</Button>
          </div>
        </Screen>
      );
    case "ready": {
      const { session } = state;
      if (session.passkeys === 0) return <Screen><CreatePasskey onDone={check} onSignOut={out} /></Screen>;
      if (!session.verified) return <Screen><UnlockPasskey onDone={check} onSignOut={out} /></Screen>;
      // A later "passkey required" (cookie gone) sends the user back to the unlock screen.
      return <Dashboard session={session} onSignOut={out} onLocked={() => setState({ at: "ready", session: { ...session, verified: false } })} />;
    }
  }
}
