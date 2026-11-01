// /changelog entry. Page: src/site/pages/changelog/. Data: virtual:changelog (CHANGELOG.md, see vite.config.ts).
import "./site/pages/boot";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Changelog } from "./site/pages/changelog/Changelog";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Changelog />
  </StrictMode>,
);
