import { Button, Callout, Spinner } from "@neuralagent/ui";
import { Code, LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { config, startSignIn } from "./api";

const LABEL: Record<string, string> = { google: "Continue with Google", github: "Continue with GitHub", test: "Test sign-in" };

export function SignIn({ error }: { error?: string }) {
  const [providers, setProviders] = useState<string[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    config().then((c) => setProviders(c.providers), (e) => setFailed((e as Error).message));
  }, []);

  const go = (provider: string, extra?: Record<string, string>) => {
    setBusy(true);
    void startSignIn(provider, extra);
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="display text-display">Admin</h1>
        <p className="text-body text-dim">Sign in to manage access requests, users and devices.</p>
      </div>
      {error && <Callout tone="danger" title="Sign-in failed">{error}</Callout>}
      {failed && <Callout tone="danger" title="Could not reach the server">{failed}</Callout>}
      {!providers && !failed && <Spinner label="Loading" />}
      {providers?.length === 0 && <Callout tone="warning" title="No sign-in provider is set up">Configure Google or GitHub on the relay.</Callout>}
      <div className="flex flex-col gap-2">
        {providers?.filter((p) => p !== "test").map((p) => (
          <Button key={p} block variant={p === "google" ? "primary" : "glass"} Icon={p === "github" ? Code : LogIn} busy={busy} onClick={() => go(p)}>
            {LABEL[p] ?? `Continue with ${p}`}
          </Button>
        ))}
        {providers?.includes("test") && (
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              go("test", { email, name: email.split("@")[0] ?? email });
            }}
          >
            <label className="px-1 text-detail text-dim" htmlFor="test-email">Test sign-in (development only)</label>
            <input
              id="test-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-11 rounded-field bg-fill-2 px-3 text-input text-bright outline-none placeholder:text-faint"
            />
            <Button type="submit" variant="tint" busy={busy}>Test sign-in</Button>
          </form>
        )}
      </div>
    </>
  );
}
