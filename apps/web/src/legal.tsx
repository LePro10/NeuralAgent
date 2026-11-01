// /imprint, /privacy, /terms entry (one bundle, picked by <body data-page>). Page: src/site/pages/legal/.
import "./site/pages/boot";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Legal } from "./site/pages/legal/Legal";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Legal page={document.body.dataset.page ?? "imprint"} />
  </StrictMode>,
);
