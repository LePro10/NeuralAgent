import "./styles.css";
import { Button } from "@neuralagent/ui";
import { Download, Globe, LayoutGrid, Lock, Mic, Smartphone } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrandMark, Footer } from "./brand";

const FEATURES: { Icon: LucideIcon; title: string; text: string }[] = [
  { Icon: LayoutGrid, title: "Agents in a grid", text: "Run Claude Code, Codex and more side by side in a pane grid, each in its own project folder." },
  { Icon: Mic, title: "Voice", text: "Say “Hey Neural”. Chat with the orchestrator or call it, and let it start and steer your agents." },
  { Icon: Smartphone, title: "Remote & phone", text: "Check on your agents and answer their questions from your phone, wherever you are." },
  { Icon: Lock, title: "Private by design", text: "Your code stays on your computer. The relay only passes sealed, end-to-end encrypted messages." },
];

function Landing() {
  return (
    <>
      <main className="mx-auto w-full max-w-4xl px-4">
        <header className="flex items-center justify-between py-5">
          <span className="inline-flex items-center gap-2 text-bright">
            <BrandMark size={20} />
            <span className="text-body font-medium">NeuralAgent</span>
          </span>
          <a href="/app/" className="text-detail text-dim hover:text-bright">Web remote</a>
        </header>

        <section className="flex flex-col items-start gap-6 pb-14 pt-12 sm:pt-20">
          <span className="grid h-16 w-16 place-items-center rounded-card surface text-bright">
            <BrandMark size={34} />
          </span>
          <h1 className="display text-display sm:text-display-lg">Your AI coding agents, on every screen.</h1>
          <p className="max-w-xl text-lead text-dim">
            NeuralAgent runs Claude Code, Codex and other agents in a pane grid on your computer. Talk to them, and reach them from your phone, end-to-end encrypted.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button href="/download" Icon={Download}>Download</Button>
            <Button href="/app/" variant="glass" Icon={Globe}>Open web remote</Button>
          </div>
        </section>

        <section className="grid gap-2 sm:grid-cols-2" aria-label="Features">
          {FEATURES.map(({ Icon, title, text }) => (
            <div key={title} className="card !rounded-list p-4">
              <span className="mb-3 grid h-8 w-8 place-items-center rounded-tile bg-fill-3 text-bright">
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <h2 className="text-title text-bright">{title}</h2>
              <p className="mt-1 text-small text-dim">{text}</p>
            </div>
          ))}
        </section>
      </main>
      <Footer />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
