import "./styles.css";
import { Button } from "@neuralagent/ui";
import { Home } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrandMark } from "./brand";

// One tiny entry for the 404 page and the web-remote placeholder (picked by <body data-page>).
const PAGES: Record<string, { title: string; text: string }> = {
  "404": { title: "Page not found", text: "This page does not exist." },
  app: { title: "Web remote coming soon", text: "Soon you can reach your agents from any browser. For now, use the NeuralAgent desktop app." },
};

function Simple({ page }: { page: string }) {
  const { title, text } = PAGES[page] ?? PAGES["404"]!;
  return (
    <main className="grid min-h-full place-items-center px-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="text-bright"><BrandMark size={36} /></span>
        <h1 className="display text-display">{title}</h1>
        <p className="text-body text-dim">{text}</p>
        <Button href="/" variant="glass" Icon={Home}>Back home</Button>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Simple page={document.body.dataset.page ?? "404"} />
  </StrictMode>,
);
