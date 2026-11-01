// Signature sequence, second half: the live window docks and becomes a sticky stage; six chapters scroll beside it and
// each one plays a scene of the shared demo world (BRIEF 2.5a). Phones and tablets get stacked chapters with posters.
// Owner: site-stage. Sub-parts: StageSticky (desktop), StageStack (touch / narrow), StageChapter (the copy).
import "./Stage.css";
import { STICKY } from "../stage/mode";
import { Section, useMedia } from "../ui";
import { StageSticky } from "./StageSticky";
import { StageStack } from "./StageStack";

export function Stage() {
  const sticky = useMedia(STICKY);
  return (
    <Section id="product" path="product/walkthrough" meta={sticky ? undefined : "live demo"} labelledBy="product-h" flush bare={sticky} className={sticky ? "stage stage--sticky" : "stage"} bodyClassName="stage__body">
      {sticky ? (
        <h2 id="product-h" className="na-sr">How it works, in six chapters</h2>
      ) : (
        <div className="na-head stage__head">
          <h2 id="product-h" className="t-h2">Six chapters of the real app.</h2>
          <p className="t-lead">Tap any screen to try it live.</p>
        </div>
      )}
      {sticky ? <StageSticky /> : <StageStack />}
    </Section>
  );
}
