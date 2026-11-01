// Landing page entry (`/`). Foundation: src/site/base.css + foundation.css + src/site/ui/*.
// Sections live in src/site/sections/*.tsx (one file + one CSS file each). Order = BRIEF section 4.
import "./site/base.css";
import "./site/foundation.css";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Agents } from "./site/sections/Agents";
import { Faq } from "./site/sections/Faq";
import { Final } from "./site/sections/Final";
import { Hero } from "./site/sections/Hero";
import { Platforms } from "./site/sections/Platforms";
import { Security } from "./site/sections/Security";
import { Spec } from "./site/sections/Spec";
import { Stage } from "./site/sections/Stage";
import { Footer, initPage, Nav, scrollToHash } from "./site/ui";

initPage();

function Landing() {
  useEffect(scrollToHash, []);
  return (
    <div className="na-page">
      <a className="na-skip" href="#main">Skip to content</a>
      <Nav />
      <main id="main" className="na-main" tabIndex={-1}>
        <Hero />
        <Stage />
        <Spec />
        <Security />
        <Agents />
        <Platforms />
        <Faq />
        <Final />
      </main>
      <Footer />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
