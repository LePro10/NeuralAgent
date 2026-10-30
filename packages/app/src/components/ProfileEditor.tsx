import type { Profile } from "@neuralagent/protocol";
import { Button, ConfirmSheet, Field, InlinePicker, Input, toast } from "@neuralagent/ui";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { joinArgs, splitArgs } from "../lib/profiles";
import { useClient, useDaemon } from "../lib/store";

const CUSTOM = "custom";

/** Create or edit a custom profile: a name, which CLI, and extra arguments (e.g. a model). */
export function ProfileEditor({ profile, onDone }: { profile: Profile | null; onDone: () => void }) {
  const client = useClient();
  const catalog = useDaemon((c) => c.state?.catalog);
  const installed = (catalog ?? []).filter((c) => c.installed);
  const [name, setName] = useState(profile?.name ?? "");
  const [asking, setAsking] = useState(false);
  const [engine, setEngine] = useState(profile?.engine ?? installed[0]?.id ?? CUSTOM);
  const [command, setCommand] = useState(profile?.engine === CUSTOM ? profile.command : "");
  const [args, setArgs] = useState(joinArgs(profile?.args ?? []));
  const [busy, setBusy] = useState(false);

  const entry = catalog?.find((c) => c.id === engine);
  const valid = name.trim() !== "" && (engine !== CUSTOM || command.trim() !== "");

  const save = async () => {
    setBusy(true);
    try {
      const next: Profile = {
        id: profile?.id ?? "",
        name: name.trim(),
        engine,
        command: engine === CUSTOM ? command.trim() : (entry?.command ?? engine),
        args: splitArgs(args),
        env: profile?.env ?? {},
        icon: engine,
        builtin: false,
      };
      await client.req({ m: "profile_save", p: { profile: next } });
      onDone();
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!profile) return;
    try {
      await client.req({ m: "profile_delete", p: { id: profile.id } });
      onDone();
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };

  return (
    <div className="flex flex-col gap-5 pb-4">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude (Haiku)" autoFocus />
      </Field>
      <InlinePicker
        title="Runs"
        value={engine}
        kind="list"
        options={[
          ...installed.map((c) => ({ value: c.id, label: c.name, detail: c.command })),
          { value: CUSTOM, label: "Other command", detail: "Any program on your PATH" },
        ]}
        onChange={setEngine}
      />
      {engine === CUSTOM && (
        <Field label="Command" hint="The program name or a full path.">
          <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="my-agent" spellCheck={false} />
        </Field>
      )}
      <Field label="Extra arguments" hint={'Added after our own flags. Quote values with spaces: --name "two words".'}>
        <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="--model haiku" spellCheck={false} className="font-mono" />
      </Field>
      <div className="flex gap-2 pt-2">
        <Button size="lg" variant="quiet" onClick={onDone} className="flex-1">
          Cancel
        </Button>
        <Button size="lg" variant="primary" busy={busy} disabled={!valid} onClick={save} className="flex-1">
          Save
        </Button>
      </div>
      {profile && (
        <>
          <Button size="lg" variant="danger" Icon={Trash2} onClick={() => setAsking(true)} className="w-full">
            Delete profile
          </Button>
          <ConfirmSheet
            open={asking}
            onClose={() => setAsking(false)}
            onConfirm={remove}
            title={`Delete ${profile.name}?`}
            message="Running agents keep running; you can no longer start new ones with it."
            confirmLabel="Delete"
            destructive
            Icon={Trash2}
          />
        </>
      )}
    </div>
  );
}
