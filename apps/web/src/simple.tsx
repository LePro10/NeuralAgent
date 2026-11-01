// 404 entry (404.html). Page: src/site/pages/notfound/. Simple pages stay one small entry.
import "./site/pages/boot";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotFound } from "./site/pages/notfound/NotFound";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NotFound />
  </StrictMode>,
);
