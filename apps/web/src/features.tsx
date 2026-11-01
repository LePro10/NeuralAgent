// /features entry: the whole spec sheet, then the 13 agent CLIs, then the closing call. Foundation: src/site/pages/boot.
import "./site/pages/boot";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Page } from "./site/pages/Page";
import { Agents } from "./site/sections/Agents";
import { Final } from "./site/sections/Final";
import { Spec } from "./site/sections/Spec";
import { scrollToHash } from "./site/ui";

function App() {
  useEffect(scrollToHash, []);
  return (
    <Page>
      <Spec />
      <Agents />
      <Final />
    </Page>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
