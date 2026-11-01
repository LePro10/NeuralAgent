// /download entry. Page: src/site/pages/download/. Foundation: src/site/base.css + foundation.css + src/site/ui.
import "./site/pages/boot";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Download } from "./site/pages/download/Download";
import { scrollToHash } from "./site/ui";

function App() {
  useEffect(scrollToHash, []);
  return <Download />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
