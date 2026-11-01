// /security entry: the sealed-in-transit walkthrough with every fact (algorithms, honest limits, what leaves your
// computer), then the closing call. Foundation: src/site/pages/boot.
import "./site/pages/boot";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Page } from "./site/pages/Page";
import { Final } from "./site/sections/Final";
import { Security } from "./site/sections/Security";
import { scrollToHash } from "./site/ui";

function App() {
  useEffect(scrollToHash, []);
  return (
    <Page>
      <Security full />
      <Final />
    </Page>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
